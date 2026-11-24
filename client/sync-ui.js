(function(){
'use strict';
const app=window.CornellApp;if(!app?.sync)return;
const sync=app.sync,$=id=>document.getElementById(id),panel=$('syncPicker');
const label=id=>app.bible.byId(id)?.label||id;
let conflictSignature=null;
let resolving=false;
const counts=record=>[record?.bulletinBody?.length||0,record?.bulletinQuestions?.length||0];
const describe=record=>{
 const [body,questions]=counts(record);
 const text=Object.values(record?.text||{}).filter(v=>typeof v==='string').join('');
 const ink=Object.values(record?.ink||{}).reduce((n,strokes)=>n+(Array.isArray(strokes)?strokes.length:0),0);
 return (record?.trashedAt?'휴지통 · ':'')+'메모 '+Array.from(text).length+'자, 손글씨 '+ink+'획, 말씀 카드 '+(record?.quotes?.length||0)+'개, 주보 '+body+'개, 질문 '+questions+'개';
};
const titleOf=record=>typeof record?.recordTitle==='string'?record.recordTitle:'';
function comparison(record,name){
 const details=document.createElement('details'),heading=document.createElement('summary'),text=document.createElement('pre');
 heading.textContent=name+' 내용 확인';
 const lines=[titleOf(record)||'(제목 없음)',describe(record)];
 for(const [key,value] of Object.entries(record?.text||{}))if(typeof value==='string'&&value.trim())
  lines.push((record?.titles?.[key]||'메모')+'\n'+value);
 for(const value of Object.values(record?.quoteMemos||{}))if(typeof value==='string'&&value.trim())lines.push('말씀 메모\n'+value);
 for(const item of record?.bulletinQuestions||[])lines.push('질문: '+(item.question||'')+'\n답변: '+(item.answer||''));
 for(const item of record?.bulletinBody||[])lines.push('주보\n'+(item.text||''));
 text.textContent=lines.join('\n\n');text.style.whiteSpace='pre-wrap';text.style.overflowWrap='anywhere';text.style.maxHeight='18rem';text.style.overflow='auto';
 details.append(heading,text);return details;
}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function draw(){
 $('syncSummary').textContent=sync.status();const host=$('syncConflicts');
 $('importSync').disabled=!sync.account();$('backupSync').disabled=!sync.account();
 if(resolving)return;
 const conflicts=sync.conflicts(),drafts=sync.recoveryDrafts?.()||[],signature=JSON.stringify([conflicts,drafts]);
 if(signature===conflictSignature&&host.hasChildNodes())return;
 conflictSignature=signature;host.replaceChildren();
 if(!conflicts.length){const empty=document.createElement('p');empty.textContent='겹친 기록이 없습니다.';host.append(empty);}
 for(const item of conflicts){
  const row=document.createElement('div');row.className='sync-conflict';
  const heading=document.createElement('strong');heading.textContent=label(item.id);
  const summary=document.createElement('p');summary.textContent='이 기기: '+describe(item.local)+' · 서버: '+describe(item.remote);
  row.append(heading,summary);
  row.append(comparison(item.local,'이 기기'),comparison(item.remote,'서버'));
  const local=titleOf(item.local),remote=titleOf(item.remote);
  if(local!==remote){
   const titles=document.createElement('p');
   titles.textContent='이 기기 제목: '+(local||'없음')+' · 서버 제목: '+(remote||'없음');
   row.append(titles);
  }
  const backup=document.createElement('button');backup.type='button';backup.textContent='두 기록 백업';
  backup.addEventListener('click',()=>{
   const current=sync.conflicts().find(x=>x.id===item.id);
   if(current)download(current,'여백성경-'+item.id+'-두기록.json');
  });
  const outcome=document.createElement('p');outcome.setAttribute('role','status');
  const controls=[backup];
  for(const [choice,caption] of [['local','이 기기 기록으로 서버 저장'],['remote','서버 기록 사용']]){
   if(choice==='remote'&&!item.remote)continue;
   const button=document.createElement('button');button.type='button';button.textContent=caption;controls.push(button);
   button.addEventListener('click',async()=>{
    if(resolving)return;
    app.prepareSync();
    const current=sync.conflicts().find(x=>x.id===item.id);
    if(!current||JSON.stringify(current)!==JSON.stringify(item)){conflictSignature=null;draw();$('syncSummary').textContent='기록이 바뀌었어요. 두 내용을 다시 확인한 뒤 선택해 주세요.';return;}
    const question=choice==='local'
     ?'이 기기의 기록 전체를 서버에 저장할까요? 서버에만 있던 내용은 활성 기록에서 바뀝니다. 먼저 두 기록을 이 기기에 백업하며, 자동으로 합치지 않습니다.'
     :'서버의 기록 전체를 이 기기에서 사용할까요? 이 기기에만 있던 내용은 활성 기록에서 바뀝니다. 먼저 두 기록을 이 기기에 백업하며, 자동으로 합치지 않습니다.';
    if(!confirm(question))return;
    resolving=true;controls.forEach(control=>control.disabled=true);outcome.textContent='두 기록을 백업하고 선택한 기록을 확인하고 있어요.';
    let message;
    try{
     await sync.resolve(item.id,choice);
     const result=sync.chapterSyncState(item.id);
     message=result==='confirmed'?(choice==='local'?'이 기기 기록을 서버에 저장했어요.':'서버 기록을 사용합니다.')
      :result==='conflict'?'다른 기기에서 다시 수정됐어요. 두 기록을 다시 확인해 주세요.'
      :result==='local-error'?'기기 저장에 실패했어요. 창을 닫지 말고 기기 백업을 내려받아 주세요.'
      :'선택한 기록은 유지했어요. 서버 저장은 아직 확인되지 않았어요.';
    }catch(error){
     const reason=error?.message;
     message=reason==='busy'?'다른 저장을 처리 중이에요. 잠시 후 다시 선택해 주세요.'
      :reason==='editing_in_progress'?'입력 중인 메모를 마친 뒤 다시 선택해 주세요.'
      :reason==='conflict_changed'?'다른 기기의 기록이 바뀌었어요. 두 내용을 다시 확인해 주세요.'
      :reason==='backup_failed'||error?.name==='QuotaExceededError'?'두 기록을 안전하게 백업하지 못해 변경하지 않았어요. 먼저 두 기록 백업을 내려받아 주세요.'
      :'기록 선택을 완료하지 못했어요. 기기 백업을 내려받고 연결 상태를 확인해 주세요.';
    }finally{
     resolving=false;controls.forEach(control=>control.disabled=false);conflictSignature=null;draw();$('syncSummary').textContent=message;
    }
   });
  }
  row.append(...controls,outcome);host.append(row);
 }
 if(drafts.length){
  const heading=document.createElement('h3');heading.textContent='복구 가능한 기기 초안';host.append(heading);
  const explanation=document.createElement('p');explanation.textContent='서버와 별도로 남아 있던 초안입니다. 내용을 확인하고 내려받을 수 있어요. 복원 후에도 서버 기록은 비교할 때까지 유지합니다.';host.append(explanation);
 }
 for(const item of drafts){
  const row=document.createElement('div'),heading=document.createElement('strong'),backup=document.createElement('button'),restore=document.createElement('button'),notice=document.createElement('p');
  row.className='sync-conflict';heading.textContent=label(item.id)+' · '+(titleOf(item.state)||'기기 초안');
  backup.type=restore.type='button';backup.textContent='초안 내려받기';restore.textContent='이 초안 복원';notice.setAttribute('role','status');
  backup.addEventListener('click',()=>download(item,'여백성경-'+item.id+'-기기초안.json'));
  restore.addEventListener('click',async()=>{
   if(resolving)return;
   app.prepareSync();
   const current=(sync.recoveryDrafts?.()||[]).find(draft=>draft.key===item.key);
   if(!current||JSON.stringify(current)!==JSON.stringify(item)){conflictSignature=null;draw();$('syncSummary').textContent='초안이 바뀌었어요. 내용을 다시 확인해 주세요.';return;}
   if(!confirm('이 초안을 이 기기에서 복원할까요? 현재 기기 기록과 서버 기록을 먼저 백업합니다. 서버에는 아직 저장하지 않으며, 복원 후 두 기록을 비교해 선택합니다.'))return;
   resolving=true;restore.disabled=backup.disabled=true;notice.textContent='현재 기록을 백업하고 초안을 복원하고 있어요.';
   let message;
   try{await sync.restoreDraft(item.key);message='초안을 이 기기에 복원했어요. 위의 두 기록을 비교한 뒤 서버에 저장할 기록을 선택해 주세요.';}
   catch(error){
    message=error?.message==='busy'?'저장 중이에요. 잠시 후 다시 복원해 주세요.'
     :error?.message==='editing_in_progress'?'입력 중인 메모를 마친 뒤 다시 복원해 주세요.'
     :error?.message==='backup_failed'?'현재 기록을 백업하지 못해 복원하지 않았어요. 먼저 초안과 기기 백업을 내려받아 주세요.'
     :error?.message==='storage_failed'?'초안을 기기에 저장하지 못했어요. 창을 닫지 말고 초안을 내려받아 주세요.'
     :'초안을 복원하지 못했어요. 초안을 내려받고 연결 상태를 확인해 주세요.';
   }finally{resolving=false;restore.disabled=backup.disabled=false;conflictSignature=null;draw();$('syncSummary').textContent=message;}
  });
  row.append(heading,comparison(item.state,'초안'),backup,restore,notice);host.append(row);
 }
}
$('openRecovery').addEventListener('click',()=>{app.prepareSync();draw();panel.showModal();});
$('closeSync').addEventListener('click',()=>panel.close());
$('reconnectSync')?.addEventListener('click',async()=>{await app.connectSync();conflictSignature=null;draw();});
$('backupSync').addEventListener('click',()=>{if(sync.account())download({records:sync.entries(),backups:sync.backups(),recoveryDrafts:sync.recoveryDrafts?.()||[]},'여백성경-기기백업.json');});
$('importSync').addEventListener('click',async()=>{
 if(!sync.account())return;
 const prefixes=['yeobaek-paper-v3:','yeobaek-paper-v2:','yeobaek-cornell-v1:'],ids=new Set(),items=[];let unreadable=0;
 for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i),p=prefixes.find(p=>key?.startsWith(p));if(p)ids.add(key.slice(p.length));}
 for(const id of ids){if(!app.bible.byId(id))continue;try{let raw;for(const p of prefixes){raw=localStorage.getItem(p+id);if(raw!==null)break;}const state=app.legacyState(JSON.parse(raw));if(!state||state.version!==2)throw Error();items.push({id,state});}catch{unreadable++;}}
 if(!items.length){$('importResult').textContent=unreadable?'읽을 수 없는 기존 기록이 있어요. 원본은 유지했습니다.':'가져올 기존 기록이 없습니다.';return;}
 if(!confirm('이 브라우저의 기존 기록 '+items.length+'개를 현재 로그인한 계정에 복사할까요? 다른 사람이 쓰던 브라우저라면 취소해 주세요. 원본은 유지됩니다.'))return;
 $('importSync').disabled=true;app.prepareSync();
 try{const r=await sync.importRecords(items);try{localStorage.setItem('yeobaek-import-noted:'+encodeURIComponent(sync.account()),'1');}catch{}$('importResult').textContent=r.added+'개 가져오기 처리. '+(r.skipped?r.skipped+'개는 현재 기록과 달라 제외했어요. 기기 백업 내려받기에서 확인할 수 있어요. ':'')+(unreadable?unreadable+'개는 읽지 못해 원본을 남겼어요. ':'')+'겹친 기록과 동기화 상태를 확인해 주세요.';}catch{$('importResult').textContent='가져오기를 완료하지 못했어요. 원본은 유지했습니다.';}draw();
});
let lastReconnect=0;
const refresh=async event=>{
 if(document.hidden)return;
 if(sync.account()&&!resolving)await sync.refresh();
 else if(app.needsReconnect?.()&&navigator.onLine!==false&&(event?.type==='online'||Date.now()-lastReconnect>=12000)){
  lastReconnect=Date.now();await app.connectSync();
 }
 if(panel.open)draw();
};
window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',refresh);
setInterval(refresh,3000);
app.connectSync().then(draw);
})();
