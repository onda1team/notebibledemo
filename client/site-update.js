(function(root,factory){
  if(typeof module==='object'&&module.exports){module.exports=factory();return;}
  const tools=factory(),app=root.CornellApp,doc=root.document;
  const current=doc.querySelector('meta[name="yeo-build-version"]')?.content;
  if(!app?.flushForUpdate||!tools.valid(current))return;
  const marker='yeobaek-site-updated-v1',button=doc.getElementById('refreshSite');
  let storage;
  try{storage=root.sessionStorage;storage.getItem(marker);}catch{storage=null;}
  try{
    const receipt=JSON.parse(storage.getItem(marker));
    if(tools.valid(receipt?.source)&&!receipt.seen&&
      (receipt.manual?Number.isFinite(receipt.at)&&Date.now()>=receipt.at&&Date.now()-receipt.at<=120000:receipt.source!==current)){
      storage.setItem(marker,JSON.stringify({source:receipt.source,target:current,seen:true}));
      app.showUpdateReceipt(receipt.view,!!receipt.manual);
    }
  }catch{}
  const updater=tools.create({
    current,clock:()=>Date.now(),
    account:()=>app.sync.account(),safe:()=>!doc.hidden&&doc.hasFocus()&&app.canUpdate(),
    async latest(){
      const result=await root.fetch('/build-version.json',{cache:'no-store',credentials:'same-origin',redirect:'error'});
      return result.ok?(await result.json()).version:null;
    },
    flush:()=>app.flushForUpdate(),
    mark(target,{manual=false}={}){
      try{
        const previous=JSON.parse(storage.getItem(marker));
        if(!manual&&previous?.source===current&&previous.target===target&&!previous.seen&&!previous.manual)return false;
        storage.setItem(marker,JSON.stringify({source:current,target,manual,at:Date.now(),view:app.captureUpdateView()}));
        return true;
      }catch{return false;}
    },
    reload:()=>root.location.reload()
  });
  let manualClick=false;
  for(const type of ['pointerdown','pointerup','keydown','input','compositionstart','compositionend','wheel','scroll','touchstart'])
    root.addEventListener(type,event=>{
      const repeatedLogoClick=manualClick&&button?.contains(event.target)&&
        (['pointerdown','pointerup','touchstart'].includes(type)||(type==='keydown'&&[' ','Enter'].includes(event.key)));
      if(!repeatedLogoClick)updater.activity(event);
    },{capture:true,passive:true});
  button?.addEventListener('click',async()=>{
    if(manualClick)return;
    manualClick=true;button.setAttribute('aria-busy','true');
    app.refreshFeedback('기록을 저장하고 새로고침할 수 있는지 확인하고 있어요.',false,true);
    const result=await updater.manual();
    if(result==='reloaded')return;
    manualClick=false;button.removeAttribute('aria-busy');
    const messages={
      busy:'이미 확인 중이에요. 잠시 뒤 다시 눌러 주세요.',
      account:'로그인을 확인한 뒤 다시 눌러 주세요.',
      unsafe:'편집을 저장하거나 취소하고, 열어 둔 창을 닫은 뒤 다시 눌러 주세요.',
      changed:'화면이나 편집 상태가 바뀌어 새로고침하지 않았어요. 작업을 마치고 다시 눌러 주세요.',
      conflict:'같은 장의 수정이 겹쳐 새로고침하지 않았어요. 양쪽 기록은 ‘내 기록 → 백업 및 복구’에서 확인할 수 있어요.',
      offline:'서버에 연결되지 않아 새로고침하지 않았어요. 연결을 확인해 주세요.',
      pending:'서버에 저장할 기록이 남아 있어 새로고침하지 않았어요. 잠시 뒤 다시 눌러 주세요.',
      storage:'기기 저장을 확인하지 못해 새로고침하지 않았어요. 이 탭을 닫지 말아 주세요.',
      view:'지금 위치를 안전하게 저장하지 못해 새로고침하지 않았어요.'
    };
    app.refreshFeedback(messages[result]||'저장을 확인하지 못해 새로고침하지 않았어요. 이 탭을 닫지 말아 주세요.',true);
  });
  root.setInterval(updater.check,15000);
  root.addEventListener('focus',updater.check);root.addEventListener('online',updater.check);
  doc.addEventListener('visibilitychange',updater.check);
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const valid=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  function create({current,clock,account,safe,latest,flush,mark,reload,quietMs=12000}){
    let last=clock(),serial=0,manualSerial=0,busy=false;
    // A programmatic scroll while applying a remote record is not user input.
    // Pointer, wheel and keyboard activity still interrupt manual refresh.
    function activity(event){last=clock();serial++;if(event?.type!=='scroll')manualSerial++;}
    const idle=()=>clock()-last>=quietMs&&safe();
    function stateOf(r){
      return !r?.loggedIn?'account':r.conflicts?'conflict':r.localErrors?'storage':!r.connected?'offline':r.pending?'pending':null;
    }
    async function check(){
      if(busy||!idle()||!account())return false;
      busy=true;
      try{
        const version=await latest(),owner=account(),pass=serial;
        if(!valid(version)||version===current||!owner||!idle())return false;
        const r=await flush();
        if(stateOf(r))return false;
        if(owner!==account()||pass!==serial||!idle()||!mark(version))return false;
        reload();return true;
      }catch{return false;}
      finally{busy=false;}
    }
    async function manual(){
      if(busy)return 'busy';
      const owner=account(),pass=manualSerial;
      if(!owner)return 'account';
      if(!safe())return 'unsafe';
      busy=true;
      try{
        const rejected=stateOf(await flush());
        if(rejected)return rejected;
        if(owner!==account()||pass!==manualSerial||!safe())return 'changed';
        if(!mark(current,{manual:true}))return 'view';
        reload();return 'reloaded';
      }catch{return 'failed';}
      finally{busy=false;}
    }
    return {activity,check,manual};
  }
  return {create,valid};
});
