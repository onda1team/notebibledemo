const test=require('node:test'),assert=require('node:assert/strict'),{create}=require('../client/sync.js');
const copy=x=>JSON.parse(JSON.stringify(x)),state=t=>({version:2,blocks:['note'],text:{note:t},ink:{note:[],scripture:[]},quotes:[],highlights:[],opaque:{preserved:true}});
function storage(initial={}){const m=new Map(Object.entries(initial));return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),map:m};}
function server(){let uid='A',failure=null,puts=0,gets=0,afterPut=null;const data=new Map();return {data,setUser:v=>uid=v,fail:v=>failure=v,afterPut:fn=>afterPut=fn,get puts(){return puts},get gets(){return gets},async request(path,o={}){if(failure)throw Error(failure);const send=(n,v)=>({status:n,ok:n>=200&&n<300,json:async()=>copy(v)});if(path==='/api/sync/session')return send(200,{account:uid});if(o.headers['X-Yeo-Account']!==uid)return send(409,{error:'account_changed'});if(path.startsWith('/api/sync/chapters?')||path==='/api/sync/chapters')return send(200,{records:[...data].filter(([key])=>key.startsWith(uid+':')).map(([key,r])=>({chapter:key.slice(2),revision:r.revision})),next:null});const id=path.split('/').at(-1),key=uid+':'+id,r=data.get(key);if(o.method==='PUT'){puts++;const b=JSON.parse(o.body);if(b.state.text.note==='too big')return send(413,{error:'chapter_too_large'});if(b.baseRevision!==(r?.revision||0))return send(409,{error:'revision_conflict'});const next={revision:(r?.revision||0)+1,state:copy(b.state)};data.set(key,next);if(afterPut){const fn=afterPut;afterPut=null;await fn();}return send(200,{revision:next.revision});}gets++;return r?send(200,{id,...r}):send(404,{error:'no_record'});}};}
function client(t,s,extra={}){const store=extra.storage||storage();const c=create({storage:store,request:s.request,onStatus:()=>{},...extra});t.after(()=>c.lock());return c;}
test('two device sync preserves full state; clean refresh skips unchanged chapter GETs',async t=>{const s=server(),a=client(t,s),b=client(t,s);await a.start();a.write('PSA23',state('one'));await a.refresh();await b.start();assert.deepEqual(b.read('PSA23'),state('one'));const n=s.gets;await b.refresh();assert.equal(s.gets,n);});
test('chapter PUT advertises bulletin capability and another device receives literal questions and answers',async t=>{
 const s=server(),headers=[],a=client(t,s,{request:(path,options)=>{
   if(options.method==='PUT')headers.push(options.headers);return s.request(path,options);
 }}),b=client(t,s);
 const snapshot={...state('original'),bulletinQuestions:[{id:'a',question:'질문?',answer:'답변\n둘째 줄',reference:'시편 23장'}]};
 snapshot.bulletinBody=[{id:'b',text:'첫 문단\n\n둘째 문단 <본문>',reference:'시편 23장'}];
 await a.start();a.write('PSA23',snapshot);await a.flush();
 assert.equal(headers.length,1);assert.equal(headers[0]['X-Yeo-Bulletin-Questions'],'1');assert.equal(headers[0]['X-Yeo-Record-Trash'],'1');
 assert.equal(headers[0]['X-Yeo-Bulletin-Body'],'1');
 await b.start();assert.deepEqual(b.read('PSA23'),snapshot);
});
test('concurrent edits freeze and keep local and server versions',async t=>{const s=server(),a=client(t,s),b=client(t,s);await a.start();a.write('PSA23',state('base'));await a.refresh();await b.start();a.write('PSA23',state('A edit'));b.write('PSA23',state('B edit'));await a.refresh();await b.refresh();assert.equal(s.data.get('A:PSA23').state.text.note,'A edit');assert.deepEqual(b.conflicts().map(c=>[c.local.text.note,c.remote.text.note]),[['B edit','A edit']]);await b.refresh();assert.equal(b.read('PSA23').text.note,'B edit');});
test('offline writes stay local and resume after connection returns',async t=>{const s=server(),c=client(t,s);await c.start();s.fail('offline');c.write('PSA23',state('offline'));await c.refresh();assert.equal(c.read('PSA23').text.note,'offline');s.fail(null);await c.refresh();assert.equal(s.data.get('A:PSA23').state.text.note,'offline');});
test('ambiguous PUT is read and reconciled before newer local changes go out',async t=>{const s=server(),c=client(t,s);await c.start();c.write('PSA23',state('first'));s.afterPut(async()=>{c.write('PSA23',state('second'));throw Error('timeout');});await c.refresh();assert.equal(c.read('PSA23').text.note,'second');await c.refresh();assert.equal(s.data.get('A:PSA23').state.text.note,'second');assert.equal(s.data.get('A:PSA23').revision,2);});
test('legacy keys untouched; explicit import does not overwrite cloud record',async t=>{const s=server(),st=storage({'yeobaek-paper-v3:PSA23':JSON.stringify(state('legacy'))}),c=client(t,s,{storage:st});s.data.set('A:PSA23',{revision:1,state:state('cloud')});await c.start();await c.importRecords([{id:'PSA23',state:state('legacy')}]);assert.equal(s.data.get('A:PSA23').state.text.note,'cloud');assert.equal(JSON.parse(st.getItem('yeobaek-paper-v3:PSA23')).text.note,'legacy');assert.ok(c.backups().some(x=>x.data.text?.note==='legacy'));});
test('account switch locks, clears state, and never submits old-account data',async t=>{const s=server(),c=client(t,s);await c.start();c.write('PSA23',state('A private'));s.setUser('B');await c.refresh();assert.equal(c.account(),null);assert.equal(c.hasUnsavedRecovery(),false);assert.equal(c.read('PSA23'),null);assert.equal(s.puts,0);await c.start();assert.equal(c.account(),'B');assert.equal(c.read('PSA23'),null);});
test('remote revision changing before resolution aborts choice',async t=>{const s=server(),c=client(t,s);await c.start();c.write('PSA23',state('local'));s.data.set('A:PSA23',{revision:1,state:state('remote')});await c.refresh();s.data.set('A:PSA23',{revision:2,state:state('even newer')});await assert.rejects(c.resolve('PSA23','local'),/conflict_changed/);assert.equal(s.data.get('A:PSA23').state.text.note,'even newer');assert.equal(c.conflicts()[0].remote.text.note,'even newer');});
test('oversized chapter does not starve another chapter',async t=>{const s=server(),c=client(t,s);await c.start();c.write('PSA23',state('too big'));c.write('JHN15',state('valid'));await c.refresh();assert.equal(s.data.get('A:JHN15').state.text.note,'valid');assert.equal(c.read('PSA23').text.note,'too big');assert.match(c.status(),/기록이 커서/);});
test('remote reload waits while the writing surface is busy',async t=>{const s=server();let can=false;const c=client(t,s,{canApply:()=>can});s.data.set('A:PSA23',{revision:1,state:state('cloud')});await c.start();assert.equal(c.read('PSA23'),null);can=true;await c.refresh();assert.equal(c.read('PSA23').text.note,'cloud');});

test('quota failure keeps dirty in memory and cannot be overwritten by remote',async t=>{const s=server(),st=storage(),c=client(t,s,{storage:st});await c.start();st.setItem=()=>{throw Error('quota')};c.write('PSA23',state('unsaved'));assert.equal(c.read('PSA23').text.note,'unsaved');s.fail('offline');await c.refresh();assert.match(c.status(),/기기 저장 실패/);s.fail(null);s.data.set('A:PSA23',{revision:1,state:state('remote')});await c.refresh();assert.equal(c.read('PSA23').text.note,'unsaved');assert.equal(c.conflicts()[0].remote.text.note,'remote');});
test('acknowledged own transient draft is removed only after success',async t=>{const s=server(),st=storage(),c=client(t,s,{storage:st});await c.start();c.write('PSA23',state('draft'));assert.ok([...st.map.keys()].some(k=>k.includes(':draft:')));await c.refresh();assert.equal([...st.map.keys()].filter(k=>k.includes(':draft:')).length,0);assert.equal(c.read('PSA23').text.note,'draft');});
test('manual save sends pending edits from all opened chapters, and leaves empty or clean records alone',async t=>{
 const s=server(),c=client(t,s);await c.start();
 assert.deepEqual(await c.flush(),{loggedIn:true,connected:true,total:0,localErrors:0,pending:0,conflicts:0});
 assert.equal(s.puts,0);
 c.write('PSA23',state('first'));c.write('JHN15',state('second'));
 assert.deepEqual(await c.flush(),{loggedIn:true,connected:true,total:2,localErrors:0,pending:0,conflicts:0});
 assert.equal(s.puts,2);assert.equal(s.data.get('A:JHN15').state.text.note,'second');
 await c.flush();assert.equal(s.puts,2);
});
test('manual save waits for an active autosave and confirms newest edits before reporting success',async t=>{
 const s=server(),c=client(t,s);await c.start();c.write('PSA23',state('older'));
 let finish,started;const waiting=new Promise(r=>finish=r),began=new Promise(r=>started=r);
 s.afterPut(async()=>{started();await waiting;});
 const auto=c.refresh();await began;const manual=c.flush();
 c.write('PSA23',state('newest'));finish();await auto;
 const r=await manual;assert.equal(r.connected,true);assert.equal(r.pending,0);
 assert.equal(s.data.get('A:PSA23').state.text.note,'newest');assert.equal(s.puts,2);
});
test('manual result distinguishes offline, storage error, conflict, and account lock',async t=>{
 const s=server(),st=storage(),c=client(t,s,{storage:st});await c.start();
 s.fail('offline');c.write('PSA23',state('local'));let r=await c.flush();
 assert.equal(r.connected,false);assert.equal(r.localErrors,0);assert.equal(r.pending,1);
 const write=st.setItem;st.setItem=()=>{throw Error('quota');};
 c.write('JHN15',state('other local'));r=await c.flush();
 assert.equal(r.localErrors,1);assert.equal(r.pending,2);st.setItem=write;
 s.fail(null);s.data.set('A:PSA23',{revision:1,state:state('other device')});r=await c.flush();
 assert.equal(r.conflicts,1);assert.equal(r.localErrors,0);assert.equal(r.pending,0);
 assert.equal(c.conflicts()[0].local.text.note,'local');assert.equal(s.data.get('A:PSA23').state.text.note,'other device');
 s.setUser('B');assert.deepEqual(await c.flush(),{loggedIn:false});
});

test('a phone bulletin is pulled by an already-open laptop without replacing other chapters or existing answers',async t=>{
 const s=server(),phone=client(t,s),arrivals=[],laptop=client(t,s,{onChange:id=>arrivals.push(id)});
 const existing={...state('노트북 필기'),bulletinQuestions:[{id:'old',question:'이전 질문?',answer:'기존 답',reference:'시편 23편'}]};
 await phone.start();phone.write('PSA23',existing);phone.write('JHN15',state('다른 장'));await phone.flush();
 await laptop.start();arrivals.length=0;
 const added={...existing,bulletinBody:[{id:'body',text:'교회 주보 원문',reference:'시편 23편 2–4절'}],
  bulletinQuestions:[...existing.bulletinQuestions,{id:'new',question:'새 질문?',answer:'',reference:'시편 23편 2–4절'}]};
 phone.write('PSA23',added);assert.equal((await phone.flush()).pending,0);
 assert.equal(laptop.read('PSA23').bulletinBody,undefined);
 await laptop.refresh();
 assert.deepEqual(arrivals,['PSA23']);assert.deepEqual(laptop.read('PSA23'),added);
 assert.equal(laptop.read('JHN15').text.note,'다른 장');
});

test('overlapping notes remain intact with the server bulletin after a genuine same-chapter conflict',async t=>{
 const s=server(),phone=client(t,s),laptop=client(t,s),base=state('기존 필기');
 await phone.start();phone.write('PSA23',base);await phone.flush();await laptop.start();
 const bulletin={...base,text:{note:'휴대폰에서 바꾼 노트'},bulletinBody:[{id:'body',text:'새 주보',reference:'시편 23편'}]};
 laptop.write('PSA23',state('아직 보내지 않은 노트북 필기'));
 phone.write('PSA23',bulletin);await phone.flush();await laptop.refresh();
 const [conflict]=laptop.conflicts();
 assert.equal(conflict.local.text.note,'아직 보내지 않은 노트북 필기');
 assert.deepEqual(conflict.remote,bulletin);
 assert.deepEqual(s.data.get('A:PSA23').state,bulletin);
});
test('independent title, notes and bulletin edits combine in both send orders, without losing old answers',async t=>{
 const id='PSA23',key='A:'+id;
 for(const first of ['phone','laptop']){
  const s=server(),phone=client(t,s),arrived=[],laptop=client(t,s,{onChange:id=>arrived.push(id)});
  const oldQuestion={id:'old',question:'기존 질문?',answer:'기존 답변',reference:'시편 23편'};
  const initial={...state('원본'),bulletinQuestions:[oldQuestion],updatedAt:100};
  s.data.set(key,{revision:1,state:initial});
  await phone.start();await laptop.start();arrived.length=0;
  const phoneState={...initial,bulletinBody:[{id:'new',text:'새 주보\n\n둘째 문단',reference:'시편 23편'}],updatedAt:200};
  const laptopState={...initial,recordTitle:'새신자교육4회차',text:{note:'바꾼 여백'},ink:{note:[{mode:'pen',points:[{x:.2,y:.4}]}]},updatedAt:300};
  phone.write(id,phoneState);laptop.write(id,laptopState);
  await(first==='phone'?phone:laptop).refresh();
  await(first==='phone'?laptop:phone).refresh();
  const expected={...laptopState,bulletinBody:phoneState.bulletinBody};
  assert.deepEqual(s.data.get(key),{state:expected,revision:3});
  await Promise.all([phone.refresh(),laptop.refresh()]);
  assert.deepEqual(phone.read(id),expected);assert.deepEqual(laptop.read(id),expected);
  assert.deepEqual(phone.conflicts(),[]);assert.deepEqual(laptop.conflicts(),[]);
  assert.deepEqual(arrived,[id]);assert.equal(s.puts,2);
 }
});
test('simultaneous PUT CAS loser rebases safely and merges on either winning device',async t=>{
 const id='PSA23',key='A:'+id;
 for(const winner of ['phone','laptop']){
  const s=server();let open,arrivals=0,releaseLoser;
  const both=new Promise(resolve=>open=resolve),firstWritten=new Promise(resolve=>releaseLoser=resolve);
  const base=state('원본');
  s.data.set(key,{revision:1,state:base});
  const device=name=>client(t,s,{request:async(path,opts)=>{
   if(opts.method==='PUT'&&JSON.parse(opts.body).baseRevision===1){
    if(++arrivals===2)open();await both;
    if(name!==winner)await firstWritten;
    try{return await s.request(path,opts);}
    finally{if(name===winner)releaseLoser();}
   }
   return s.request(path,opts);
  }});
  const phone=device('phone'),laptop=device('laptop');
  await phone.start();await laptop.start();
  const added={...base,bulletinBody:[{id:'b',text:'새 주보',reference:''}]};
  const edited={...base,recordTitle:'병합 제목',text:{note:'노트북 필기'}};
  phone.write(id,added);laptop.write(id,edited);
  await Promise.all([phone.refresh(),laptop.refresh()]);
  const combined={...edited,bulletinBody:added.bulletinBody};
  assert.deepEqual(s.data.get(key),{revision:3,state:combined});
  await Promise.all([phone.refresh(),laptop.refresh()]);
  for(const c of [phone,laptop]){
   assert.deepEqual(c.read(id),combined);assert.deepEqual(c.conflicts(),[]);
   assert.equal(c.entries()[0].pending,undefined);
  }
  assert.equal(arrivals,2);assert.equal(s.puts,3);
 }
});
test('independent cached edits wait for the editor, then combine using the persisted compact base',async t=>{
 const s=server(),st=storage(),id='PSA23',key='A:'+id,old=client(t,s,{storage:st});
 const initial=state('원본');s.data.set(key,{revision:1,state:initial});
 await old.start();s.fail('offline');
 const draft={...initial,recordTitle:'내 제목'};old.write(id,draft);
 // Wait until the browser has persisted the asynchronous fingerprint, not the source snapshot.
 for(let i=0;i<40&&!old.entries()[0]?.mergeBase?.fields;i++)await new Promise(r=>setTimeout(r,2));
 const stored=JSON.parse(st.getItem('yeobaek-cloud-v1:A:'+id));
 assert.deepEqual(Object.keys(stored.mergeBase).sort(),['fields','revision']);
 assert.equal(JSON.stringify(stored.mergeBase).includes('원본'),false);
 assert.ok(Object.values(stored.mergeBase.fields).every(v=>/^[0-9a-f]{64}$/.test(v)));
 old.lock();s.fail(null);
 const remote={...initial,bulletinBody:[{id:'b',text:'서버 주보',reference:''}]};
 s.data.set(key,{revision:2,state:remote});let busy=true,notified=0;
 const reopened=client(t,s,{storage:st,canApply:()=>!busy,onChange:()=>notified++});
 await reopened.start();
 assert.equal(reopened.hasDeferred(),true);assert.equal(s.puts,0);assert.deepEqual(reopened.read(id),draft);
 busy=false;await reopened.refresh();
 assert.equal(notified,1);assert.equal(reopened.hasDeferred(),false);assert.equal(s.puts,1);
 assert.deepEqual(reopened.read(id),{...remote,recordTitle:'내 제목'});
});
test('old cached drafts without a verified base and changes to opaque or trashed data stay separate',async t=>{
 const id='PSA23',key='A:'+id,initial=state('원본');
 for(const mode of ['old','old-conflict','opaque','trash','coupled','title']){
  const s=server(),local={...initial,recordTitle:'기기 제목'},remote={...initial,bulletinBody:[{id:'b',text:'주보',reference:''}]};
  if(mode==='opaque')remote.opaque={unrecognized:'value'};
  if(mode==='trash')remote.trashedAt=232;
  if(mode==='coupled')local.bulletinQuestions=[{id:'q',question:'질문?',answer:'답변',reference:''}];
  if(mode==='title')remote.recordTitle='서버 제목';
  const cached={revision:1,state:local,dirty:true};
  if(mode==='old-conflict')cached.conflict={revision:2,state:remote};
  const st=/^old/.test(mode)?storage({['yeobaek-cloud-v1:A:'+id]:JSON.stringify(cached)}):storage();
  const c=client(t,s,{storage:st});s.data.set(key,{revision:1,state:initial});
  if(/^old/.test(mode)){s.data.set(key,{revision:2,state:remote});await c.start();}
  else{await c.start();c.write(id,local);s.data.set(key,{revision:2,state:remote});}
  await c.refresh();assert.equal(s.puts,0,mode);
  assert.deepEqual(c.conflicts(),[{id,revision:2,local,remote}],mode);
 }
});

test('incoming phone bulletin waits during laptop input without falsely reporting that sync is complete',async t=>{
 const s=server(),phone=client(t,s),arrivals=[];let editing=false;
 const laptop=client(t,s,{canApply:id=>id!=='PSA23'||!editing,onChange:id=>arrivals.push(id)});
 const original=state('기존 기록');
 await phone.start();phone.write('PSA23',original);await phone.flush();await laptop.start();
 editing=true;arrivals.length=0;
 const newer={...original,bulletinBody:[{id:'body',text:'휴대폰에서 저장한 주보',reference:'시편 23편'}]};
 phone.write('PSA23',newer);
 assert.equal(phone.chapterSyncState('PSA23'),'pending');
 await phone.flush();assert.equal(phone.chapterSyncState('PSA23'),'confirmed');
 await laptop.refresh();
 assert.equal(laptop.hasDeferred(),true);assert.match(laptop.status(),/다른 기기 변경이 있어요/);
 assert.deepEqual(laptop.read('PSA23'),original);assert.deepEqual(arrivals,[]);
 editing=false;await laptop.refresh();
 assert.deepEqual(arrivals,['PSA23']);assert.deepEqual(laptop.read('PSA23'),newer);
 assert.equal(laptop.hasDeferred(),false);assert.equal(laptop.status(),'자동 동기화 완료');
});
test('sending only a conflicting title preserves both chapters and leaves divergent content unresolved',async t=>{
 const s=server(),target='A:2TI3',id='2TI3',c=client(t,s),reader=client(t,s);
 const remote={...state('remote notes'),updatedAt:100,recordTitle:'이전 제목',
  bulletinBody:[{id:'body',text:'원래 주보\n\n두 번째 문단',reference:'디모데후서 3장'}],
  bulletinQuestions:[{id:'q',question:'질문?',answer:'서버 답',reference:''}]};
 const local={...state('unsynced laptop notes'),updatedAt:200,recordTitle:'새신자교육4회차',verseRange:{start:1,end:4}};
 s.data.set(target,{revision:1,state:state('baseline')});
 await c.start();c.write(id,local);
 s.data.set(target,{revision:2,state:remote});await c.refresh();
 const selected=c.conflicts()[0];assert.equal(selected.revision,2);
 assert.equal(await c.sendConflictTitle(id,{title:local.recordTitle,revision:selected.revision}),true);
 const expected={...remote,recordTitle:local.recordTitle};
 assert.deepEqual(s.data.get(target),{revision:3,state:expected});
 assert.deepEqual(c.read(id),local);
 assert.deepEqual(c.conflicts(),[{id,revision:3,local,remote:expected}]);
 assert.deepEqual(c.backups().find(a=>a.key.includes(':backup:')).data.local,local);
 assert.deepEqual(c.backups().find(a=>a.key.includes(':backup:')).data.remote,remote);
 await reader.start();assert.deepEqual(reader.read(id),expected);
 await c.refresh();assert.equal(s.puts,1);assert.equal(c.chapterSyncState(id),'conflict');
});
test('title-only send rejects changed/missing/trashed, unsafe or unbacked originals without a PUT',async t=>{
 const id='2TI3',key='A:'+id;
 for(const mode of ['stale','missing','trashed','unsafe','quota']){
  const s=server(),storageArea=storage();let safe=true;
  const c=client(t,s,{storage:storageArea,canApply:()=>safe}),local={...state('local'),recordTitle:'내 제목'};
  await c.start();c.write(id,local);
  s.data.set(key,{revision:1,state:{...state('server'),...(mode==='trashed'?{trashedAt:100}:{})}});await c.refresh();
  const {revision}=c.conflicts()[0];
  if(mode==='stale')s.data.set(key,{revision:2,state:state('newer server')});
  if(mode==='missing')s.data.delete(key);
  if(mode==='unsafe')safe=false;
  if(mode==='quota')storageArea.setItem=()=>{throw Error('quota');};
  await assert.rejects(c.sendConflictTitle(id,{title:local.recordTitle,revision}),/conflict_changed|no_title|editing_in_progress|backup_failed/);
  assert.equal(s.puts,0);assert.deepEqual(c.read(id),local);
 }
});
test('title-only send loses a concurrent revision CAS without replacing the newer server chapter',async t=>{
 const s=server(),id='2TI3',key='A:'+id;let race=true;
 const latest={...state('concurrent chapter'),updatedAt:900,recordTitle:'더 최신 제목'};
 const c=client(t,s,{request:(path,opts)=>{
   if(race&&opts.method==='PUT'){race=false;s.data.set(key,{revision:2,state:latest});}
   return s.request(path,opts);
 }});
 await c.start();
 const local={...state('local'),recordTitle:'내 제목'};c.write(id,local);
 s.data.set(key,{revision:1,state:state('server')});await c.refresh();
 await assert.rejects(c.sendConflictTitle(id,{title:local.recordTitle,revision:1}),/conflict_changed/);
 assert.deepEqual(s.data.get(key),{revision:2,state:latest});
 assert.deepEqual(c.conflicts(),[{id,revision:2,local,remote:latest}]);
});

test('a journal survives a partial quota failure and is recovered before server refresh after restart',async t=>{
 const s=server(),st=storage(),c=client(t,s,{storage:st});
 await c.start();c.write('PSA23',state('confirmed'));await c.flush();
 const set=st.setItem;st.setItem=(key,value)=>{if(!key.includes(':draft:'))throw Error('quota');set(key,value);};
 assert.equal(c.write('PSA23',state('latest MacBook notes')),false);
 assert.equal(JSON.parse(st.getItem('yeobaek-cloud-v1:A:PSA23')).state.text.note,'confirmed');
 c.lock();st.setItem=set;
 const reopened=client(t,s,{storage:st});await reopened.start();
 assert.equal(reopened.read('PSA23').text.note,'latest MacBook notes');
 assert.equal(s.data.get('A:PSA23').state.text.note,'latest MacBook notes');
 assert.equal(reopened.chapterSyncState('PSA23'),'confirmed');
 assert.deepEqual(reopened.recoveryDrafts(),[]);
 assert.equal([...st.map.keys()].filter(k=>k.includes(':draft:')).length,0);
});
test('a recovered journal keeps a newer remote edit in conflict instead of overwriting it',async t=>{
 const s=server(),st=storage(),c=client(t,s,{storage:st});
 s.data.set('A:PSA23',{revision:1,state:state('base')});await c.start();
 const set=st.setItem;st.setItem=(key,value)=>{if(!key.includes(':draft:'))throw Error('quota');set(key,value);};
 c.write('PSA23',state('local latest'));c.lock();st.setItem=set;
 s.data.set('A:PSA23',{revision:2,state:state('remote latest')});
 const reopened=client(t,s,{storage:st});await reopened.start();
 assert.equal(reopened.read('PSA23').text.note,'local latest');
 assert.equal(reopened.conflicts()[0].remote.text.note,'remote latest');
 assert.equal(s.data.get('A:PSA23').state.text.note,'remote latest');
});
test('unknown legacy journals are visible recovery choices, not automatic cloud writes',async t=>{
 const s=server(),st=storage({'yeobaek-cloud-v1:A:PSA23:draft:old':JSON.stringify({id:'PSA23',state:state('unversioned notes'),at:10})});
 s.data.set('A:PSA23',{revision:3,state:state('server notes')});
 const c=client(t,s,{storage:st});await c.start();
 assert.equal(c.read('PSA23').text.note,'server notes');assert.equal(s.puts,0);
 const [draft]=c.recoveryDrafts();assert.equal(draft.state.text.note,'unversioned notes');
 assert.match(c.status(),/복구할 기기 초안/);
 await c.restoreDraft(draft.key);
 assert.equal(c.read('PSA23').text.note,'unversioned notes');assert.equal(s.puts,0);
 assert.equal(c.conflicts()[0].remote.text.note,'server notes');
 assert.ok(c.backups().some(b=>b.data.recovered?.text.note==='unversioned notes'));
 await c.resolve('PSA23','local');assert.equal(s.data.get('A:PSA23').state.text.note,'unversioned notes');
});
test('canonical dirty edits and another writer journal both remain recoverable',async t=>{
 const s=server(),st=storage({
  'yeobaek-cloud-v1:A:PSA23':JSON.stringify({revision:1,state:state('canonical draft'),dirty:true}),
  'yeobaek-cloud-v1:A:PSA23:draft:other':JSON.stringify({format:2,id:'PSA23',revision:1,state:state('other tab draft'),dirty:true,at:20})
 });
 s.fail('offline');const c=client(t,s,{storage:st});s.fail(null);
 s.data.set('A:PSA23',{revision:2,state:state('remote')});await c.start();
 assert.equal(c.read('PSA23').text.note,'canonical draft');
 assert.equal(c.recoveryDrafts()[0].state.text.note,'other tab draft');assert.equal(s.puts,0);
});
test('memory-only edits survive account lock in the same session without leaking to another account',async t=>{
 const s=server(),st=storage(),c=client(t,s,{storage:st});await c.start();
 const set=st.setItem;st.setItem=()=>{throw Error('quota');};
 assert.equal(c.write('PSA23',state('A memory only')),false);assert.equal(c.hasUnsavedRecovery(),true);
 s.setUser('B');await c.refresh();assert.equal(c.account(),null);assert.equal(c.hasUnsavedRecovery(),true);
 st.setItem=set;await c.start();assert.equal(c.account(),'B');
 assert.equal(c.read('PSA23'),null);assert.deepEqual(c.recoveryDrafts(),[]);assert.deepEqual(c.backups(),[]);
 s.setUser('A');await c.refresh();await c.start();
 assert.equal(c.read('PSA23').text.note,'A memory only');
 assert.equal(s.data.get('A:PSA23').state.text.note,'A memory only');
 assert.equal(s.data.has('B:PSA23'),false);assert.equal(c.hasUnsavedRecovery(),false);
});
test('same-state write retries local quota failure and returns explicit durable status',async t=>{
 const s=server(),st=storage(),c=client(t,s,{storage:st});await c.start();
 const set=st.setItem,latest=state('latest');st.setItem=()=>{throw Error('quota');};
 assert.equal(c.write('PSA23',latest),false);assert.equal(c.write('PSA23',latest),false);
 st.setItem=set;assert.equal(c.write('PSA23',latest),true);
 assert.equal(JSON.parse(st.getItem('yeobaek-cloud-v1:A:PSA23')).state.text.note,'latest');
});
test('matching server content clears a prior conflict and resumes future uploads',async t=>{
 const s=server(),c=client(t,s);await c.start();c.write('PSA23',state('local'));
 s.data.set('A:PSA23',{revision:1,state:state('remote')});await c.refresh();
 assert.equal(c.conflicts().length,1);
 s.data.set('A:PSA23',{revision:2,state:state('local')});await c.refresh();
 assert.equal(c.conflicts().length,0);assert.equal(c.chapterSyncState('PSA23'),'confirmed');
 c.write('PSA23',state('next edit'));await c.flush();
 assert.equal(s.data.get('A:PSA23').state.text.note,'next edit');
});
test('choosing the backed-up remote version retires an old held-memory draft on reconnect',async t=>{
 const s=server(),st=storage(),c=client(t,s,{storage:st});await c.start();
 const set=st.setItem;st.setItem=()=>{throw Error('quota');};
 c.write('PSA23',state('held old local'));c.lock();st.setItem=set;
 s.data.set('A:PSA23',{revision:1,state:state('chosen server')});await c.start();
 assert.equal(c.conflicts().length,1);await c.resolve('PSA23','remote');c.lock();await c.start();
 assert.equal(c.read('PSA23').text.note,'chosen server');
 assert.equal(c.recoveryDrafts().some(d=>d.key.endsWith(':memory')),false);
 assert.ok(c.backups().some(b=>b.data.local?.text.note==='held old local'));
});
