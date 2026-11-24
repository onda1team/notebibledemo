const R=require('../client/records.js'),test=require('node:test'),assert=require('node:assert/strict');
const bible={byId:id=>['PSA23','JHN15','PRO3'].includes(id)?{id,label:id+'장',code:id.slice(0,3),chapter:3,verses:[[1,'본문'],[3,'본문']]}:null};
const state=extra=>({version:2,blocks:['note'],text:{note:''},ink:{note:[],scripture:[]},...extra});
const stroke={mode:'pen',points:[{x:.2,y:.3}]};
function store(entries){const map=new Map(Object.entries(entries).map(([k,v])=>[k,typeof v==='string'?v:JSON.stringify(v)]));return {length:map.size,key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null};}
const key=(id,p='v3')=>'yeobaek-paper-'+p+':'+id;
test('ignores empty, resized and tombstoned boxes and stale timeline text',()=>{
 const s=state({notesHeight:9999,blocks:['note','note-1'],text:{note:'removed', 'note-1':'  '},deletedBlocks:{note:true},ink:{note:[stroke]},timeline:[{kind:'type',text:'old'}]});
 assert.deepEqual(R.list(store({[key('PSA23')]:s}),bible),[]);
});
test('current typed and pen records sort newest first and retain metadata',()=>{
 const result=R.list(store({[key('PSA23')]:state({text:{note:' first\n note '},updatedAt:100}),[key('JHN15')]:state({ink:{note:[stroke]},updatedAt:200})}),bible);
 assert.deepEqual(result.map(x=>x.id),['JHN15','PSA23']);assert.equal(result[1].snippet,'first note');assert.equal(result[0].hasNotes,true);assert.equal(result[0].hasScripture,false);
});
test('scripture ink, highlights and quote cards count independently',()=>{
 const result=R.list(store({[key('PSA23')]:state({ink:{scripture:[stroke]}}),[key('JHN15')]:state({highlights:[{verse:1,start:0,end:2,quote:'말씀'}]}),[key('PRO3')]:state({quotes:[{id:'PSA23',number:1}]})}),bible);
 assert.equal(result.length,3);assert.equal(result.find(x=>x.id==='PRO3').hasNotes,true);assert.equal(result.find(x=>x.id==='JHN15').hasScripture,true);assert.ok(result.every(x=>x.updatedAt===null));
});
test('fallback only when newer key absent; malformed and empty current never resurrect legacy',()=>{
 const data={[key('PSA23','v2')]:state({text:{note:'old'}}),[key('JHN15')]:state(),[key('JHN15','v2')]:state({text:{note:'hidden'}}),[key('PRO3')]:'{bad',[key('PRO3','v2')]:state({text:{note:'hidden'}})};
 assert.deepEqual(R.list(store(data),bible).map(x=>x.id),['PSA23']);
});
test('legacy Cornell cue, main, summary and scripture are detected without inventing dates',()=>{
 const result=R.list(store({'yeobaek-cornell-v1:PSA23':{version:1,text:{cue:'질문',summary:'요약'},ink:{scripture:[stroke]}}}),bible);
 assert.equal(result[0].snippet,'질문 요약');assert.equal(result[0].updatedAt,null);assert.equal(result[0].hasScripture,true);
});
test('malformed content and unknown chapters ignored; finite date and snippet bounds',()=>{
 const result=R.list(store({[key('UNKNOWN')]:state({text:{note:'x'}}),[key('PSA23')]:state({ink:{note:[{points:[]}]},highlights:[{verse:1,start:5,end:2,quote:'bad'}],quotes:[{id:'missing',number:1}]}),[key('PRO3')]:state({text:{note:'a'.repeat(100)},updatedAt:'2026-01-01T00:00:00Z'})}),bible);
 assert.equal(result.length,1);assert.equal(result[0].snippet.length,70);assert.equal(result[0].updatedAt,Date.parse('2026-01-01T00:00:00Z'));
});
test('storage failures are safe and one failed read does not hide other records',()=>{
 assert.deepEqual(R.list({get length(){throw Error('denied');}},bible),[]);
 const s=store({[key('PSA23')]:state({text:{note:'a'}}),[key('JHN15')]:state({text:{note:'b'}})}),get=s.getItem;s.getItem=k=>{if(k.endsWith('PSA23'))throw Error('denied');return get(k);};
 assert.deepEqual(R.list(s,bible).map(x=>x.id),['JHN15']);
});
test('includes a saved subtopic even before body text and excludes deleted titles',()=>{
 const r=R.list(store({[key('PSA23')]:state({titles:{note:'새 주제'}}),[key('JHN15')]:state({titles:{note:'지운 제목'},deletedBlocks:{note:true}})}),bible);
 assert.equal(r.length,1);assert.equal(r[0].snippet,'새 주제');
});
function visitStorage(){
 const values=new Map();
 return {values,get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
}
test('opening is per account and chapter, deduplicated across reloads, and uses no record keys',()=>{
 const s=visitStorage(),legacy=key('JHN15','v2'),cloud='yeobaek-cloud-v1:account:JHN15';
 s.setItem(legacy,'original legacy bytes');s.setItem(cloud,'original cloud bytes');
 assert.equal(R.rememberOpening(s,'account','JHN15',bible,100),true);
 R.rememberOpening(s,'account','PSA23',bible,150);
 R.rememberOpening(s,'account','JHN15',bible,200);
 R.rememberOpening(s,'account','JHN15',bible,90);
 R.rememberOpening(s,'different:account','PRO3',bible,300);
 const a=R.withOpenings([],s,'account',bible);
 assert.deepEqual(a.map(v=>[v.id,v.updatedAt,v.openedOnly]),[['JHN15',200,true],['PSA23',150,true]]);
 assert.deepEqual(R.withOpenings([],s,'different:account',bible).map(x=>x.id),['PRO3']);
 assert.deepEqual(R.withOpenings([],s,null,bible),[]);
 assert.equal(s.getItem(legacy),'original legacy bytes');assert.equal(s.getItem(cloud),'original cloud bytes');
 assert.equal(R.list(s,bible).length,0);
 assert.equal([...s.values.keys()].filter(k=>k.startsWith('yeobaek-opened-chapter-v1:')).length,3);
});
test('opening history preserves existing notes, highlights, labels, and original note timestamps',()=>{
 const notes=R.list(store({[key('JHN15')]:state({text:{note:'실제 메모'},updatedAt:10})}),bible);
 const s=visitStorage();R.rememberOpening(s,'account','JHN15',bible,200);
 R.rememberOpening(s,'account','PRO3',bible,100);
 const out=R.withOpenings(notes,s,'account',bible);
 assert.equal(out.length,2);assert.strictEqual(out[1],notes[0]);assert.equal(out[1].updatedAt,10);
 assert.equal(out[1].snippet,'실제 메모');assert.equal(out[0].openedOnly,true);
});
test('invalid chapters, corrupt dates and denied storage cannot create or hide records',()=>{
 const s=visitStorage();
 assert.equal(R.rememberOpening(s,null,'JHN15',bible,100),false);
 assert.equal(R.rememberOpening(s,'a','UNKNOWN',bible,100),false);
 assert.equal(R.rememberOpening(s,'a','JHN15',bible,Infinity),false);
 assert.equal(s.length,0);
 s.setItem('yeobaek-opened-chapter-v1:a:JHN15','not a timestamp');
 s.setItem('yeobaek-opened-chapter-v1:a:PSA23','8640000000000001');
 assert.deepEqual(R.withOpenings([],s,'a',bible),[]);
 s.setItem=()=>{throw Error('quota');};
 assert.equal(R.rememberOpening(s,'a','JHN15',bible,100),false);
 const notes=R.list(store({[key('PSA23')]:state({text:{note:'existing'}})}),bible);
 assert.deepEqual(R.withOpenings(notes,{get length(){throw Error('denied');}},'a',bible),notes);
});
test('optional chapter title is visible on its own without replacing the canonical reference',()=>{
 const only=R.list(store({[key('PSA23')]:state({recordTitle:'  감사의 말씀  ',updatedAt:123})}),bible);
 assert.equal(only[0].customTitle,'감사의 말씀');assert.equal(only[0].label,'PSA23장');
 assert.equal(only[0].hasNotes,false);assert.equal(only[0].updatedAt,123);
 const visits=visitStorage();R.rememberOpening(visits,'a','PSA23',bible,999);
 const combined=R.withOpenings(only,visits,'a',bible);
 assert.strictEqual(combined[0],only[0]);
 const cleared=R.list(store({[key('PSA23')]:state({recordTitle:' \n '})}),bible);
 assert.deepEqual(cleared,[]);
 assert.equal(R.withOpenings(cleared,visits,'a',bible)[0].openedOnly,true);
});
test('title input is plain bounded single-line text and preserves valid adjacent Korean/supplementary text',()=>{
 assert.equal(R.title(null),'');assert.equal(R.title(' 한글\n두 줄\u0000제목 '),'한글 두 줄 제목');
 assert.equal(R.title('가'.repeat(79)+'😀'),'가'.repeat(79));
 assert.equal(R.title('가'.repeat(78)+'😀'),'가'.repeat(78)+'😀');
 assert.equal(R.title('<나의 기록>'),'<나의 기록>');
});
test('trash moves only the selected opening, survives revisits, and restores its original time',()=>{
 const s=visitStorage();R.rememberOpening(s,'owner','JHN15',bible,100);
 R.rememberOpening(s,'owner','PSA23',bible,110);
 assert.equal(R.trashOpening(s,'owner','JHN15',bible,true),true);
 R.rememberOpening(s,'owner','JHN15',bible,900);
 const rows=R.withOpenings([],s,'owner',bible);
 assert.deepEqual(rows.map(r=>[r.id,r.updatedAt,r.trashedAt]),[['PSA23',110,undefined],['JHN15',100,100]]);
 assert.deepEqual(R.withOpenings([],s,'other',bible),[]);
 assert.equal(R.trashOpening(s,'owner','JHN15',bible,false),true);
 assert.equal(R.withOpenings([],s,'owner',bible).find(r=>r.id==='JHN15').trashedAt,undefined);
});
test('saved trash metadata preserves notes and takes precedence over opening history',()=>{
 const s=visitStorage();R.rememberOpening(s,'owner','JHN15',bible,300);
 const record=state({recordTitle:'묵상 제목',text:{note:'원본'},updatedAt:100,trashedAt:500});
 const rows=R.withOpenings(R.list(store({[key('JHN15')]:record}),bible),s,'owner',bible);
 assert.equal(rows.length,1);assert.equal(rows[0].trashedAt,500);assert.equal(rows[0].updatedAt,100);
 assert.equal(rows[0].snippet,'원본');assert.equal(rows[0].customTitle,'묵상 제목');
});
test('bulletin-only and answer-only chapters appear with understandable bounded excerpts',()=>{
 const entry={id:'bulletin',question:' 무엇을\n 기억할까? ',answer:' 사랑을\n기억하기 ',reference:'시편 23:1'};
 const result=R.list(store({
  [key('PSA23')]:state({bulletinQuestions:[entry],updatedAt:200,trashedAt:300}),
  [key('JHN15')]:state({bulletinQuestions:[{...entry,question:'',answer:'😀'.repeat(70)}]}),
  [key('PRO3')]:state({bulletinQuestions:[{...entry,question:' ',answer:' '},null,{id:'invalid',answer:'incomplete'}]})
 }),bible);
 assert.deepEqual(result.map(x=>x.id),['PSA23','JHN15']);
 assert.deepEqual(result.map(x=>x.hasNotes),[true,true]);
 assert.equal(result[0].trashedAt,300);
 assert.equal(result[0].snippet,'질문: 무엇을 기억할까? · 답변: 사랑을 기억하기');
 assert.equal(result[1].snippet,'답변: '+'😀'.repeat(33));
 assert.ok(result[1].snippet.length<=70);
});
test('body-only bulletins appear in records, while blank and corrupt occurrences do not',()=>{
 const first={id:'body',text:'첫 문단 <본문>\n\n둘째 문단',reference:'시편 23장'};
 const second={...first,id:'second'};
 const result=R.list(store({
  [key('PSA23')]:state({bulletinBody:[first,second],updatedAt:200,trashedAt:300}),
  [key('JHN15')]:state({bulletinBody:[first],bulletinQuestions:[{id:'question',question:'질문?',answer:'답변',reference:''}]}),
  [key('PRO3')]:state({bulletinBody:[{...first,text:' \n '},null,{...second,text:'x'.repeat(12001)}]})
 }),bible);
 assert.deepEqual(result.map(x=>x.id),['PSA23','JHN15']);
 assert.equal(result[0].hasNotes,true);assert.equal(result[0].hasScripture,false);assert.equal(result[0].trashedAt,300);
 assert.equal(result[0].bulletinBodyCount,2);
 assert.equal(result[0].snippet,'주보: 첫 문단 <본문> 둘째 문단');
 assert.equal(result[1].bulletinBodyCount,1);assert.equal(result[1].bulletinQuestionCount,1);
 assert.equal(result[1].snippet,'주보: 첫 문단 <본문> 둘째 문단 · 질문: 질문? · 답변: 답변');
 assert.deepEqual(R.bulletinBody([first,first,second]),[first,second]);
});
