(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else if(root.document)api.mount(root);
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function create({request,app,render=()=>{},navigate=()=>{},reload=()=>{},confirm=()=>false,backup=()=>{},initialError=null,firebase=null}){
  let session=null,busy=false,notice='로그인 상태 확인 중',unsafe=false,pendingAuthChange=false;
  let incomingNotice=initialError==='access_denied'?'Google 로그인을 취소했어요. 기존 기록은 그대로입니다.':
   ['invalid_token','token_exchange_failed'].includes(initialError)?'Google 로그인을 마치지 못했어요. 다시 로그인해 주세요.':'';
  const display=()=>render({session,busy,notice,unsafe});
  const message=(text,blocked=false)=>{notice=text;unsafe=blocked;display();};
  async function api(path,method='GET',body={}){
   const response=await request('/api/auth/'+path,{method,credentials:'same-origin',cache:'no-store',headers:method==='POST'?{'Content-Type':'application/json'}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})});
   let value;try{value=await response.json();}catch{throw Error('unavailable');}
   if(!response.ok)throw Error(value?.error||'unavailable');
   return value;
  }
  async function load(){
   if(busy)return false;busy=true;display();
   try{
    const value=firebase?await firebase.ready():await api('session');
    if(!value||!['google','chatgpt',null].includes(value.provider)||typeof value.googleEnabled!=='boolean')throw Error('unavailable');
    session=value;notice=incomingNotice||(value.sessionInvalid?'Google 로그인 시간이 끝났어요. 다시 로그인해 주세요.':value.googleEnabled?'':(value.provider==='google'?'':'Google 로그인 준비 중'));incomingNotice='';unsafe=false;return true;
   }catch{notice='로그인 상태를 확인하지 못했어요. 다시 확인해 주세요.';return false;}
   finally{busy=false;display();}
  }
  async function safeToLeave(){
   const sync=app?.sync;
   if(!sync){message('기록 상태를 확인하지 못했어요. 현재 창을 유지해 주세요.',true);return false;}
   if(sync.hasUnsavedRecovery?.()){message('아직 이 창에만 남아 있는 기록이 있어요. 같은 계정으로 다시 연결하고 백업한 뒤 진행해 주세요.',true);return false;}
   if(!sync.account()){
    if(session?.account){message('현재 계정의 기록 연결을 먼저 확인해 주세요. 다시 연결한 뒤 진행할 수 있어요.',true);return false;}
    if(sync.entries().length){message('저장하지 못한 기록이 있어요. 다시 연결하고 백업한 뒤 진행해 주세요.',true);return false;}
    return true;
   }
   if(app.canUpdate?.()===false){message('입력 중인 내용을 마치고 열린 창을 닫은 뒤 다시 눌러주세요.');return false;}
   app.prepareSync?.();app.save?.();
   let result;try{result=await sync.flush();}catch{message('저장 상태를 확인하지 못했어요. 기기 백업을 내려받고 연결을 확인해 주세요.',true);return false;}
   if(!result?.loggedIn||!result.connected||result.localErrors||result.pending||result.conflicts||sync.hasUnsavedRecovery?.()){
    message('서버에 저장되지 않았거나 겹친 기록이 있어요. 기기 백업을 내려받고 내 기록 → 백업 및 복구에서 확인한 뒤 다시 진행해 주세요.',true);return false;
   }
   if(app.canUpdate?.()===false||sync.entries().some(item=>item.dirty||item.pending||item.conflict||item.storageError)){
    message('저장 확인 중에 입력이 바뀌었어요. 입력을 마친 뒤 다시 진행해 주세요.',true);return false;
   }
   return true;
  }
  async function action(work){
   if(busy)return false;busy=true;unsafe=false;display();
   try{return await work();}
   catch(error){message(error?.code==='auth/popup-blocked'?'로그인 창이 차단됐어요. 팝업을 허용하고 Google 로그인을 다시 눌러주세요.':error?.code==='auth/popup-closed-by-user'?'로그인 창을 닫았어요. 기존 기록은 그대로입니다.':'요청을 완료하지 못했어요. 기존 기록은 그대로 두고 연결 상태를 확인해 주세요.');return false;}
   finally{busy=false;display();if(pendingAuthChange){pendingAuthChange=false;void onAuthChange();}}
  }
  const login=()=>action(async()=>{
   if(!session?.googleEnabled){message('Google 로그인 준비 중');return false;}
   // A Firebase popup leaves this page (and its account-scoped recovery memory)
   // alive. Let a locked user sign back in to recover those drafts. Redirect
   // OAuth and switches from an active account still require confirmed storage.
   const memoryReconnect=!!firebase&&!app.sync.account()&&app.sync.hasUnsavedRecovery?.();
   if(!memoryReconnect&&!await safeToLeave())return false;
   if(firebase){await firebase.signIn();app.sync.lock();session=await firebase.ready();const connected=await app.connectSync();message(connected?'Google 계정으로 연결했어요.':'로그인했어요. 다시 연결을 눌러 기록 연결을 확인해 주세요.');return true;}
   navigate('/api/auth/google/start');return true;
  });
  const logout=()=>action(async()=>{
   if(session?.provider!=='google')return false;
   if(!await safeToLeave())return false;
   if(firebase){await firebase.signOut();app.sync.lock();session=await firebase.ready();message('로그아웃했어요. 같은 Google 계정으로 로그인하면 기록을 다시 볼 수 있어요.');return true;}
   await api('logout','POST');app.sync.lock();reload();return true;
  });
  const importLegacy=()=>action(async()=>{
   if(session?.provider!=='google'||!session.hasLegacyAccount)return false;
   if(!confirm('이전에 ChatGPT 계정으로 저장한 기록을 지금 Google 계정에 가져올까요? 이미 있는 같은 장의 기록은 바꾸지 않고, 기존 ChatGPT 기록도 그대로 남깁니다.'))return false;
   if(!await safeToLeave())return false;
   await api('import-legacy','POST',{confirm:true});
   const result=await app.sync.flush();
   if(!result?.loggedIn||!result.connected||result.localErrors||result.pending||result.conflicts){message('가져오기를 요청했지만 동기화를 아직 확인하지 못했어요. 현재 창에서 기록과 저장 상태를 확인해 주세요.',true);return false;}
   message('기존 ChatGPT 기록을 확인했어요. 이미 있는 장은 유지했습니다.');return true;
  });
  function downloadBackup(){
   if(!app?.sync)return;
   backup({records:app.sync.entries(),backups:app.sync.backups(),recoveryDrafts:app.sync.recoveryDrafts?.()||[]});
  }
  async function onAuthChange(){
   if(!firebase)return;
   if(busy){pendingAuthChange=true;return;}
   return action(async()=>{
    const next=await firebase.ready(),current=app.sync.account();
    if(current&&current!==next.account){app.prepareSync?.();app.save?.();app.sync.lock();}
    session=next;
    const connected=next.account&&(app.sync.account()===next.account||await app.connectSync());
    message(connected?'로그인한 Google 계정의 기록을 연결했어요.':next.account?'로그인했어요. 다시 연결을 눌러 기록 연결을 확인해 주세요.':'Google 계정으로 로그인해 기록을 연결해 주세요.');return true;
   });
  }
  return {load,login,logout,importLegacy,downloadBackup,safeToLeave,onAuthChange};
 }
 function mount(win){
  const doc=win.document,$=id=>doc.getElementById(id);
  if(!$('authAccount'))return;
  const app=win.CornellApp;
  const controller=create({request:win.fetch.bind(win),app,firebase:win.YeoFirebaseAuth||null,confirm:win.confirm.bind(win),initialError:new URLSearchParams(win.location.search).get('auth_error'),
   navigate:path=>{const link=doc.createElement('a');link.href=new URL(path,win.location.origin).href;link.target='_top';doc.body.append(link);link.click();link.remove();},
   reload:()=>win.location.reload(),
   backup:data=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=doc.createElement('a');link.href=url;link.download='여백성경-로그인전-기기백업.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);},
   render:({session,busy,notice,unsafe})=>{
    const google=session?.provider==='google';
    $('authAccount').textContent=google?(session.user?.email||session.user?.name||'Google 계정'):session?.provider==='chatgpt'?'ChatGPT 계정 사용 중':'로그인';
    $('authAccount').title=google?(session.user?.email||''):'';
    $('googleLogin').hidden=!session?.googleEnabled||google;
    $('googleLogout').hidden=!google;
    $('importLegacyAccount').hidden=!(google&&session?.hasLegacyAccount);
    $('authRetry').hidden=!!session;
    $('authBackup').hidden=!unsafe;
    $('authNotice').textContent=notice;$('authNotice').hidden=!notice;
    for(const id of ['googleLogin','googleLogout','importLegacyAccount','authRetry'])$(id).disabled=busy;
    $('authBar').setAttribute('aria-busy',String(busy));
   }
  });
  $('googleLogin').addEventListener('click',controller.login);
  $('googleLogout').addEventListener('click',controller.logout);
  $('importLegacyAccount').addEventListener('click',controller.importLegacy);
  $('authRetry').addEventListener('click',controller.load);
  $('authBackup').addEventListener('click',controller.downloadBackup);
  void controller.load().then(()=>{if(win.YeoFirebaseAuth)win.YeoFirebaseAuth.onChange(()=>void controller.onAuthChange());});return controller;
 }
 return {create,mount};
});
