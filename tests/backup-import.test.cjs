const test=require('node:test'),assert=require('node:assert/strict'),{parse}=require('../client/backup-import.js');
const state=text=>({version:2,blocks:['note'],text:{note:text},ink:{note:[]},quotes:[],highlights:[]});
test('standard device backup preserves complete notes without altering the file object',()=>{
 const original={records:[{id:'PSA23',revision:3,state:{...state('맥북 필기'),recordTitle:'제목',unknown:{kept:true}}}],backups:[]};
 const result=parse(original);assert.equal(result.candidates.length,1);assert.deepEqual(result.candidates[0].state,original.records[0].state);
 result.candidates[0].state.text.note='changed';assert.equal(original.records[0].state.text.note,'맥북 필기');
});
test('two-version backup exposes both variants instead of silently preferring one',()=>{
 const result=parse({id:'JHN3',local:state('local'),remote:state('remote')});
 assert.deepEqual(result.candidates.map(item=>item.state.text.note),['local','remote']);
});
test('identical recovery copies are deduplicated, different versions remain selectable',()=>{
 const result=parse({records:[{id:'PSA23',state:state('same')}],recoveryDrafts:[{id:'PSA23',state:state('same')},{id:'PSA23',state:state('different')}]});
 assert.equal(result.candidates.length,2);
});
test('invalid chapter IDs, broken blocks and wrong versions cannot be copied',()=>{
 const result=parse([{id:'../../other',state:state('bad')},{id:'PSA23',state:{...state('bad'),blocks:['note','other']}},{id:'JHN3',state:{...state('bad'),version:9}},{id:'MAT1',state:state('good')}]);
 assert.equal(result.skipped,3);assert.deepEqual(result.candidates.map(item=>item.id),['MAT1']);
});
test('Bible membership filtering rejects syntactically valid nonexistent chapters',()=>{
 const result=parse([{id:'PSA999',state:state('bad')}],{validId:id=>id==='PSA23'});assert.equal(result.candidates.length,0);assert.equal(result.skipped,1);
});
