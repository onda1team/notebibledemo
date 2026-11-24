const test=require('node:test'), assert=require('node:assert/strict');
const Q=require('../client/quotes.js');
const list=[{id:'TEST',label:'시편 1장',verses:[[1,'예시']]}];
test('source references and Proverbs 3:3 are resolved without raw user HTML',()=>{
 assert.deepEqual(Q.verse(list,'TEST','1'),{id:'TEST',number:1,ref:'시편 1장 1절',text:'예시'});
 assert.equal(Q.verse(list,'PRO3',3).ref,'잠언 3장 3절');
 assert.match(Q.verse(list,'PRO3',3).text,/네 마음판에 새기라$/);
 assert.equal(Q.verse(list,'PRO3',2),null);
});
test('stored reference and color normalization preserves order and prevents duplicates',()=>{
 assert.deepEqual(Q.normalize([{id:'PRO3',number:3,color:'sky'},{id:'PRO3',number:3},{id:'TEST',number:1,color:'constructor'},null],list),[{id:'PRO3',number:3,color:'sky'},{id:'TEST',number:1,color:'sage'}]);
});
test('same verse can be added as independent copies without changing the old key',()=>{
 const verse=Q.verse(list,'PRO3',3),first=Q.add(verse,[],'note'),second=Q.add(verse,[first],'note-1'),third=Q.add(verse,[first,second],'note-2');
 const keys=[first,second,third].map(Q.key);
 assert.equal(keys[0],'quote:PRO3:3');assert.equal(new Set(keys).size,3);
 assert.deepEqual(Q.normalize([first,second,third,second],list).map(Q.key),keys);
 assert.deepEqual(Q.normalize([second,third],list).map(Q.key),keys.slice(1));
});
