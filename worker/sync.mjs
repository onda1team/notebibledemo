// The Sites gateway injects identity. The browser may only assert the session it already observed.
const limit=750000;
const base='/api/sync';
const chapterId=/^[1-3]?[A-Z]{2,3}[1-9][0-9]{0,2}$/;
function reply(status,data){
  return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
async function readBody(request){
  const length=Number(request.headers.get('content-length'));
  if(length>limit)return null;
  const stream=request.body?.getReader();if(!stream)return false;
  const fragments=[];let size=0;
  while(true){
    const {done,value}=await stream.read();if(done)break;
    size+=value.byteLength;
    if(size>limit){try{await stream.cancel();}catch{}return null;}
    fragments.push(value);
  }
  const bytes=new Uint8Array(size);let i=0;
  for(const chunk of fragments){bytes.set(chunk,i);i+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return false;}
}
const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const questionLimits={id:80,question:700,answer:5000,reference:100};
const bodyLimits={id:80,text:12000,reference:100};
function validBulletin(entries,limits,max){
  if(!Array.isArray(entries)||entries.length>max)return false;
  const keys=Object.keys(limits);
  const seen=new Set();
  return entries.every(entry=>{
    if(!isObject(entry)||Object.keys(entry).length!==keys.length||
      !keys.every(key=>Object.hasOwn(entry,key)&&typeof entry[key]==='string'&&entry[key].length<=limits[key])||
      !entry.id.trim()||seen.has(entry.id))return false;
    seen.add(entry.id);return true;
  });
}
function sameBulletin(saved,incoming,limits){
  const keys=Object.keys(limits);
  return Array.isArray(incoming)&&saved.length===incoming.length&&
    saved.every((entry,i)=>keys.every(key=>entry?.[key]===incoming[i][key]));
}
function validState(payload){
  return isObject(payload)&&payload.version===2&&isObject(payload.text)&&isObject(payload.ink)
    &&Array.isArray(payload.blocks)&&payload.blocks[0]==='note'
    &&payload.blocks.every((k,i)=>k===(i?'note-'+i:'note'))
    &&Array.isArray(payload.quotes)&&Array.isArray(payload.highlights)
    &&(!Object.hasOwn(payload,'trashedAt')||(Number.isSafeInteger(payload.trashedAt)&&payload.trashedAt>0&&payload.trashedAt<=8.64e15))
    &&(!Object.hasOwn(payload,'recordTitle')||(typeof payload.recordTitle==='string'&&payload.recordTitle.length<=80))
    &&(!Object.hasOwn(payload,'bulletinQuestions')||validBulletin(payload.bulletinQuestions,questionLimits,30))
    &&(!Object.hasOwn(payload,'bulletinBody')||validBulletin(payload.bulletinBody,bodyLimits,10));
}
export async function handleSync(request,db,{clock=Date.now}={}){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(path!==base&&!path.startsWith(base+'/'))return null;
  const uid=request.headers.get('oai-authenticated-user-id');
  if(!uid)return reply(401,{error:'sign_in_required'});
  if(path===base+'/session'&&method==='GET')return reply(200,{account:uid});
  if(request.headers.get('x-yeo-account')!==uid)return reply(409,{error:'account_changed'});
  if(!db)return reply(503,{error:'storage_unavailable'});
  if(path===base+'/chapters'&&method==='GET'){
    const after=url.searchParams.get('after')??'';
    if(after&&!chapterId.test(after))return reply(400,{error:'invalid_cursor'});
    const {results:rows}=await db.prepare('SELECT chapter, revision, updated_at FROM chapter_sync WHERE owner = ? AND chapter > ? ORDER BY chapter LIMIT 201').bind(uid,after).all();
    const records=rows.slice(0,200);
    return reply(200,{records,next:rows.length>200?records.at(-1).chapter:null});
  }
  const match=path.match(/^\/api\/sync\/chapters\/([A-Z0-9]+)$/);
  if(!match||!chapterId.test(match[1]))return reply(404,{error:'invalid_chapter'});
  const id=match[1];
  if(method==='GET'){
    const row=await db.prepare('SELECT revision, updated_at, payload FROM chapter_sync WHERE owner = ? AND chapter = ?').bind(uid,id).first();
    return row?reply(200,{id,revision:row.revision,updatedAt:row.updated_at,state:JSON.parse(row.payload)}):reply(404,{error:'no_record'});
  }
  if(method!=='PUT')return reply(405,{error:'unsupported_method'});
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((origin&&origin!==url.origin)||(site&&site!=='same-origin'&&site!=='none'))return reply(403,{error:'invalid_origin'});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return reply(415,{error:'expected_json'});
  const body=await readBody(request);
  if(body===null)return reply(413,{error:'chapter_too_large'});
  if(!isObject(body)||!Number.isSafeInteger(body.baseRevision)||body.baseRevision<0||!validState(body.state))return reply(400,{error:'invalid_record'});
  const updatedAt=clock(), payload=JSON.stringify(body.state), rev=body.baseRevision;
  // Older open tabs reset fields they do not understand after a sync read.
  // A rejection keeps both the server revision and the local draft intact.
  const supportsCopies=request.headers.get('x-yeo-quote-copies')==='1';
  const supportsTitle=request.headers.get('x-yeo-record-title')==='1';
  const supportsTrash=request.headers.get('x-yeo-record-trash')==='1';
  const supportsBulletin=request.headers.get('x-yeo-bulletin-questions')==='1';
  const supportsBulletinBody=request.headers.get('x-yeo-bulletin-body')==='1';
  if(rev>0&&(!supportsCopies||!supportsTitle||!supportsTrash||!supportsBulletin||!supportsBulletinBody)){
    const current=await db.prepare('SELECT revision, payload FROM chapter_sync WHERE owner = ? AND chapter = ?').bind(uid,id).first();
    if(current?.revision===rev){
      const saved=JSON.parse(current.payload);
      const wouldDropCopies=!supportsCopies&&saved.quotes?.some(card=>typeof card?.instance==='string');
      const wouldDropTitle=!supportsTitle&&typeof saved.recordTitle==='string'&&saved.recordTitle.trim()&&saved.recordTitle!==body.state.recordTitle;
      const wouldEditTrash=!supportsTrash&&Object.hasOwn(saved,'trashedAt');
      const wouldEditBulletin=!supportsBulletin&&Array.isArray(saved.bulletinQuestions)&&saved.bulletinQuestions.length>0&&
        !sameBulletin(saved.bulletinQuestions,body.state.bulletinQuestions,questionLimits);
      const wouldEditBulletinBody=!supportsBulletinBody&&Array.isArray(saved.bulletinBody)&&saved.bulletinBody.length>0&&
        !sameBulletin(saved.bulletinBody,body.state.bulletinBody,bodyLimits);
      if(wouldDropCopies||wouldDropTitle||wouldEditTrash||wouldEditBulletin||wouldEditBulletinBody)return reply(409,{error:'revision_conflict',revision:current.revision});
    }
  }
  const changed=rev===0
    ?await db.prepare('INSERT INTO chapter_sync(owner,chapter,revision,updated_at,payload) VALUES(?,?,1,?,?) ON CONFLICT(owner,chapter) DO NOTHING RETURNING revision').bind(uid,id,updatedAt,payload).first()
    :await db.prepare('UPDATE chapter_sync SET revision=revision+1, updated_at=?, payload=? WHERE owner=? AND chapter=? AND revision=? RETURNING revision').bind(updatedAt,payload,uid,id,rev).first();
  if(!changed){
    const current=await db.prepare('SELECT revision FROM chapter_sync WHERE owner = ? AND chapter = ?').bind(uid,id).first();
    return reply(409,{error:'revision_conflict',revision:current?.revision??0});
  }
  return reply(200,{id,revision:changed.revision,updatedAt});
}
