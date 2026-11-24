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
test('Sites v44 newest draft survives when only the older canonical record was saved',()=>{
 const original={records:[{id:'PSA23',state:state('older saved note')}],backups:[
  {key:'PSA23:draft:writer-a',data:{id:'PSA23',state:state('newest laptop note'),at:1795510000000}}
 ]};
 const before=JSON.stringify(original),result=parse(original);
 assert.deepEqual(result.candidates.map(item=>item.state.text.note),['older saved note','newest laptop note']);
 assert.equal(result.candidates[1].source,'미전송 기기 초안');assert.equal(result.candidates[1].backupKey,'PSA23:draft:writer-a');assert.equal(result.candidates[1].at,1795510000000);
 assert.equal(JSON.stringify(original),before);
});
test('old local, remote, recovered and imported snapshots are separate explicit choices',()=>{
 const result=parse({backups:[
  {key:'JHN3:backup:1795510000000-writer',data:{local:state('local'),remote:state('remote'),recovered:state('recovered'),at:1795510000010}},
  {key:'JHN3:import:1795510000020',data:state('imported')}
 ]});
 assert.deepEqual(result.candidates.map(item=>item.state.text.note),['local','remote','recovered','imported']);
 assert.equal(result.candidates[0].at,1795510000010);assert.equal(result.candidates[3].at,1795510000020);
 assert.equal(result.skipped,0);
});
test('malformed old backup entries remain untouched and produce an original-file preservation warning',()=>{
 const original={backups:[{key:'../PSA23:draft:bad',data:{state:state('bad')}},{key:'PSA23:draft:wrong-id',data:{id:'JHN3',state:state('bad')}},{key:'PSA23:backup:10',data:'unreadable'}]};
 const before=JSON.stringify(original),result=parse(original);
 assert.equal(result.candidates.length,0);assert.equal(result.skipped,3);assert.match(result.warnings.join(' '),/원본 JSON 파일을 그대로 보관/);assert.equal(JSON.stringify(original),before);
});
test('identical canonical and old draft snapshots remain deduplicated',()=>{
 const result=parse({records:[{id:'PSA23',state:state('same')}],backups:[{key:'PSA23:draft:a',data:{id:'PSA23',state:state('same'),at:10}}]});
 assert.equal(result.candidates.length,1);assert.equal(result.skipped,0);
});
