const T=require('../client/timeline.js'), test=require('node:test'), assert=require('node:assert/strict');
test('ink sessions only group adjacent strokes, across written records chronology is not flattened',()=>{
 const events=[];
 T.pushInk(events,'note','a',1);T.pushInk(events,'note','b',2);
 events.push({kind:'type',block:'note-1',text:'메모',at:3},{kind:'quote',id:'PRO3',number:3,at:4});
 T.pushInk(events,'note-2','c',5);
 assert.deepEqual(events.map(e=>e.kind),['ink','type','quote','ink']);
 assert.deepEqual(events[0].ids,['a','b']);
 assert.deepEqual(T.read(events,['note','note-1','note-2']),events);
});
test('typing delta captures additions and replaces edited snapshots',()=>{
 assert.equal(T.typedDelta('먼저','먼저\n나중'),'나중');
 assert.equal(T.typedDelta('낡은 메모','새 메모'),'새 메모');
 assert.equal(T.typedDelta('지움',''),'');
});
