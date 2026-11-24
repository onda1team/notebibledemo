const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../client/verse-search.js');
const bible={books:[{code:'PSA',chapters:[{id:'PSA23',label:'시편 23장',chapter:23,verses:[[1,'여호와는 나의 목자시니 내가 부족함이 없으리로다'],[2,'목자시니 여호와는 나의 하나님']]}]},{code:'GEN',chapters:[{id:'GEN1',label:'창세기 1장',chapter:1,verses:[[1,'태초에 하나님이 천지를 창조하시니라']]}]}]};
const search=create(bible);
test('finds phrases regardless of spaces, punctuation, or Hangul composition',()=>{
 for(const query of ['여호와는 나의 목자','여호와는나의목자','여호와는, 나의 목자！'.normalize('NFD')]){
   const v=search(query)[0];
   assert.deepEqual([v.ref,v.id,v.number,v.chapter,v.code],['시편 23장 1절','PSA23',1,23,'PSA']);
 }
});
test('ranks exact phrases before all-keyword results and keeps canonical order within each',()=>{
 assert.deepEqual(search('여호와는 목자').map(x=>x.number),[1,2]);
 assert.equal(search('하나님 창조')[0].ref,'창세기 1장 1절');
 assert.equal(search('목자 하나님')[0].ref,'시편 23장 2절');
});
test('accepts a single-character word but rejects empty and non-matching queries',()=>{
 assert.equal(search('천')[0].id,'GEN1');
 assert.deepEqual(search('?!'),[]);
 assert.deepEqual(search('찾을 수 없음'),[]);
});
