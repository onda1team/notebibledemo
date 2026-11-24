const test=require('node:test'),assert=require('node:assert/strict'),p=require('../client/pin.js');
test('the reference stays in the actual viewport at different zoom levels',()=>{
 assert.equal(p.available(612,1),600);
 assert.equal(p.available(612,1.25),480);
 assert.equal(p.offset(251,1.25,1500,480),200);
 assert.equal(p.offset(0,1,1500,600),0);
});
test('the reference stops at the bottom of the sheet',()=>{
 assert.equal(p.offset(1200,1,920,600),320);
 assert.equal(p.offset(500,1,50,600),0);
});
