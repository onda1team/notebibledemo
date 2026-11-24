const test=require('node:test'),assert=require('node:assert/strict');
const PDF=require('../client/record-pdf.js'),Quotes=require('../client/quotes.js'),Order=require('../client/reorder.js'),Records=require('../client/records.js');
const chapter={id:'JHN15',label:'요한복음 15장',verses:[[1,'참포도나무'],[2,'가지']]};
const another={id:'PRO3',label:'잠언 3장',verses:[[3,'인자와 진리']]};
const bible={byId:id=>[chapter,another].find(p=>p.id===id)};
const ink={mode:'pen',points:[{x:0.1,y:0.2}]},mark={start:0,end:2,quote:'참포'};
const model=(s)=>PDF.model(chapter,s,bible,{Quotes,Order,Records});
test('PDF model includes only the chosen snapshot in its saved order, without altering it',()=>{
 const source={version:2,blocks:['note','note-1','note-2'],deletedBlocks:{'note-1':true},titles:{note:'내 소주제'},text:{note:'한글 메모\n다음 줄','note-1':'삭제 내용'},notesHeight:960,
  ink:{scripture:[ink],note:[ink],'quote:PRO3:3':[{...ink,zone:'pad'}]},quoteMemos:{'quote:PRO3:3':'말씀 카드 한글 메모'},
  quotes:[{id:'PRO3',number:3,after:'note-1'}],quoteHeights:{'quote:PRO3:3':120},highlights:[{verse:1,...mark}],inlineOrder:['quote:PRO3:3','block:note']};
 const original=structuredClone(source),out=model(source);
 assert.deepEqual(source,original);assert.equal(out.label,chapter.label);
 assert.deepEqual(out.items.map(x=>x.id),['quote:PRO3:3','block:note']);
 assert.equal(out.items[0].memo,'말씀 카드 한글 메모');
 assert.equal(out.items[0].ink[0].zone,'pad');assert.equal(out.items[1].ink[0].points.length,1);
 assert.equal(out.items[1].text,'한글 메모\n다음 줄');assert.equal(out.items[1].height,960);
 assert.deepEqual(out.verses[0].marks,[{verse:1,...mark}]);assert.equal(out.scriptureInk.length,1);
 assert.ok(!JSON.stringify(out).includes('삭제 내용'));
});
test('visit-only PDF has the selected scripture but no synthetic note; legacy manual order works',()=>{
 assert.equal(model(null).verses.length,2);assert.deepEqual(model(null).items,[]);
 const x=model({version:2,blocks:['note','note-1'],titles:{note:'제목만'},text:{'note-1':'다음'},timeline:[{kind:'type',block:'note-1',uid:'uid'}],manualOrder:['type:uid']});
 assert.deepEqual(x.items.map(i=>i.id),['block:note-1','block:note']);
});
test('PDF keeps independent memos and colors for distinct cards of the same verse',()=>{
 const first={id:'PRO3',number:3,color:'sage'},second={...first,color:'sky',instance:'another-verse-001'};
 const a=Quotes.key(first),b=Quotes.key(second);
 const out=model({version:2,quotes:[first,second],quoteMemos:{[a]:'첫 메모',[b]:'둘째 메모'},ink:{[b]:[ink]},inlineOrder:[b,a]});
 assert.deepEqual(out.items.map(q=>[q.id,q.memo,q.ink.length]),[[b,'둘째 메모',1],[a,'첫 메모',0]]);
});
test('PDF model uses the custom title but keeps the canonical selected chapter',()=>{
 assert.equal(model(null).customTitle,'');
 const out=model({version:2,recordTitle:'  한 주의 묵상  '});
 assert.equal(out.customTitle,'한 주의 묵상');assert.equal(out.label,chapter.label);
 assert.equal(out.verses.length,2);
});
test('PDF model keeps literal bulletin text in its own ordered section without mutating records',()=>{
 const a={id:'a',question:'생각할 질문?',answer:'둘째 줄\n<b>문자 그대로</b>',reference:'요한복음 15:1'};
 const b={id:'b',question:'',answer:'답변만 작성',reference:''};
 const blank={id:'blank',question:' ',answer:'',reference:'시편 1:1'};
 const snapshot={version:2,blocks:['note'],text:{note:'나의 여백'},ink:{scripture:[ink]},bulletinQuestions:[a,b,blank]};
 const original=structuredClone(snapshot),data=model(snapshot);
 assert.deepEqual(data.bulletinQuestions,[a,b]);
 assert.notStrictEqual(data.bulletinQuestions[0],a);
 assert.equal(data.scriptureInk.length,1);assert.equal(data.items[0].text,'나의 여백');
 assert.deepEqual(snapshot,original);assert.deepEqual(model(null).bulletinQuestions,[]);
});
test('PDF renders bulletin after scripture and ink, before the margin, with literal text nodes',()=>{
 const el=tag=>({tag,children:[],append(...args){this.children.push(...args);},replaceChildren(){this.children=[];},addEventListener(){},setAttribute(){}});
 const doc={head:el('head'),body:el('body'),documentElement:{},createElement:el,createElementNS:(_,tag)=>el(tag),createTextNode:value=>({textContent:value})};
 const TextMarks={segments:value=>[{text:value}]};
 const first={id:'body',text:'첫째 문단 <img>\n\n둘째 문단',reference:'요 15:1'};
 const second={id:'more',text:'추가 주보',reference:''};
 const data=model({version:2,ink:{scripture:[ink]},bulletinBody:[first,second],bulletinQuestions:[{id:'q',question:'질문 <img>',answer:'답변\n둘째 줄',reference:'요 15:1'}]});
 assert.deepEqual(data.bulletinBody,[first,second]);assert.notStrictEqual(data.bulletinBody[0],first);
 assert.deepEqual(model(null).bulletinBody,[]);
 PDF.render({document:doc},data,'',TextMarks,'/record-print.css');
 const main=doc.body.children.find(node=>node.tag==='main');
 const sections=main.children.filter(node=>node.tag==='section');
 assert.deepEqual(sections.map(node=>node.className),['print-scripture','print-bulletin-body','print-bulletin','print-notes']);
 assert.ok(sections[0].children.some(node=>node.tag==='svg'));
 assert.deepEqual(sections[1].children.map(node=>[node.tag,node.textContent]),
  [['h2','주보 본문'],['h3','주보 1'],['p','관련 말씀: 요 15:1'],['p',first.text],['h3','주보 2'],['p',second.text]]);
 assert.deepEqual(sections[2].children.map(node=>[node.tag,node.textContent]),
  [['h2','주보 질문과 답변'],['h3','질문 1'],['p','질문 <img>'],['p','관련 말씀: 요 15:1'],['p','답변: 답변\n둘째 줄']]);
});
