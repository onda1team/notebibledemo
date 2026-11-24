import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const source='../client/';
const root='https://notes.example.test';
const worker=(await import('../dist/server/index.js')).default;
async function env() {
  const data=new DatabaseSync(':memory:');
  for(const name of (await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())
    data.exec(await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  return {TRUST_SITES_IDENTITY:'1', DB:{prepare(query){const stmt=data.prepare(query);return {bind(...args){return {first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)}),run:async()=>stmt.run(...args)};}};}}};
}
test('Worker serves same-artifact update marker, stylesheet, logo and Bible database',async()=>{
 const manifest=await worker.fetch(new Request(root+'/build-version.json'),{});
 assert.equal(manifest.status,200);assert.match(manifest.headers.get('cache-control'),/private, no-store/);
 const {version}=await manifest.json();assert.match(version,/^[a-f0-9]{64}$/);
 for(const path of ['/', '/style.css','/juuiyeolmae-logo.png','/krv-full.js']){
  const response=await worker.fetch(new Request(root+path),{});
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/private, no-store/);
  let expected=await readFile(new URL(source+(path==='/'?'index.html':path.slice(1)),import.meta.url));
  if(path==='/')expected=Buffer.from(expected.toString('utf8').replace('__YEO_BUILD_VERSION__',version));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
 }
 const result=await worker.fetch(new Request(root+'/app.js',{method:'HEAD'}),{});
 assert.equal(result.status,200); assert.equal(await result.text(),'');
 assert.equal((await worker.fetch(new Request(root+'/toString'),{})).status,404);
});
test('two separate device requests share one account; a stale edit never replaces a newer one',async()=>{
 const runtime=await env();
 const route='/api/sync/chapters/GEN1';
 const state=text=>({version:2,blocks:['note'],ink:{note:[{mode:'pen',points:[{x:0.1,y:0.2}]}]},text:{note:text},quotes:[],highlights:[]});
 function device(uid){
  return (path, method='GET', body)=>worker.fetch(new Request(root+path,{method,headers:{'oai-authenticated-user-id':uid,'x-yeo-account':uid,...(body?{'content-type':'application/json',origin:root}:{} )},...(body?{body:JSON.stringify(body)}:{})}),runtime);
 }
 const desktop=device('user-One'), tablet=device('user-One'), other=device('user-Two');
 assert.equal((await desktop(route,'PUT',{baseRevision:0,state:state('첫 기록')})).status,200);
 const first=await (await tablet(route)).json();
 assert.equal(first.state.text.note,'첫 기록');
 assert.equal((await tablet(route,'PUT',{baseRevision:first.revision,state:state('아이패드 기록')})).status,200);
 assert.equal((await desktop(route,'PUT',{baseRevision:first.revision,state:state('충돌 초안')})).status,409);
 assert.deepEqual((await (await desktop(route)).json()).state,state('아이패드 기록'));
 assert.equal((await other(route)).status,404);
});
test('an older open tab cannot overwrite independent quote copies with a deduplicated snapshot',async()=>{
 const runtime=await env(),route=root+'/api/sync/chapters/GEN1',uid='copy-check';
 const state=quotes=>({version:2,blocks:['note'],ink:{},text:{note:''},quotes,highlights:[]});
 const primary={id:'PRO3',number:3},copy={...primary,instance:'an-instance-1'};
 function put(baseRevision,s,newClient=false){
   const headers={'oai-authenticated-user-id':uid,'x-yeo-account':uid,'content-type':'application/json',origin:root,...(newClient?{'x-yeo-quote-copies':'1'}:{})};
   return worker.fetch(new Request(route,{method:'PUT',headers,body:JSON.stringify({baseRevision,state:s})}),runtime);
 }
 assert.equal((await put(0,state([primary,copy]),true)).status,200);
 assert.equal((await put(1,state([primary]))).status,409);
 const read=await worker.fetch(new Request(route,{headers:{'oai-authenticated-user-id':uid,'x-yeo-account':uid}}),runtime);
 assert.deepEqual((await read.json()).state.quotes,[primary,copy]);
 assert.equal((await put(1,state([primary]),true)).status,200);
});

test('standalone Worker rejects spoofed Sites identity headers',async()=>{
 const runtime=await env();delete runtime.TRUST_SITES_IDENTITY;
 const r=await worker.fetch(new Request(root+'/api/sync/session',{headers:{'oai-authenticated-user-id':'victim','x-yeo-account':'victim'}}),runtime);
 assert.equal(r.status,401);
});

test('Google sessions own synced records across devices and cannot see another account',async()=>{
 const runtime=await env();runtime.TRUST_SITES_IDENTITY='0';
 const tokens=['a'.repeat(43),'b'.repeat(43)];
 for(const [i,token] of tokens.entries())await runtime.DB.prepare('INSERT INTO auth_sessions(token_hash,owner,name,email,created_at,expires_at) VALUES(?,?,?,?,?,?)')
  .bind(createHash('sha256').update(token).digest('base64url'),'google:user-'+i,'Test','',Date.now(),Date.now()+60000).run();
 const route=root+'/api/sync/chapters/GEN1';
 const snapshot={version:2,blocks:['note'],ink:{},text:{note:'맥북 한글 필기'},quotes:[],highlights:[]};
 const headers=i=>({cookie:'__Host-yeo-session='+tokens[i],'x-yeo-account':'google:user-'+i,'oai-authenticated-user-id':'forged-victim'});
 const saved=await worker.fetch(new Request(route,{method:'PUT',headers:{...headers(0),'content-type':'application/json',origin:root},body:JSON.stringify({baseRevision:0,state:snapshot})}),runtime);
 assert.equal(saved.status,200);
 const read=await worker.fetch(new Request(route,{headers:headers(0)}),runtime);
 assert.deepEqual((await read.json()).state,snapshot);
 assert.equal((await worker.fetch(new Request(route,{headers:headers(1)}),runtime)).status,404);
 runtime.TRUST_SITES_IDENTITY='1';
 assert.equal((await worker.fetch(new Request(route,{headers:{cookie:'__Host-yeo-session='+ 'c'.repeat(43),'oai-authenticated-user-id':'google:user-0','x-yeo-account':'google:user-0'}}),runtime)).status,401);
});
