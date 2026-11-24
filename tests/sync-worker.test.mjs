import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleSync} from '../worker/sync.mjs';
function mockDB(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../drizzle/0000_chapter_sync.sql',import.meta.url),'utf8'));
 return {prepare:q=>({bind(...v){const statement=sql.prepare(q);return {first:async()=>statement.get(...v),all:async()=>({results:statement.all(...v)})};}})};
}
const path='https://example.test/api/sync/chapters/PSA23';
const state=t=>({version:2,blocks:['note'],ink:{scripture:[],note:[]},text:{note:t},quotes:[],highlights:[],quoteMemos:{'quote:PRO3:3':'memo'},inlineOrder:['block:note']});
function req(id,method='GET',body,url=path,extras={}){
 return new Request(url,{method,headers:{...(id?{'oai-authenticated-user-id':id,'x-yeo-account':id}:{}),...(body?{'content-type':'application/json'}:{}),...extras},...(body?{body:JSON.stringify(body)}:{})});
}
test('uid isolation with same chapter, anonymous denial, identity independent of email',async()=>{
 const db=mockDB();
 assert.equal((await handleSync(req(null),db)).status,401);
 assert.equal((await handleSync(req('A','PUT',{baseRevision:0,state:state('A')}),db)).status,200);
 assert.equal((await handleSync(req('B'),db)).status,404);
 assert.equal((await handleSync(req('B','PUT',{baseRevision:1,state:state('attack')}),db)).status,409);
 assert.equal((await handleSync(req('B','PUT',{baseRevision:0,state:state('B')}),db)).status,200);
 const a=await (await handleSync(req('A','GET',null,path,{'oai-authenticated-user-email':'different@example.test'}),db)).json();
 assert.deepEqual(a.state,state('A'));
 assert.equal((await (await handleSync(req('B'),db)).json()).state.text.note,'B');
});
test('CAS conflict does not overwrite latest, including import collision',async()=>{
 const db=mockDB();
 for(const [baseRevision,t,status] of [[0,'first',200],[1,'newer',200],[1,'stale',409],[0,'import',409]]){
  assert.equal((await handleSync(req('A','PUT',{baseRevision,state:state(t)}),db)).status,status);
 }
 const row=await (await handleSync(req('A'),db)).json();
 assert.deepEqual([row.state.text.note,row.revision],['newer',2]);
});
test('cross-origin, oversized and malformed writes fail without mutation',async()=>{
 const db=mockDB();
 assert.equal((await handleSync(req('A','PUT',{baseRevision:0,state:state('A')},path,{origin:'https://other.test'}),db)).status,403);
 assert.equal((await handleSync(req('A','PUT',{baseRevision:0,state:state('x'.repeat(751000))}),db)).status,413);
 assert.equal((await handleSync(req('A','PUT',{baseRevision:0,state:{version:2}}),db)).status,400);
 assert.equal((await handleSync(req('A'),db)).status,404);
});

test('stale client account on changed session and missing storage fail closed',async()=>{
 const db=mockDB();
 assert.equal((await handleSync(req('B','PUT',{baseRevision:0,state:state('old A')},path,{'x-yeo-account':'A'}),db)).status,409);
 assert.equal((await handleSync(req('B'),db)).status,404);
 assert.equal((await handleSync(req('B'),null)).status,503);
 const session=await handleSync(req('B','GET',null,'https://example.test/api/sync/session',{'x-yeo-account':'A'}),null);
 assert.deepEqual(await session.json(),{account:'B'});
});
test('a remote account may list only its own chapters',async()=>{
 const db=mockDB();
 await handleSync(req('A','PUT',{baseRevision:0,state:state('A')}),db);
 await handleSync(req('B','PUT',{baseRevision:0,state:state('B')},'https://example.test/api/sync/chapters/JHN1'),db);
 const response=await handleSync(req('B','GET',null,'https://example.test/api/sync/chapters'),db);
 assert.deepEqual((await response.json()).records.map(x=>x.chapter),['JHN1']);
});

test('chapter title is backward-compatible and cannot be lost to a still-open older writer',async()=>{
 const db=mockDB(),oldClient={'x-yeo-quote-copies':'1'},newClient={...oldClient,'x-yeo-record-title':'1'};
 const put=(baseRevision,data,caps={})=>handleSync(req('A','PUT',{baseRevision,state:data},path,caps),db);
 assert.equal((await put(0,state('original'))).status,200);
 assert.equal((await put(1,{...state('original'),recordTitle:'묵상 제목'},newClient)).status,200);
 const rejected=await put(2,state('old tab edit'),oldClient);
 assert.equal(rejected.status,409);assert.equal((await rejected.json()).error,'revision_conflict');
 const get=async()=>await (await handleSync(req('A'),db)).json();
 assert.deepEqual([(await get()).state.recordTitle,(await get()).revision],['묵상 제목',2]);
 assert.equal((await put(2,{...state('old edit aware'),recordTitle:'묵상 제목'},oldClient)).status,200);
 assert.equal((await put(3,state('title cleared intentionally'),newClient)).status,200);
 assert.equal(Object.hasOwn((await get()).state,'recordTitle'),false);
 assert.equal((await put(4,state('legacy after clear'),oldClient)).status,200);
});
test('invalid record titles are rejected without touching stored records',async()=>{
 const db=mockDB();
 for(const title of [false,null,{},'한'.repeat(81)]){
  const response=await handleSync(req('A','PUT',{baseRevision:0,state:{...state('note'),recordTitle:title}}),db);
  assert.equal(response.status,400);
 }
 assert.equal((await handleSync(req('A'),db)).status,404);
});
test('trash round trip is revision guarded, blocks older tabs, and restores original content',async()=>{
 const db=mockDB(),caps={'x-yeo-record-trash':'1','x-yeo-record-title':'1','x-yeo-quote-copies':'1'};
 const put=(baseRevision,state,headers=caps)=>handleSync(req('A','PUT',{baseRevision,state},path,headers),db);
 const get=async()=>await (await handleSync(req('A'),db)).json();
 const original={...state('원본 기록'),recordTitle:'묵상',updatedAt:100};
 assert.equal((await put(0,original)).status,200);
 assert.equal((await put(1,{...original,trashedAt:0})).status,400);
 assert.equal((await put(1,{...original,trashedAt:200})).status,200);
 assert.deepEqual((await get()).state,{...original,trashedAt:200});
 assert.equal((await put(2,original,{})).status,409);
 assert.equal((await put(1,state('stale'))).status,409);
 assert.equal((await put(2,original)).status,200);
 assert.deepEqual((await get()).state,original);
});

test('bulletin records preserve Korean and multiline text and block stale feature-incompatible writers',async()=>{
 const db=mockDB(),older={'x-yeo-record-trash':'1','x-yeo-record-title':'1','x-yeo-quote-copies':'1'},caps={...older,'x-yeo-bulletin-questions':'1'};
 const put=(baseRevision,state,headers=caps)=>handleSync(req('A','PUT',{baseRevision,state},path,headers),db);
 const get=async()=>await (await handleSync(req('A'),db)).json();
 const question={id:'bulletin-001',question:'나는 무엇을 기억할까?',answer:'사랑\n<말씀>',reference:'시편 23:1'};
 const snapshot={...state('original'),bulletinQuestions:[question],trashedAt:100};
 assert.equal((await put(0,snapshot)).status,200);
 for(const bulletinQuestions of [undefined,[],[{...question,answer:''}]]){
   const denied=await put(1,{...snapshot,bulletinQuestions},older);
   assert.equal(denied.status,409);assert.deepEqual(await denied.json(),{error:'revision_conflict',revision:1});
 }
 assert.deepEqual((await get()).state,snapshot);
 const {id,question:prompt,answer,reference}=question;
 assert.equal((await put(1,{...snapshot,text:{note:'older edit preserving questions'},bulletinQuestions:[{reference,answer,question:prompt,id}]},older)).status,200);
 assert.equal((await put(2,{...snapshot,bulletinQuestions:[]})).status,200);
 const row=await get();
 assert.equal(row.revision,3);assert.deepEqual(row.state.bulletinQuestions,[]);assert.equal(row.state.trashedAt,100);
 assert.equal((await put(3,{...row.state,bulletinQuestions:undefined},older)).status,200);
});

test('bulletin validates exact string fields, unique IDs, array and bounds before mutation',async()=>{
 const db=mockDB(),row={id:'sample',question:'질문',answer:'답변',reference:'시편 23장'};
 const put=bulletinQuestions=>handleSync(req('A','PUT',{baseRevision:0,state:{...state('note'),bulletinQuestions}}),db);
 for(const malformed of [null,{},[null],[[]],[{...row,id:' '}],[row,row],[{...row,wrong:true}],
   [{...row,id:'x'.repeat(81)}],[{...row,question:'x'.repeat(701)}],[{...row,answer:'x'.repeat(5001)}],
   [{...row,reference:'x'.repeat(101)}],[{...row,answer:12}],[{id:'missing'}],
   Array.from({length:31},(_,i)=>({...row,id:String(i)}))]){
   assert.equal((await put(malformed)).status,400);
 }
 assert.equal((await handleSync(req('A'),db)).status,404);
 const allowed=Array.from({length:30},(_,i)=>({id:String(i).padStart(80,'0'),question:'질'.repeat(700),answer:'답'.repeat(5000),reference:'표'.repeat(100)}));
 assert.equal((await put(allowed)).status,200);
 assert.deepEqual((await (await handleSync(req('A'),db)).json()).state.bulletinQuestions,allowed);
});
test('full bulletin body is optional but older question-aware clients cannot remove or alter it',async()=>{
 const db=mockDB(),older={'x-yeo-record-trash':'1','x-yeo-record-title':'1','x-yeo-quote-copies':'1','x-yeo-bulletin-questions':'1'},caps={...older,'x-yeo-bulletin-body':'1'};
 const put=(baseRevision,state,headers=caps)=>handleSync(req('A','PUT',{baseRevision,state},path,headers),db);
 const get=async()=>await (await handleSync(req('A'),db)).json();
 const row={id:'body-001',text:'첫 문단\n\n둘째 문단 <본문>',reference:'시편 23장'};
 const beforeBody={...state('existing'),trashedAt:100,bulletinQuestions:[{id:'a',question:'질문',answer:'답변',reference:''}]};
 assert.equal((await put(0,beforeBody,older)).status,200);
 const snapshot={...beforeBody,bulletinBody:[row]};
 assert.equal((await put(1,snapshot)).status,200);
 for(const body of [undefined,[],[{...row,text:'changed'}]]){
   const denied=await put(2,{...snapshot,bulletinBody:body},older);
   assert.equal(denied.status,409);assert.deepEqual(await denied.json(),{error:'revision_conflict',revision:2});
 }
 assert.deepEqual((await get()).state,snapshot);
 assert.equal((await put(2,{...snapshot,bulletinBody:[{reference:row.reference,text:row.text,id:row.id}]},older)).status,200);
 assert.equal((await put(3,{...snapshot,bulletinBody:[]})).status,200);
 assert.deepEqual((await get()).state,{...beforeBody,bulletinBody:[]});
 assert.equal((await put(4,beforeBody,older)).status,200);
});
test('full bulletin body validates bounds and exact strings without mutating the chapter',async()=>{
 const db=mockDB(),row={id:'body',text:'본문',reference:''};
 const put=bulletinBody=>handleSync(req('A','PUT',{baseRevision:0,state:{...state('note'),bulletinBody}}),db);
 for(const malformed of [null,{},[null],[row,row],[{...row,id:' '}],[{...row,id:'x'.repeat(81)}],
   [{...row,text:false}],[{...row,text:'x'.repeat(12001)}],[{...row,reference:'x'.repeat(101)}],
   [{id:'missing',text:'본문'}],[{...row,html:true}],Array.from({length:11},(_,i)=>({...row,id:String(i)}))]){
   assert.equal((await put(malformed)).status,400);
 }
 assert.equal((await handleSync(req('A'),db)).status,404);
 const allowed=Array.from({length:10},(_,i)=>({id:String(i).padStart(80,'0'),text:'문'.repeat(12000),reference:'표'.repeat(100)}));
 assert.equal((await put(allowed)).status,200);
 assert.deepEqual((await (await handleSync(req('A'),db)).json()).state.bulletinBody,allowed);
});

test('actual sync worker transfers a phone bulletin to an open laptop and preserves each existing answer',async t=>{
 const {default:{create}}=await import('../client/sync.js');
 const db=mockDB(),owner='test-owner';
 const openClient=(uid=owner,extra={})=>{
   const local=new Map();
   const storage={get length(){return local.size;},key:i=>[...local.keys()][i]??null,getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
   const sync=create({storage,request:(relative,options)=>{
     const u=new URL(relative,path),headers=new Headers(options.headers);
     headers.set('oai-authenticated-user-id',uid);
     return handleSync(new Request(u,{...options,headers}),db);
   },...extra});
   t.after(()=>sync.lock());return sync;
 };
 const phone=openClient(),arrivals=[],laptop=openClient(owner,{onChange:id=>arrivals.push(id)}),other=openClient('other-account');
 await phone.start();await laptop.start();await other.start();
 const previous={...state('기존 필기'),bulletinQuestions:[{id:'old',question:'이전 질문',answer:'기존 답변',reference:'시편 23장'}]};
 laptop.write('PSA23',previous);assert.equal((await laptop.flush()).pending,0);await phone.refresh();
 assert.deepEqual(phone.read('PSA23'),previous);
 const scanned={...previous,bulletinBody:[{id:'page',text:'설교 제목\n본문 나눔\n1. 무엇을 기억할까요?',reference:'시편 23장 1–4절'}],
   bulletinQuestions:[...previous.bulletinQuestions,{id:'new',question:'무엇을 기억할까요?',answer:'',reference:'시편 23장 1–4절'}]};
 phone.write('PSA23',scanned);assert.equal((await phone.flush()).pending,0);
 await laptop.refresh();await other.refresh();
 assert.deepEqual(arrivals,['PSA23']);assert.deepEqual(laptop.read('PSA23'),scanned);assert.equal(other.read('PSA23'),null);
});

test('a Korean custom record title reaches an already-open second device without changing its bulletin',async t=>{
 const {default:{create}}=await import('../client/sync.js');
 const db=mockDB(),user='title-test-owner';
 const make=(onChange=()=>{})=>{
   const local=new Map(),storage={get length(){return local.size;},key:i=>[...local.keys()][i]??null,getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
   const c=create({storage,onChange,request:(relative,options)=>{
     const headers=new Headers(options.headers);
     headers.set('oai-authenticated-user-id',user);
     return handleSync(new Request(new URL(relative,path),{...options,headers}),db);
   }});
   t.after(()=>c.lock());return c;
 };
 const laptop=make(),updates=[],phone=make(id=>updates.push(id));
 const initial={...state('필기'),bulletinBody:[{id:'page',text:'주보 원문',reference:'디모데후서 3장'}]};
 await laptop.start();laptop.write('2TI3',initial);await laptop.flush();await phone.start();updates.length=0;
 const titled={...initial,recordTitle:'새신자 교육 테스트'};
 laptop.write('2TI3',titled);assert.equal((await laptop.flush()).pending,0);await phone.refresh();
 assert.deepEqual(updates,['2TI3']);
 assert.deepEqual(phone.read('2TI3'),titled);
});

test('real worker keeps desktop notes and phone bulletin regardless of who uploads first',async t=>{
 const {default:{create}}=await import('../client/sync.js');
 for(const first of ['desktop','phone']){
  const db=mockDB(),owner='bidirectional-'+first;
  const make=()=>{
   const local=new Map(),storage={get length(){return local.size;},key:i=>[...local.keys()][i]??null,getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
   const c=create({storage,request:(relative,options)=>{
     const headers=new Headers(options.headers);headers.set('oai-authenticated-user-id',owner);
     return handleSync(new Request(new URL(relative,path),{...options,headers}),db);
   }});
   t.after(()=>c.lock());return c;
  };
  const desktop=make(),phone=make(),id='2TI3',base=state('처음 필기');
  await desktop.start();desktop.write(id,base);await desktop.flush();await phone.start();
  const notes={...base,recordTitle:'모임 제목',text:{note:'노트북 필기'}};
  const bulletin={...base,bulletinBody:[{id:'page',text:'휴대폰 주보',reference:'디모데후서 3장'}],
    bulletinQuestions:[{id:'q',question:'질문',answer:'기존 답',reference:'디모데후서 3장'}]};
  desktop.write(id,notes);phone.write(id,bulletin);
  const lanes=first==='desktop'?[desktop,phone]:[phone,desktop];
  await lanes[0].flush();await lanes[1].flush();
  await desktop.refresh();await phone.refresh();
  const expected={...notes,bulletinBody:bulletin.bulletinBody,bulletinQuestions:bulletin.bulletinQuestions};
  assert.deepEqual(desktop.read(id),expected,first);
  assert.deepEqual(phone.read(id),expected,first);
  assert.equal(desktop.conflicts().length+phone.conflicts().length,0);
 }
});
