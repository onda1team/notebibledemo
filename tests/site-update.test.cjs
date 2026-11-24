const test=require('node:test'),assert=require('node:assert/strict'),{create,valid}=require('../client/site-update.js');
const installed='a'.repeat(64), deployed='b'.repeat(64);
const done={loggedIn:true,connected:true,localErrors:0,pending:0,conflicts:0};
function harness(){
 let time=0,account='A',safe=true,version=installed,marked=null,checks=0,flushes=0,reloads=0,onFlush=async()=>done,markAllowed=true;
 const c=create({current:installed,clock:()=>time,account:()=>account,safe:()=>safe,latest:async()=>{checks++;return version;},
  flush:async()=>{flushes++;return onFlush();},mark:(v,{manual=false}={})=>{if(!markAllowed||(!manual&&marked===v))return false;marked=v;return true;},reload:()=>{reloads++;}});
 return {c,advance:n=>time+=n,owner:v=>account=v,safe:v=>safe=v,latest:v=>version=v,flush:fn=>onFlush=fn,mark:v=>markAllowed=v,target:()=>marked,stats:()=>({checks,flushes,reloads})};
}
test('same or invalid version does not touch data; a different build reloads once after quiet and save',async()=>{
 const h=harness();assert.equal(await h.c.check(),false);h.advance(12000);assert.equal(await h.c.check(),false);
 h.latest('html sign in');assert.equal(valid('html sign in'),false);assert.equal(await h.c.check(),false);
 h.latest(deployed);assert.equal(await h.c.check(),true);assert.equal(await h.c.check(),false);
 assert.deepEqual(h.stats(),{checks:4,flushes:2,reloads:1});
});
test('manual refresh flushes immediately and reloads even when the build is unchanged',async()=>{
 const h=harness();h.c.activity();
 assert.equal(await h.c.manual(),'reloaded');
 assert.equal(h.target(),installed);
 assert.deepEqual(h.stats(),{checks:0,flushes:1,reloads:1});
});
test('manual refresh reports why unsafe, offline, pending or conflicting work stays open',async()=>{
 const h=harness();h.safe(false);assert.equal(await h.c.manual(),'unsafe');
 h.safe(true);h.owner(null);assert.equal(await h.c.manual(),'account');assert.equal(h.stats().flushes,0);h.owner('A');
 for(const [result,why] of [[{conflicts:1},'conflict'],[{connected:false},'offline'],
  [{pending:1},'pending'],[{localErrors:1},'storage'],[{loggedIn:false},'account']]){
  h.flush(async()=>({...done,...result}));assert.equal(await h.c.manual(),why);
 }
 h.flush(async()=>done);h.mark(false);assert.equal(await h.c.manual(),'view');
 assert.equal(h.stats().reloads,0);assert.equal(h.target(),null);
});
test('manual refresh does not race another click or discard new input during a flush',async()=>{
 for(const [during,expected] of [[h=>h.c.activity({type:'input'}),'changed'],
   [h=>h.owner('B'),'changed'],[h=>h.safe(false),'changed'],[h=>h.c.activity({type:'scroll'}),'reloaded']]){
  const h=harness();let unblock,start;
  const started=new Promise(r=>start=r);
  h.flush(async()=>{start();await new Promise(r=>unblock=r);return done;});
  const result=h.c.manual();await started;
  assert.equal(await h.c.manual(),'busy');
  during(h);unblock();
  assert.equal(await result,expected);
  assert.equal(h.stats().reloads,expected==='reloaded'?1:0);
 }
});
test('pending, offline, quota and conflicts never reload the working tab',async()=>{
 const h=harness();h.latest(deployed);h.advance(20000);
 for(const rejected of [{pending:1},{connected:false},{localErrors:1},{conflicts:1},{loggedIn:false}]){
  h.flush(async()=>({...done,...rejected}));assert.equal(await h.c.check(),false);
 }
 assert.equal(h.stats().reloads,0);
});
test('editing or switching accounts while flush is in flight cancels refresh',async()=>{
 const h=harness();h.latest(deployed);h.advance(20000);
 for(const during of [()=>{h.c.activity();h.advance(20000);},()=>h.owner('B'),()=>h.safe(false)]){
  h.safe(true);h.owner('A');
  let unblock,start;const started=new Promise(r=>start=r);
  h.flush(async()=>{start();await new Promise(r=>unblock=r);return done;});
  const result=h.c.check();await started;assert.equal(await h.c.check(),false);
  during();unblock();assert.equal(await result,false);
 }
 assert.equal(h.stats().reloads,0);
});
