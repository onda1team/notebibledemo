const chapterId=/^[1-3]?[A-Z]{2,3}[1-9][0-9]{0,2}$/;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const firebaseAccount=uid=>'firebase:'+uid;
export function validSnapshot(state){
 return object(state)&&state.version===2&&object(state.text)&&object(state.ink)&&
  Array.isArray(state.blocks)&&state.blocks.length>0&&state.blocks.every((key,index)=>key===(index?'note-'+index:'note'))&&
  Array.isArray(state.quotes)&&Array.isArray(state.highlights)&&
  (!Object.hasOwn(state,'recordTitle')||(typeof state.recordTitle==='string'&&state.recordTitle.length<=80));
}
const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
function decode(row,id){
 if(!row||!Number.isSafeInteger(row.revision)||row.revision<1||row.formatVersion!==2||typeof row.stateJSON!=='string')throw Error('invalid_record');
 const state=JSON.parse(row.stateJSON);if(!validSnapshot(state))throw Error('invalid_record');
 return {id,revision:row.revision,updatedAt:row.updatedAt?.toMillis?.()??row.updatedAt??0,state};
}
/** Storage operations are injected so CAS and account races are testable without credentials. */
export function createFirebaseRequest({ready,getUser,read,list,compareAndSet}){
 return async function request(path,options={}){
  await ready();
  const user=getUser(),uid=user?.uid;
  if(!uid)return response(401,{error:'sign_in_required'});
  const account=firebaseAccount(uid),url=new URL(path,'https://sync.invalid'),method=options.method||'GET';
  if(url.pathname==='/api/sync/session'&&method==='GET')return response(200,{account});
  if(new Headers(options.headers).get('X-Yeo-Account')!==account)return response(409,{error:'account_changed'});
  const unchanged=()=>{if(getUser()?.uid!==uid)throw Error('account_changed');};
  try{
   if(url.pathname==='/api/sync/chapters'&&method==='GET'){
    const after=url.searchParams.get('after')||'';
    if(after&&!chapterId.test(after))return response(400,{error:'invalid_cursor'});
    const rows=await list(uid,after,201);unchanged();
    const items=rows.slice(0,200).map(row=>({chapter:row.id,revision:row.revision,updated_at:row.updatedAt?.toMillis?.()??row.updatedAt??0}));
    return response(200,{records:items,next:rows.length>200?items.at(-1).chapter:null});
   }
   const match=url.pathname.match(/^\/api\/sync\/chapters\/([A-Z0-9]+)$/);
   if(!match||!chapterId.test(match[1]))return response(404,{error:'invalid_chapter'});
   const id=match[1];
   if(method==='GET'){
    const row=await read(uid,id);unchanged();return row?response(200,decode(row,id)):response(404,{error:'no_record'});
   }
   if(method!=='PUT')return response(405,{error:'unsupported_method'});
   if(typeof options.body!=='string')return response(400,{error:'invalid_record'});
   if(new TextEncoder().encode(options.body).byteLength>750000)return response(413,{error:'chapter_too_large'});
   let payload;try{payload=JSON.parse(options.body);}catch{return response(400,{error:'invalid_record'});}
   if(!object(payload)||!Number.isSafeInteger(payload.baseRevision)||payload.baseRevision<0||!validSnapshot(payload.state))return response(400,{error:'invalid_record'});
   unchanged();
   const result=await compareAndSet(uid,id,payload.baseRevision,JSON.stringify(payload.state),unchanged);unchanged();
   return result.conflict?response(409,{error:'revision_conflict',revision:result.revision}):response(200,{id,revision:result.revision});
  }catch(error){
   if(error?.message==='account_changed'||getUser()?.uid!==uid)return response(409,{error:'account_changed'});
   if(error?.code==='unauthenticated')return response(401,{error:'sign_in_required'});
   if(error?.code==='permission-denied')return response(403,{error:'permission_denied'});
   if(error?.message==='invalid_record'||error instanceof SyntaxError)return response(500,{error:'invalid_record'});
   throw Error('network_error');
  }
 };
}
