const test=require('node:test'),assert=require('node:assert/strict'),{create}=require('../client/auth-ui.js');
const clean={loggedIn:true,connected:true,localErrors:0,pending:0,conflicts:0};
function harness({provider='chatgpt',enabled=true,legacy=false}={}){
 let owner=provider?'A':null,unsaved=false,editable=true,result=clean,fail=false,allow=true,onFlush=async()=>result;
 let view,requests=[],navigations=[],reloads=0,locks=0,saves=0,prepares=0,backups=[],records=[];
 const sync={account:()=>owner,hasUnsavedRecovery:()=>unsaved,entries:()=>records,backups:()=>[],recoveryDrafts:()=>[],flush:()=>onFlush(),lock:()=>{locks++;owner=null;}};
 const app={sync,canUpdate:()=>editable,prepareSync:()=>prepares++,save:()=>saves++};
 const request=async(path,options)=>{
  requests.push([path,options]);if(fail)throw Error('offline');
  return {ok:true,json:async()=>path.endsWith('/session')?{account:owner,provider,user:provider==='google'?{email:'test@example.invalid',name:'Test'}:null,googleEnabled:enabled,hasLegacyAccount:legacy}:{imported:2,skipped:1,total:3}};
 };
 const c=create({request,app,render:value=>view=value,navigate:path=>navigations.push(path),reload:()=>reloads++,confirm:()=>allow,backup:data=>backups.push(data)});
 return {c,requests,navigations,view:()=>view,stats:()=>({reloads,locks,saves,prepares}),unsaved:v=>unsaved=v,editable:v=>editable=v,
  result:v=>result=v,fail:v=>fail=v,confirm:v=>allow=v,onFlush:fn=>onFlush=fn,records:v=>records=v,backups};
}
test('anonymous login is available only when the server enables Google',async()=>{
 const h=harness({provider:null});await h.c.load();assert.equal(await h.c.login(),true);assert.deepEqual(h.navigations,['/api/auth/google/start']);
 const disabled=harness({provider:null,enabled:false});await disabled.c.load();assert.equal(await disabled.c.login(),false);
 assert.deepEqual(disabled.navigations,[]);assert.match(disabled.view().notice,/준비 중/);
});
test('the current account is saved before Google navigation, with no reload or logout',async()=>{
 const h=harness();await h.c.load();assert.equal(await h.c.login(),true);
 assert.deepEqual(h.stats(),{reloads:0,locks:0,saves:1,prepares:1});assert.deepEqual(h.navigations,['/api/auth/google/start']);
});
test('pending edits, conflicts, quota errors and offline status all prevent account navigation',async()=>{
 for(const rejected of [{pending:1},{conflicts:1},{localErrors:1},{connected:false},{loggedIn:false}]){
  const h=harness();await h.c.load();h.result({...clean,...rejected});assert.equal(await h.c.login(),false);
  assert.equal(h.navigations.length,0);assert.equal(h.view().unsafe,true);assert.match(h.view().notice,/백업/);
 }
});
test('memory-only recovery blocks navigation even when the account was locked',async()=>{
 const h=harness({provider:null});await h.c.load();h.unsaved(true);assert.equal(await h.c.login(),false);
 assert.equal(h.navigations.length,0);assert.match(h.view().notice,/이 창에만/);
});
test('typing or a newer dirty snapshot during flush prevents navigation',async()=>{
 for(const mode of ['typing','dirty']){
  const h=harness();await h.c.load();h.onFlush(async()=>{if(mode==='typing')h.editable(false);else h.records([{dirty:true}]);return clean;});
  assert.equal(await h.c.login(),false);assert.equal(h.navigations.length,0);assert.match(h.view().notice,/입력/);
 }
});
test('logout sends a same-origin POST only after safe save, then locks and reloads',async()=>{
 const h=harness({provider:'google'});await h.c.load();assert.equal(await h.c.logout(),true);
 const [path,options]=h.requests.at(-1);assert.equal(path,'/api/auth/logout');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
 assert.deepEqual(h.stats(),{reloads:1,locks:1,saves:1,prepares:1});
});
test('unsafe logout leaves the session untouched',async()=>{
 const h=harness({provider:'google'});await h.c.load();h.result({...clean,conflicts:1});assert.equal(await h.c.logout(),false);
 assert.equal(h.requests.length,1);assert.equal(h.stats().locks,0);assert.equal(h.stats().reloads,0);
});
test('legacy import is explicit, sends confirm, and checks synchronization without replacing the page',async()=>{
 const h=harness({provider:'google',legacy:true});await h.c.load();h.confirm(false);assert.equal(await h.c.importLegacy(),false);assert.equal(h.requests.length,1);
 h.confirm(true);assert.equal(await h.c.importLegacy(),true);const [path,options]=h.requests.at(-1);
 assert.equal(path,'/api/auth/import-legacy');assert.deepEqual(JSON.parse(options.body),{confirm:true});assert.equal(h.stats().reloads,0);assert.match(h.view().notice,/이미 있는 장은 유지/);
});
test('missing backend does not advertise working Google login or throw',async()=>{
 const h=harness({provider:null});h.fail(true);assert.equal(await h.c.load(),false);assert.equal(h.view().session,null);
 assert.equal(await h.c.login(),false);assert.equal(h.navigations.length,0);
});
test('backup includes local and recovery records without changing them',async()=>{
 const h=harness();await h.c.load();h.records([{id:'PSA23',dirty:true,state:{text:{note:'my local note'}}}]);h.c.downloadBackup();
 assert.equal(h.backups[0].records[0].state.text.note,'my local note');assert.equal(h.navigations.length,0);
});
