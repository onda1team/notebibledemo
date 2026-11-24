/* Account-scoped, revision-checked chapter sync. Legacy browser keys are read only. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.YeoSync=factory();})(typeof window==='object'?window:globalThis,function(){
'use strict';
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const prefix='yeobaek-cloud-v1:';
const validId=id=>/^[1-3]?[A-Z]{2,3}[1-9][0-9]{0,2}$/.test(id);
const titleOf=s=>typeof s?.recordTitle==='string'?s.recordTitle:'';
const trashed=s=>s&&Object.hasOwn(s,'trashedAt');
const groups={
 title:['recordTitle'],
 bulletin:['bulletinBody','bulletinQuestions'],
 notes:['blocks','deletedBlocks','heights','highlights','ink','inlineOrder','legacyText','manualOrder','noteMarks','notesHeight','quoteHeights','quoteMemos','quotes','sizedBlocks','text','timeline','titles']
};
const groupNames=Object.keys(groups),groupFields=new Set(Object.values(groups).flat());
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
async function fingerprints(state){
 try{
  const body={
   title:titleOf(state),
   bulletin:groups.bulletin.map(k=>Object.hasOwn(state,k)?state[k]:[]),
   notes:Object.fromEntries(groups.notes.filter(k=>Object.hasOwn(state,k)).map(k=>[k,state[k]])),
   other:Object.fromEntries(Object.keys(state).filter(k=>!groupFields.has(k)&&k!=='updatedAt').map(k=>[k,state[k]]))
  }, encoder=new TextEncoder();
  return Object.fromEntries(await Promise.all(Object.entries(body).map(async ([group,value])=>{
   const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(stable(value))));
   return [group,[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')];
  })));
 }catch{return null;} // Missing crypto is not permission to infer compatibility.
}
function create({storage,request,onChange=()=>{},onStatus=()=>{},onLock=()=>{},canApply=()=>true}){
 let account=null,epoch=0,busy=false,closed=false,records=new Map(),status='동기화 연결 중',timer,activeRefresh=null;
 let deferred=new Set(),titleSend=null;
 const baseJobs=new Map(),heldByAccount=new Map();
 let recovery=new Map();
 const writer=globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random();
 const emit=m=>{status=m;onStatus(m);};
 const key=id=>prefix+encodeURIComponent(account)+':'+id;
 function save(id,r){
  const next={...r};delete next.storageError;records.set(id,next);
  try{if(next.dirty)storage.setItem(key(id)+':draft:'+writer,JSON.stringify({...next,id,format:2,at:Date.now()}));storage.setItem(key(id),JSON.stringify(next));if(!next.dirty&&!next.conflict&&!next.pending)storage.removeItem?.(key(id)+':draft:'+writer);return true;}
  catch{next.storageError=true;records.set(id,next);emit(next.dirty?'기기 저장 실패 · 창을 닫지 말고 연결을 확인해 주세요':'서버 기록을 기기에 저장하지 못했어요');return false;}
 }
 function guard(e){if(closed||e!==epoch)throw Error('stale_session');}
 async function api(path,options={}){
  const e=epoch;const r=await request('/api/sync'+path,{cache:'no-store',credentials:'same-origin',...options,headers:{...(path==='/session'?{}:{'X-Yeo-Account':account}),...options.headers}});guard(e);
  if(r.status===401){lock();throw Error('account_changed');}
  let body;try{body=await r.json();}catch{throw Error('invalid_response');}guard(e);
  if(body.error==='account_changed'){lock();throw Error('account_changed');}
  if(!r.ok&&r.status!==404&&body.error!=='revision_conflict')throw Error(body.error||'network_error');
  return {status:r.status,body};
 }
 function holdUnstored(){
  if(!account)return;
  const held=heldByAccount.get(account)||new Map();
  for(const [id,r] of records)if(r.storageError&&(r.dirty||r.pending||r.conflict))held.set(id,clone(r));
  if(held.size)heldByAccount.set(account,held);
 }
 function lock(){holdUnstored();epoch++;closed=true;account=null;records.clear();recovery.clear();deferred.clear();baseJobs.clear();clearTimeout(timer);emit('로그인을 확인해 주세요 · 다시 연결');onLock();}
 async function start(){
  holdUnstored();closed=false;epoch++;const startingEpoch=epoch;records=new Map();recovery=new Map();deferred=new Set();baseJobs.clear();
  const {body}=await api('/session');if(typeof body.account!=='string'||!body.account)throw Error('sign_in_required');account=body.account;
  const p=prefix+encodeURIComponent(account)+':';
  for(let i=0;i<storage.length;i++){const k=storage.key(i);if(!k?.startsWith(p))continue;const id=k.slice(p.length);if(!validId(id))continue;try{const r=JSON.parse(storage.getItem(k));if(r&&r.state&&Number.isSafeInteger(r.revision)&&r.revision>=0)records.set(id,r);}catch{emit('일부 기기 기록을 읽지 못했어요');}}
  // A quota failure can persist the journal but not the canonical key. Read
  // those journals before fetching the server; never silently hide that edit.
  const candidates=[];
  for(let i=0;i<storage.length;i++){
   const k=storage.key(i);if(!k?.startsWith(p))continue;
   const suffix=k.slice(p.length),split=suffix.indexOf(':draft:');
   if(split<0||!validId(suffix.slice(0,split)))continue;
   try{
    const draft=JSON.parse(storage.getItem(k)),id=suffix.slice(0,split);
    if(!draft?.state)continue;
    const known=draft.format===2&&Number.isSafeInteger(draft.revision)&&draft.revision>=0;
    const record=known?{...draft}:null;
    if(record){delete record.id;delete record.at;delete record.format;}
    candidates.push({key:suffix,id,state:clone(draft.state),record,at:draft.at||0});
   }catch{}
  }
  for(const [id,r] of heldByAccount.get(account)||[])candidates.push({key:id+':memory',id,state:clone(r.state),record:clone(r),at:Date.now(),memory:true});
  candidates.sort((a,b)=>Number(!!b.memory)-Number(!!a.memory)||b.at-a.at);
  for(const candidate of candidates){
   recovery.set(candidate.key,candidate);
   const current=records.get(candidate.id);
   if(same(current?.state,candidate.state))continue;
   if(candidate.record&&(!current||(!current.dirty&&!current.pending&&!current.conflict&&candidate.record.revision>=current.revision))){
    save(candidate.id,{...candidate.record,dirty:true});
   }else recovery.set(candidate.key,candidate);
  }
  await refresh();guard(startingEpoch);if(!account)throw Error('not_connected');return account;
 }
 function write(id,state){
  if(!account||closed)throw Error('not_connected');
  const old=records.get(id);if(same(old?.state,state))return old.storageError?save(id,old):true;
  const r={...(old||{revision:0}),state:clone(state),dirty:true};
  if(old?.revision>0&&!old.dirty&&!old.pending&&!old.conflict)prepareBase(id,r,old.state,old.revision);
  const saved=save(id,r);if(saved)emit(r.conflict?'다른 기기와 변경이 겹쳐요 · 두 기록 유지':'이 기기에 저장 · 동기화 대기');
  clearTimeout(timer);timer=setTimeout(()=>refresh(),650);return saved;
 }
 function prepareBase(id,next,state,revision){
  if(!state||trashed(state))return;
  // Store only revision and group digests instead of duplicating the complete
  // confirmed ancestor in browser storage. A draft is saved before hashing finishes.
  const token={revision},e=epoch;
  next.mergeBase=token;
  const job=fingerprints(state).then(fields=>{
   const latest=records.get(id);
   if(fields&&e===epoch&&!closed&&latest?.mergeBase===token)save(id,{...latest,mergeBase:{...token,fields}});
  }).finally(()=>{if(baseJobs.get(id)===job)baseJobs.delete(id);});
  baseJobs.set(id,job);
 }
 async function readRemote(id){const r=await api('/chapters/'+id);return r.status===404?null:r.body;}
 function putSnapshot(id,baseRevision,state){
  return api('/chapters/'+id,{method:'PUT',headers:{'Content-Type':'application/json','X-Yeo-Quote-Copies':'1','X-Yeo-Record-Title':'1','X-Yeo-Record-Trash':'1','X-Yeo-Bulletin-Questions':'1','X-Yeo-Bulletin-Body':'1'},body:JSON.stringify({baseRevision,state})});
 }
 function conflict(id,r,remote){const next={...r,conflict:{revision:remote?.revision??0,state:clone(remote?.state??null)}};save(id,next);emit('다른 기기와 변경이 겹쳐요 · 두 기록 유지');}
 function acknowledge(id,r,snapshot,revision){
  const next={...r,revision,dirty:!same(r.state,snapshot)};delete next.lastError;
  if(!next.dirty){
   heldByAccount.get(account)?.delete(id);
   for(const [k,item] of recovery)if(item.id===id&&same(item.state,snapshot)){
    // This exact draft is now confirmed remotely and in the canonical record.
    if(!k.endsWith(':memory'))try{storage.removeItem?.(prefix+encodeURIComponent(account)+':'+k);}catch{}
    recovery.delete(k);
   }
  }
  delete next.pending;delete next.mergeBase;
  if(next.dirty)prepareBase(id,next,snapshot,revision);
  save(id,next);return next;
 }
 async function combineIndependent(id,remote,waiting){
  let local=records.get(id);
  if(!local||!remote?.state||remote.revision<=local.revision||!local.mergeBase||local.pending||local.storageError)return false;
  const e=epoch;
  if(!local.mergeBase.fields){await baseJobs.get(id);guard(e);local=records.get(id);}
  const base=local?.mergeBase, state=local?.state;
  if(!base||base.revision!==local.revision||!state||local.storageError||trashed(state)||trashed(remote.state)||
    ![...groupNames,'other'].every(k=>/^[a-f0-9]{64}$/.test(base.fields?.[k]||'')))return false;
  const [localFields,remoteFields]=await Promise.all([fingerprints(state),fingerprints(remote.state)]);guard(e);
  if(records.get(id)?.state!==state||!localFields||!remoteFields||localFields.other!==base.fields.other||remoteFields.other!==base.fields.other)return false;
  const useLocal=[];
  for(const group of groupNames){
   const l=localFields[group],r=remoteFields[group],b=base.fields[group];
   if(l===r||l===b)continue;
   if(r!==b)return false; // two different edits to one dependent group
   useLocal.push(group);
  }
  if(!canApply(id)){waiting.add(id);return true;}
  const combined=clone(remote.state);
  for(const group of useLocal)for(const k of groups[group]){
   if(Object.hasOwn(state,k))combined[k]=clone(state[k]);else delete combined[k];
  }
  if(useLocal.length&&Number.isFinite(state.updatedAt)&&(!Number.isFinite(combined.updatedAt)||state.updatedAt>combined.updatedAt))
   combined.updatedAt=state.updatedAt;
  let revision=remote.revision;
  if(!same(combined,remote.state)){
   // CAS recomputes from a fresh server record after a race or unknown result.
   // Do not rebase the local source or drop it until the merge is confirmed.
   const result=await putSnapshot(id,revision,combined);guard(e);
   if(result.status===409){const newest=await readRemote(id);guard(e);conflict(id,records.get(id),newest);return true;}
   if(result.status!==200||result.body.revision!==revision+1)throw Error('merge_unconfirmed');
   revision=result.body.revision;
  }
  const latest=records.get(id);
  if(latest?.state!==state||!canApply(id)){
   // The editor may have started again during the request. Leave its draft
   // untouched; the next fresh read can recognize the already-merged result.
   waiting.add(id);return true;
  }
  save(id,{revision,state:combined,dirty:false});onChange(id);
  return true;
 }
 async function reconcile(id,waiting){
  let r=records.get(id);const remote=await readRemote(id);r=records.get(id);
  if(r?.conflict){
   if(remote&&same(remote.state,r.state)){const next={...r};delete next.conflict;acknowledge(id,next,remote.state,remote.revision);return;}
   if(await combineIndependent(id,remote,waiting))return;
   r=records.get(id);if(!same(r.conflict.state,remote?.state)||r.conflict.revision!==(remote?.revision??0))conflict(id,r,remote);return;
  }
  if(r?.pending){
   if(remote&&same(remote.state,r.pending.state)){r=acknowledge(id,r,r.pending.state,remote.revision);}
   else if((remote?.revision??0)!==r.pending.baseRevision){conflict(id,r,remote);return;}
   else {r={...r};delete r.pending;save(id,r);}
  }
  if(r?.dirty){
   if(remote&&same(remote.state,r.state)){acknowledge(id,r,remote.state,remote.revision);return;}
   if((remote?.revision??0)!==r.revision){
    if(!await combineIndependent(id,remote,waiting))conflict(id,records.get(id),remote);
    return;
   }
   const snapshot=clone(r.state),baseRevision=r.revision;
   save(id,{...r,pending:{state:snapshot,baseRevision}});
   const e=epoch,result=await putSnapshot(id,baseRevision,snapshot);guard(e);
   const latest=records.get(id);
   if(result.status===409){
    // A definitive CAS rejection did not write our pending attempt. Keep its
    // source draft and base evidence, and compare against the winning revision.
    const unsubmitted={...latest};delete unsubmitted.pending;save(id,unsubmitted);
    const newest=await readRemote(id);guard(e);
    if(!await combineIndependent(id,newest,waiting))conflict(id,records.get(id),newest);
    return;
   }
   acknowledge(id,latest,snapshot,result.body.revision);return;
  }
  if(remote&&(!r||remote.revision!==r.revision)){
   if(!canApply(id)){waiting.add(id);return;}
   save(id,{revision:remote.revision,state:clone(remote.state),dirty:false});onChange(id);emit('서버 기록을 사용합니다');
  }
 }
 function refresh(){
  if(!account||closed)return Promise.resolve(false);
  if(titleSend?.epoch===epoch)return Promise.resolve(false);
  if(activeRefresh?.epoch===epoch)return activeRefresh.promise;
  const task={epoch};activeRefresh=task;busy=true;
  task.promise=runRefresh(task.epoch).finally(()=>{if(activeRefresh===task){activeRefresh=null;busy=false;}});
  return task.promise;
 }
 async function runRefresh(e){
  try{
   const session=await api('/session');if(session.body.account!==account){lock();return false;}
   const ids=new Set([...records].filter(([,r])=>r.dirty||r.conflict||r.pending).map(([id])=>id)), waiting=new Set();let after='',failed=false;
   do{
    const page=await api('/chapters'+(after?'?after='+encodeURIComponent(after):''));
    for(const r of page.body.records||[]){
     if(!validId(r.chapter)||records.get(r.chapter)?.revision===r.revision)continue;
     const local=records.get(r.chapter);
     if(ids.has(r.chapter)||local?.dirty||local?.pending||local?.conflict||canApply(r.chapter))ids.add(r.chapter);
     else waiting.add(r.chapter);
    }
    after=page.body.next||'';
   }while(after);
   for(const id of ids){guard(e);try{await reconcile(id,waiting);}catch(err){guard(e);failed=true;const r=records.get(id);if(r)records.set(id,{...r,lastError:err.message});}}
   guard(e);deferred=waiting;
   if([...records.values()].some(r=>r.storageError&&r.dirty))emit('기기 저장 실패 · 창을 닫지 말고 연결을 확인해 주세요');
   else if([...records.values()].some(r=>r.conflict))emit('변경이 겹쳐 두 기록을 그대로 유지했어요');
   else if(failed&&[...records.values()].some(r=>r.lastError==='chapter_too_large'))emit('기록이 커서 전송 못 함 · 기기 원본 유지');
   else if(failed)emit('일부 기록 전송 대기 · 기기 원본 유지');
   else if(deferred.size)emit('다른 기기 변경이 있어요 · 입력을 마치면 표시됩니다');
   else if([...records.values()].some(r=>r.dirty))emit('이 기기에 저장 · 동기화 대기');
   else if(recoveryDrafts().length)emit('복구할 기기 초안이 있어요 · 백업 및 복구를 확인해 주세요');
   else emit([...records.values()].some(r=>r.storageError)?'서버 저장 완료 · 기기 저장 공간을 확인해 주세요':'자동 동기화 완료');
   return !failed;
  }catch(err){if(!closed&&e===epoch)emit([...records.values()].some(r=>r.storageError&&r.dirty)?'기기 저장 실패 · 창을 닫지 말고 연결을 확인해 주세요':err.message==='chapter_too_large'?'기록이 커서 전송 못 함 · 기기 원본 유지':'연결 대기 · 기기 기록 유지');return false;}
 }
 async function flush(){
  if(!account||closed)return {loggedIn:false};
  const e=epoch;
  // Flush now instead of waiting for the next debounced check. Never create a
  // chapter or mark a clean snapshot dirty just because the button was pressed.
  clearTimeout(timer);
  for(const [id,r] of records)if(r.storageError)save(id,r);
  let connected=await refresh();
  if(e!==epoch||closed||!account)return {loggedIn:false};
  if(connected&&[...records.values()].some(r=>(r.dirty||r.pending)&&!r.conflict))
    connected=await refresh(); // one catch-up pass if an edit arrived in flight
  if(e!==epoch||closed||!account)return {loggedIn:false};
  const all=[...records.values()];
  return {loggedIn:true,connected,total:all.length,
    localErrors:all.filter(r=>r.storageError).length,
    pending:all.filter(r=>(r.dirty||r.pending)&&!r.conflict).length,
    conflicts:all.filter(r=>r.conflict).length};
 }
 async function importRecords(items){
  if(!account||closed)throw Error('not_connected');let added=0,skipped=0;
  for(const item of items){if(!validId(item.id)||!item.state)continue;const old=records.get(item.id);
   if(old){if(!same(old.state,item.state)){const k=key(item.id)+':import:'+Date.now();storage.setItem(k,JSON.stringify(item.state));skipped++;}continue;}
   save(item.id,{revision:0,state:clone(item.state),dirty:true});if(canApply(item.id))onChange(item.id);added++;
  }
  await refresh();return {added,skipped};
 }
 async function resolve(id,choice){
  if(busy||titleSend?.epoch===epoch)throw Error('busy');const r=records.get(id);if(!r?.conflict)return;
  if(!canApply(id))throw Error('editing_in_progress');
  const expected=clone(r.conflict);const remote=await readRemote(id);const latest=records.get(id);if(!latest?.conflict)return;
  if(titleSend?.epoch===epoch)throw Error('busy');
  if(!canApply(id))throw Error('editing_in_progress');
  if((remote?.revision??0)!==expected.revision||!same(remote?.state??null,expected.state)){conflict(id,latest,remote);throw Error('conflict_changed');}
  storage.setItem(key(id)+':backup:'+Date.now(),JSON.stringify({local:latest.state,remote:remote?.state,at:Date.now()}));
  if(choice==='remote'){
   if(!remote)throw Error('no_record');save(id,{revision:remote.revision,state:clone(remote.state),dirty:false});heldByAccount.get(account)?.delete(id);recovery.delete(id+':memory');onChange(id);emit('서버 기록을 사용합니다');
  }else{
   const next={revision:remote?.revision??0,state:clone(latest.state),dirty:true};save(id,next);await refresh();
  }
 }
 async function sendConflictTitle(id,{title,revision}={}){
  if(!account||closed||!validId(id))throw Error('not_connected');
  if(typeof title!=='string'||!title.trim()||title.length>80||!Number.isSafeInteger(revision)||revision<1)throw Error('no_title');
  const e=epoch;
  if(activeRefresh?.epoch===e)await activeRefresh.promise;
  guard(e);
  if(titleSend?.epoch===e)throw Error('busy');
  const op={epoch:e};titleSend=op;
  try{
   let r=records.get(id);
   if(r?.conflict?.revision!==revision||titleOf(r.state)!==title)throw Error('conflict_changed');
   if(!canApply(id))throw Error('editing_in_progress');
   const expected=r.conflict,remote=await readRemote(id);guard(e);r=records.get(id);
   if(r?.conflict!==expected||titleOf(r.state)!==title)throw Error('conflict_changed');
   if(!canApply(id))throw Error('editing_in_progress');
   if(!remote?.state||remote.revision!==revision||!same(remote.state,expected.state)){
    conflict(id,r,remote);throw Error('conflict_changed');
   }
   if(trashed(r.state)||trashed(remote.state)||titleOf(remote.state)===title)throw Error('no_title');
   // Retain both original versions, then CAS an exact remote clone with only its title changed.
   const at=Date.now();
   try{storage.setItem(key(id)+':backup:'+at+'-'+writer,JSON.stringify({local:r.state,remote:remote.state,at}));}
   catch{throw Error('backup_failed');}
   const snapshot={...clone(remote.state),recordTitle:title};
   const result=await putSnapshot(id,revision,snapshot);guard(e);
   if(result.status===409){
    const newest=await readRemote(id);guard(e);r=records.get(id);
    if(r?.conflict)conflict(id,r,newest);
    throw Error('conflict_changed');
   }
   if(result.status!==200||!Number.isSafeInteger(result.body.revision)||result.body.revision!==revision+1)throw Error('title_unconfirmed');
   r=records.get(id);
   if(r?.conflict)save(id,{...r,conflict:{revision:result.body.revision,state:snapshot}});
   emit('제목만 서버에 저장했어요 · 겹친 나머지 기록은 유지했습니다');
   return true;
  }finally{if(titleSend===op)titleSend=null;}
 }

 function recoveryDrafts(){
  if(!account)return [];
  return [...recovery.values()].filter(item=>!same(records.get(item.id)?.state,item.state)).map(({key,id,state,record,at})=>({key,id,at,state:clone(state),...(record?{revision:record.revision}:{})}));
 }
 async function restoreDraft(recoveryKey){
  if(!account||closed)throw Error('not_connected');
  const e=epoch;
  if(activeRefresh?.epoch===e)await activeRefresh.promise;
  guard(e);
  if(busy||titleSend?.epoch===epoch)throw Error('busy');
  const item=recovery.get(recoveryKey);if(!item)throw Error('no_draft');
  if(!canApply(item.id))throw Error('editing_in_progress');
  const remote=await readRemote(item.id);guard(e);
  if(!canApply(item.id))throw Error('editing_in_progress');
  const current=records.get(item.id),at=Date.now();
  // Restoring selects a visible local copy, not permission to overwrite cloud
  // data. Keep every original and require the existing conflict choice flow.
  try{storage.setItem(key(item.id)+':backup:'+at+'-'+writer,JSON.stringify({local:current?.state,remote:remote?.state,recovered:item.state,at}));}
  catch{throw Error('backup_failed');}
  const next={revision:remote?.revision??0,state:clone(item.state),dirty:true,conflict:{revision:remote?.revision??0,state:clone(remote?.state??null)}};
  const saved=save(item.id,next);onChange(item.id);if(!saved)throw Error('storage_failed');
  emit('초안을 복원했어요 · 서버 기록과 비교해 주세요');
  return true;
 }
 function backups(){const p=prefix+encodeURIComponent(account)+':',out=[];if(!account)return out;for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith(p)&&/:(backup|import|draft):/.test(k))try{out.push({key:k.slice(p.length),data:JSON.parse(storage.getItem(k))});}catch{}}return out;}
 function viewStorage(){const entries=[...records].map(([id,r])=>['yeobaek-paper-v3:'+id,JSON.stringify(r.state)]);return {length:entries.length,key:i=>entries[i]?.[0]??null,getItem:k=>entries.find(x=>x[0]===k)?.[1]??null};}
 function hasUnsavedRecovery(){return [...heldByAccount.values()].some(items=>items.size>0)||[...records.values()].some(r=>r.storageError&&(r.dirty||r.pending||r.conflict));}
 function chapterSyncState(id){
  const r=records.get(id);
  return !r?'missing':r.conflict?'conflict':!r.dirty&&!r.pending&&r.revision>0?'confirmed':r.storageError?'local-error':'pending';
 }
 return {start,refresh,flush,write,importRecords,resolve,sendConflictTitle,lock,backups,recoveryDrafts,restoreDraft,hasUnsavedRecovery,read:id=>clone(records.get(id)?.state??null),account:()=>account,status:()=>status,hasDeferred:()=>!!deferred.size,chapterSyncState,conflicts:()=>[...records].filter(([,r])=>r.conflict).map(([id,r])=>({id,revision:r.conflict.revision,local:clone(r.state),remote:clone(r.conflict.state)})),viewStorage,entries:()=>[...records].map(([id,r])=>({id,...clone(r)}))};
}
return {create};
});
