const {ordered,moved}=require('../client/reorder.js');
const test=require('node:test'),assert=require('node:assert/strict');
test('stable sort selection appends new boxes and drops removed boxes',()=>{
 assert.deepEqual(ordered(['text','verse','ink','new'],['ink','gone','text','ink']),['ink','text','verse','new']);
});
test('drag before, after and same slot without losing a box',()=>{
 const ids=['text','verse','ink'];
 assert.deepEqual(moved(ids,'ink','text'),['ink','text','verse']);
 assert.deepEqual(moved(ids,'text','ink',true),['verse','ink','text']);
 assert.deepEqual(moved(ids,'verse','verse'),ids);
 assert.deepEqual(moved(ids,'verse','removed'),ids);
});
test('trash is active only inside the visible target',()=>{
 const {hit}=require('../client/reorder.js');const r={top:50,bottom:100,left:10,right:120};
 assert.equal(hit(r,60,75),true);
 assert.equal(hit(r,9,75),false);
 assert.equal(hit(r,60,101),false);
 assert.equal(hit(null,60,75),false);
});
