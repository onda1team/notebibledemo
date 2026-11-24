import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFirebaseRequest} from '../client/firebase-sync-core.mjs';
const {create}=createRequire(import.meta.url)('../client/sync.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const state=text=>({version:2,blocks:['note'],text:{note:text},ink:{note:[]},quotes:[],highlights:[]});
function storage(){const map=new Map();return {get length(){return map.size},key:index=>[...map.keys()][index],getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
function server(){
 const rows=new Map();
 const operations={
  read:async(uid,id)=>copy(rows.get(uid+'/'+id)||null),
  list:async(uid,after,count)=>[...rows].filter(([key])=>key.startsWith(uid+'/')&&key.split('/')[1]>after).sort(([a],[b])=>a<b?-1:1).slice(0,count).map(([key,row])=>({id:key.split('/')[1],...copy(row)})),
  compareAndSet:async(uid,id,revision,stateJSON,unchanged)=>{
   unchanged();const key=uid+'/'+id,current=rows.get(key),actual=current?.revision||0;
   if(actual!==revision)return {conflict:true,revision:actual};
   rows.set(key,{formatVersion:2,revision:revision+1,stateJSON,updatedAt:100});
   return {revision:revision+1};
  }
 };
 const device=(uid,extras={})=>{
  let user=uid?{uid}:null;
  return {setUser:uid=>user=uid?{uid}:null,request:createFirebaseRequest({ready:async()=>{},getUser:()=>user,...operations,...extras})};
 };
 return {rows,device,operations};
}
const put=(api,id,revision,snapshot,account='firebase:A')=>api('/api/sync/chapters/'+id,{method:'PUT',headers:{'X-Yeo-Account':account},body:JSON.stringify({baseRevision:revision,state:snapshot})});
const get=(api,id,account='firebase:A')=>api('/api/sync/chapters/'+id,{headers:{'X-Yeo-Account':account}});

test('Firebase adapter preserves the existing full sync flow between two devices',async t=>{
 const backend=server(),a=backend.device('A'),b=backend.device('A');
 const laptop=create({storage:storage(),request:a.request}),phone=create({storage:storage(),request:b.request});
 t.after(()=>{laptop.lock();phone.lock();});
 await laptop.start();laptop.write('PSA23',state('맥북 전체 필기'));await laptop.flush();await phone.start();
 assert.equal(laptop.account(),'firebase:A');assert.deepEqual(phone.read('PSA23'),state('맥북 전체 필기'));
 laptop.write('PSA23',state('맥북 추가 필기'));phone.write('PSA23',state('휴대폰 별도 수정'));
 await laptop.flush();await phone.flush();
 assert.deepEqual(phone.conflicts().map(c=>[c.local.text.note,c.remote.text.note]),[['휴대폰 별도 수정','맥북 추가 필기']]);
 assert.equal(JSON.parse(backend.rows.get('A/PSA23').stateJSON).text.note,'맥북 추가 필기');
});
test('Firebase session and every record operation remain bound to the current UID',async()=>{
 const backend=server(),a=backend.device('A'),b=backend.device('B'),anonymous=backend.device(null);
 assert.equal((await anonymous.request('/api/sync/session')).status,401);
 assert.equal((await put(a.request,'PSA23',0,state('private A'))).status,200);
 assert.equal((await get(b.request,'PSA23','firebase:B')).status,404);
 assert.equal((await get(b.request,'PSA23','firebase:A')).status,409);
 assert.equal((await put(b.request,'PSA23',0,state('private B'),'firebase:B')).status,200);
 assert.equal((await (await get(a.request,'PSA23')).json()).state.text.note,'private A');
 a.setUser('B');assert.equal((await put(a.request,'PSA23',1,state('stale A'))).status,409);
 assert.equal(JSON.parse(backend.rows.get('B/PSA23').stateJSON).text.note,'private B');
});
test('compare-and-set rejects stale revisions and create-only imports without overwriting',async()=>{
 const backend=server(),api=backend.device('A').request;
 assert.equal((await put(api,'JHN1',0,state('first'))).status,200);
 assert.equal((await put(api,'JHN1',1,state('newer'))).status,200);
 assert.equal((await put(api,'JHN1',1,state('stale'))).status,409);
 assert.equal((await put(api,'JHN1',0,state('import'))).status,409);
 assert.equal(JSON.parse(backend.rows.get('A/JHN1').stateJSON).text.note,'newer');
});
test('an account change during a read or transaction cannot deliver or commit stale-account data',async()=>{
 const backend=server();let device;
 device=backend.device('A',{read:async()=>{device.setUser('B');return {formatVersion:2,revision:1,stateJSON:JSON.stringify(state('private A'))};}});
 assert.equal((await get(device.request,'PSA23')).status,409);
 device=backend.device('A',{compareAndSet:async(uid,id,rev,payload,unchanged)=>{device.setUser('B');unchanged();throw Error('must not reach');}});
 assert.equal((await put(device.request,'PSA23',0,state('private A'))).status,409);assert.equal(backend.rows.size,0);
});
test('pagination is owner scoped and returns a continuation after 200 records',async()=>{
 const backend=server(),api=backend.device('A').request;
 for(let i=1;i<=205;i++)backend.rows.set('A/PSA'+i,{formatVersion:2,revision:1,stateJSON:JSON.stringify(state('A')),updatedAt:10});
 backend.rows.set('B/GEN1',{formatVersion:2,revision:1,stateJSON:JSON.stringify(state('B')),updatedAt:10});
 const first=await (await api('/api/sync/chapters',{headers:{'X-Yeo-Account':'firebase:A'}})).json();
 assert.equal(first.records.length,200);assert.ok(first.next);
 const second=await (await api('/api/sync/chapters?after='+first.next,{headers:{'X-Yeo-Account':'firebase:A'}})).json();
 assert.equal(second.records.length,5);assert.equal(second.next,null);
 assert.equal(new Set([...first.records,...second.records].map(r=>r.chapter)).size,205);
});
test('malformed and oversized records are rejected before a Firestore write',async()=>{
 const backend=server(),api=backend.device('A').request;
 for(const value of [{},null,{...state('x'),version:1},{...state('x'),blocks:['note-1']},{...state('x'),recordTitle:'x'.repeat(81)}])assert.equal((await put(api,'PSA23',0,value)).status,400);
 assert.equal((await put(api,'PSA23',0,state('한'.repeat(300000)))).status,413);
 assert.equal((await put(api,'invalid',0,state('x'))).status,404);assert.equal(backend.rows.size,0);
});
test('permission and offline errors never produce a successful save receipt',async()=>{
 const backend=server();
 const denied=backend.device('A',{compareAndSet:async()=>{throw Object.assign(Error('denied'),{code:'permission-denied'});}});
 assert.equal((await put(denied.request,'PSA23',0,state('x'))).status,403);
 const offline=backend.device('A',{compareAndSet:async()=>{throw Object.assign(Error('offline'),{code:'unavailable'});}});
 await assert.rejects(put(offline.request,'PSA23',0,state('x')),/network_error/);assert.equal(backend.rows.size,0);
});
