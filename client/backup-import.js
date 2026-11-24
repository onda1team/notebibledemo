(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.mount(root);})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const idPattern=/^[1-3]?[A-Z]{2,3}[1-9][0-9]{0,2}$/;
 function parse(value,{validId=id=>idPattern.test(id),legacy=state=>state}={}){
  const candidates=[],seen=new Set();let skipped=0;
  function add(id,state,source){
   state=legacy(state);
   if(!validId(id)||!state||state.version!==2||!state.text||typeof state.text!=='object'||!state.ink||typeof state.ink!=='object'||
    !Array.isArray(state.blocks)||state.blocks[0]!=='note'||!state.blocks.every((key,i)=>key===(i?'note-'+i:'note'))||!Array.isArray(state.quotes)||!Array.isArray(state.highlights)){skipped++;return;}
   const signature=JSON.stringify([id,state]);if(seen.has(signature))return;seen.add(signature);
   candidates.push({id,state:JSON.parse(JSON.stringify(state)),source});
  }
  const rows=Array.isArray(value)?value:Array.isArray(value?.records)?value.records:value?.id?[value]:[];
  for(const item of rows){
   if(item?.state)add(item.id,item.state,'저장 기록');
   else if(item?.local||item?.remote){if(item.local)add(item.id,item.local,'기기 기록');if(item.remote)add(item.id,item.remote,'서버 기록');}
   else skipped++;
  }
  for(const item of Array.isArray(value?.recoveryDrafts)?value.recoveryDrafts:[])add(item?.id,item?.state,'복구 초안');
  return {candidates,skipped};
 }
 function mount(win){
  const app=win.CornellApp,$=id=>win.document.getElementById(id),file=$('backupImportFile');if(!app?.sync||!file)return;
  const sync=app.sync,preview=$('backupImportPreview'),button=$('backupImportConfirm'),notice=$('backupImportNotice');
  let candidates=[],loadedAccount=null,busy=false;
  const text=record=>Object.values(record?.text||{}).filter(v=>typeof v==='string').join('\n\n');
  file.addEventListener('change',async()=>{
   candidates=[];loadedAccount=null;button.disabled=true;preview.replaceChildren();notice.textContent='';
   const selected=file.files?.[0];if(!selected)return;
   if(!sync.account()){notice.textContent='Google 계정으로 로그인한 뒤 백업 파일을 선택해 주세요.';return;}
   if(selected.size>20*1024*1024){notice.textContent='20MB 이하의 여백성경 JSON 백업을 선택해 주세요.';return;}
   const account=sync.account();
   try{
    const result=parse(JSON.parse(await selected.text()),{validId:id=>idPattern.test(id)&&!!app.bible.byId(id),legacy:app.legacyState});
    if(sync.account()!==account)throw Error('account_changed');candidates=result.candidates;loadedAccount=account;
    if(!candidates.length){notice.textContent='가져올 여백성경 기록을 찾지 못했어요. 기기 백업 JSON인지 확인해 주세요.';return;}
    candidates.forEach((item,index)=>{
     const row=win.document.createElement('div'),label=win.document.createElement('label'),check=win.document.createElement('input'),title=win.document.createElement('span'),details=win.document.createElement('details'),summary=win.document.createElement('summary'),body=win.document.createElement('pre');
     row.className='backup-import-row';check.type='checkbox';check.dataset.index=String(index);
     title.textContent=(app.bible.byId(item.id)?.label||item.id)+' · '+(item.state.recordTitle||item.source)+(sync.read(item.id)?' · 기존 장은 유지':' · 새로 복사 가능');
     label.append(check,title);summary.textContent='가져올 내용 확인';
     const strokes=Object.values(item.state.ink).reduce((n,value)=>n+(Array.isArray(value)?value.length:0),0);
     body.textContent='손글씨 '+strokes+'획 · 주보 '+(item.state.bulletinBody?.length||0)+'개\n\n'+text(item.state);
     details.append(summary,body);row.append(label,details);preview.append(row);
     check.addEventListener('change',()=>{button.disabled=busy||!preview.querySelector('input:checked');});
    });
    notice.textContent=candidates.length+'개 내용을 확인하고 복사할 항목을 선택해 주세요.'+(result.skipped?' 읽을 수 없는 '+result.skipped+'개 항목은 제외했어요.':'');
   }catch(error){notice.textContent=error?.message==='account_changed'?'로그인 계정이 바뀌었어요. 파일을 다시 선택해 주세요.':'백업 파일을 읽지 못했어요. 원본 파일은 그대로입니다.';}
  });
  button.addEventListener('click',async()=>{
   if(busy)return;
   const account=sync.account();if(!account||account!==loadedAccount){notice.textContent='로그인 계정을 확인하고 백업 파일을 다시 선택해 주세요.';return;}
   const chosen=[...preview.querySelectorAll('input:checked')].map(input=>candidates[Number(input.dataset.index)]).filter(Boolean);
   if(!chosen.length)return;
   if(new Set(chosen.map(item=>item.id)).size!==chosen.length){notice.textContent='같은 장의 여러 버전이 있어요. 장마다 한 버전씩 선택해 주세요.';return;}
   const email=win.document.getElementById('authAccount')?.textContent||'현재 계정';
   if(!win.confirm(email+'에 선택한 '+chosen.length+'개 기록을 복사할까요? 이미 있는 장은 덮어쓰지 않고 파일의 내용을 별도 기기 백업으로 보관합니다. 원본 파일은 바꾸지 않습니다.'))return;
   busy=true;button.disabled=true;file.disabled=true;app.prepareSync();app.save?.();notice.textContent='기록을 복사하고 서버 저장을 확인하고 있어요.';
   try{
    const result=await sync.importRecords(chosen);if(sync.account()!==account)throw Error('account_changed');
    const saved=await sync.flush();
    notice.textContent=result.added+'개 복사 처리, '+result.skipped+'개 기존 장 유지. '+
     (saved.loggedIn&&saved.connected&&!saved.pending&&!saved.localErrors&&!saved.conflicts?'서버 저장을 확인했어요.':'서버 저장을 아직 모두 확인하지 못했어요. 창을 유지하고 백업 및 복구의 상태를 확인해 주세요.');
    preview.querySelectorAll('input:checked').forEach(input=>input.checked=false);
   }catch{notice.textContent='가져오기를 완료하지 못했어요. 원본 파일은 그대로이며, 현재 기록과 저장 상태를 확인해 주세요.';}
   finally{busy=false;file.disabled=false;button.disabled=!preview.querySelector('input:checked');}
  });
 }
 return {parse,mount};
});
