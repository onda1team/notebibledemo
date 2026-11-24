const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.textContent='';this.style={};this.disabled=false;this.open=false;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(){}
  hasChildNodes(){return !!this.children.length;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  click(){return this.listeners.click?.();}
  showModal(){this.open=true;}
  close(){this.open=false;}
 }
 const ids=new Map(),get=id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);};
 let conflicts=[{id:'PSA23',revision:2,local:{recordTitle:'내 제목',text:{note:'맥북에서 쓴 설교 필기'},ink:{note:[{points:[]}]},quotes:[],bulletinBody:[],bulletinQuestions:[]},remote:{recordTitle:'서버 제목',text:{note:'아이폰 메모'},ink:{note:[]},quotes:[],bulletinBody:[],bulletinQuestions:[]}}];
 let confirmResult=true,confirmation='',reason=null,after='confirmed',calls=[],refreshes=0,drafts=[],restores=[],connections=0;
 const copy=value=>JSON.parse(JSON.stringify(value));
 const sync={account:()=> 'A',status:()=> '변경이 겹쳐요',conflicts:()=>copy(conflicts),entries:()=>[],backups:()=>[],
  recoveryDrafts:()=>copy(drafts),restoreDraft:async key=>{restores.push(key);if(reason)throw Error(reason);drafts=[];},
  chapterSyncState:()=>after,refresh:async()=>{refreshes++},resolve:async(id,choice)=>{calls.push([id,choice]);if(reason)throw Error(reason);if(after==='confirmed')conflicts=[];}};
 const app={sync,bible:{byId:()=>({label:'시편 23장'})},prepareSync(){},connectSync:()=>{connections++;return connections===1?new Promise(()=>{}):Promise.resolve(true);},needsReconnect:()=>false};
 const document={hidden:false,getElementById:get,createElement:tag=>new Element(tag),addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../client/sync-ui.js'),'utf8'),{
  window:{CornellApp:app,addEventListener(){}},document,localStorage:{length:0},navigator:{onLine:true},setInterval(){},setTimeout(){},
  confirm:message=>{confirmation=message;return confirmResult;},Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL(){}},console
 });
 const all=()=>{const walk=node=>[node,...node.children.flatMap(walk)];return walk(get('syncConflicts'));};
 return {open:()=>get('openRecovery').click(),button:label=>all().find(n=>n.tag==='button'&&n.textContent===label),
  contents:()=>all().map(n=>n.textContent).join('\n'),summary:()=>get('syncSummary').textContent,calls,restores,drafts:value=>drafts=value,reconnect:()=>get('reconnectSync').click(),connections:()=>connections,
  confirm:v=>confirmResult=v,confirmation:()=>confirmation,error:v=>reason=v,after:v=>after=v,update:fn=>fn(conflicts)};
}
test('conflict comparison shows actual laptop text and ink count; cancel never selects a record',async()=>{
 const h=harness();h.open();assert.match(h.contents(),/맥북에서 쓴 설교 필기/);assert.match(h.contents(),/아이폰 메모/);assert.match(h.contents(),/손글씨 1획/);
 assert.ok(h.button('두 기록 백업'));h.confirm(false);await h.button('이 기기 기록으로 서버 저장').click();
 assert.equal(h.calls.length,0);assert.match(h.confirmation(),/기록 전체/);assert.match(h.confirmation(),/백업/);
});
test('explicit choice invokes the backed-up resolver and reports confirmed result',async()=>{
 for(const [label,choice] of [['이 기기 기록으로 서버 저장','local'],['서버 기록 사용','remote']]){
  const h=harness();h.open();await h.button(label).click();assert.deepEqual(h.calls,[['PSA23',choice]]);
  assert.match(h.contents(),/겹친 기록이 없습니다/);assert.match(h.summary(),choice==='local'?/서버에 저장/:/서버 기록/);
 }
});
test('stale visible content cannot approve a different version even when counts and titles match',async()=>{
 const h=harness();h.open();const button=h.button('이 기기 기록으로 서버 저장');
 h.update(items=>items[0].local.text.note='같은 길이인 다른 필기');await button.click();
 assert.equal(h.calls.length,0);assert.match(h.summary(),/다시 확인/);assert.match(h.contents(),/같은 길이인 다른 필기/);
});
test('busy, editing and backup errors keep both choices available with specific feedback',async()=>{
 for(const [reason,expected] of [['busy',/잠시 후/],['editing_in_progress',/입력 중/],['backup_failed',/백업하지 못해 변경하지/],['conflict_changed',/다른 기기의 기록/]]){
  const h=harness();h.error(reason);h.open();await h.button('서버 기록 사용').click();
  assert.match(h.summary(),expected);assert.equal(h.button('서버 기록 사용').disabled,false);assert.ok(h.button('두 기록 백업'));
 }
});
test('a queued or conflicting result is never described as server save success',async()=>{
 for(const after of ['pending','conflict','local-error']){
  const h=harness();h.after(after);h.open();await h.button('이 기기 기록으로 서버 저장').click();
  assert.doesNotMatch(h.summary(),/서버에 저장했어요/);assert.ok(h.button('두 기록 백업'));
 }
});
test('recovery drafts are visible without automatic selection and restoring requires explicit consent',async()=>{
 const h=harness();h.drafts([{key:'draft-1',id:'JHN3',state:{text:{note:'복구할 맥북 필기'}}}]);h.open();
 assert.match(h.contents(),/복구할 맥북 필기/);assert.ok(h.button('초안 내려받기'));assert.equal(h.restores.length,0);
 h.confirm(false);await h.button('이 초안 복원').click();assert.equal(h.restores.length,0);
 h.confirm(true);await h.button('이 초안 복원').click();assert.deepEqual(h.restores,['draft-1']);
 assert.equal(h.calls.length,0);assert.match(h.summary(),/비교한 뒤/);assert.match(h.confirmation(),/서버에는 아직 저장하지/);
});
test('backup failure keeps recovery draft visible and never claims successful restoration',async()=>{
 const h=harness();h.drafts([{key:'draft-1',id:'JHN3',state:{text:{note:'복구할 맥북 필기'}}}]);h.error('backup_failed');h.open();
 await h.button('이 초안 복원').click();assert.match(h.summary(),/복원하지 않았/);assert.ok(h.button('초안 내려받기'));assert.equal(h.button('이 초안 복원').disabled,false);
});
test('explicit reconnect restarts the account connection without reloading the page',async()=>{
 const h=harness();assert.equal(h.connections(),1);await h.reconnect();assert.equal(h.connections(),2);
 assert.match(h.contents(),/맥북에서 쓴 설교 필기/);
});
