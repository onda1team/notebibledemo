const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const books=require('../client/bible.js'),quotes=require('../client/quotes.js');
const parse=file=>{const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../client/'+file),'utf8'),sandbox);return JSON.parse(JSON.stringify(sandbox.window));};
const {YEO_KRV}=parse('krv-full.js'),{YEO_PASSAGES}=parse('scripture.js');
const bible=books.create(YEO_KRV,YEO_PASSAGES);
test('KRV includes 66 canonical books, 1,189 chapters and 31,103 numbered verses',()=>{
  assert.equal(bible.books.length,66);assert.equal(bible.books.filter(b=>b.testament==='구약').length,39);
  assert.deepEqual(bible.books.map(b=>b.chapters.length),[50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22]);
  const chapters=bible.books.flatMap(b=>b.chapters);assert.equal(chapters.length,1189);
  assert.equal(new Set(chapters.map(c=>c.id)).size,1189);
  assert.equal(chapters.reduce((n,c)=>n+c.verses.length,0),31103);
  assert.ok(chapters.every(c=>c.verses.every(([n,t],i)=>n===i+1&&t.trim())));
  assert.match(quotes.verse(bible,'GEN1',1).text,/태초에/);
  assert.match(quotes.verse(bible,'REV22',21).text,/아멘$/);
  assert.equal(bible.chapter('PSA',119).verses.length,176);
});
test('legacy chapters and character offsets are preserved, and legacy quote IDs still work',()=>{
  for(const c of YEO_PASSAGES) assert.deepEqual(bible.byId(c.id).verses,c.verses);
  assert.equal(quotes.verse(bible,'PRO3',3).ref,'잠언 3장 3절');
  assert.ok(quotes.verse(bible,'PRO3',2));
  assert.equal(quotes.verse(bible,'GEN1',32),null);
});
test('verse range validates actual verse numbers, including gaps, and keeps the chapter ID',()=>{
  const {range}=require('../client/bible.js'),p={id:'HOS1',label:'호세아 1장',verses:[[1,'a'],[3,'b'],[4,'c'],[8,'d']]};
  assert.deepEqual(range(p,'3','4'),{start:3,end:4,chapterId:'HOS1',full:false,label:'호세아 1장 3–4절'});
  assert.equal(range(p,3,3).label,'호세아 1장 3절');assert.equal(range(p,1,8).full,true);
  for(const [a,b] of [[2,4],[3,2],[4,3],['',1],[1,10]])assert.equal(range(p,a,b),null);
});
test('a single-verse choice follows start; a deliberate end stays unless crossed',()=>{
  assert.equal(books.endForStart(7,1,1),7);
  assert.equal(books.endForStart(9,7,7),9);
  assert.equal(books.endForStart(8,7,10),10);
  assert.equal(books.endForStart(11,7,10),11);
});
test('chapter viewing preferences survive reopening without changing notes or crossing accounts',()=>{
  const map=new Map([['chapter-notes','unchanged']]);
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const p=bible.byId('MAT5'), q=bible.byId('MAT6'), single=books.range(p,7,7);
  books.writeView(storage,'alpha',p,single);
  assert.deepEqual(books.readView(storage,'alpha',p),single);
  assert.equal(books.readView(storage,'beta',p),null);
  assert.equal(books.readView(storage,'alpha',q),null);
  books.writeView(storage,'alpha',p,null);
  assert.equal(books.readView(storage,'alpha',p),null);
  assert.deepEqual([...map],[['chapter-notes','unchanged']]);
});
