const test=require('node:test');
const assert=require('node:assert/strict');
const {fromLegacy,style,BASE_NOTE_HEIGHT,EXTRA_NOTE_HEIGHT}=require('../client/paper.js');
const stroke={mode:'pen',color:'#333',width:3,points:[{x:.5,y:.5}]};
test('merge all older note regions into the new sheet without mutating the old record',()=>{
 const old={version:1,notesHeight:832,ink:{scripture:[stroke],cue:[stroke],main:[stroke],summary:[stroke]},text:{cue:'질문',main:'메모',summary:'적용'},highlights:[{verse:1,start:0,end:1,quote:'말'}]};
 const before=JSON.stringify(old), data=fromLegacy(old);
 assert.equal(data.version,2);
 assert.equal(data.notesHeight,1024);
 assert.equal(data.ink.note.length,3);
 assert.equal(data.ink.note[0].points[0].x,.145);
 assert.equal(data.ink.note[1].points[0].y*data.notesHeight,416);
 assert.equal(data.ink.note[2].points[0].y*data.notesHeight,944);
 assert.equal(data.text.note,'질문\n\n메모\n\n적용');
 assert.deepEqual(data.ink.scripture,old.ink.scripture);
 assert.deepEqual(data.highlights,old.highlights);
 assert.equal(JSON.stringify(old),before);
});
test('full width for main-only legacy ink; safe defaults',()=>{
 const data=fromLegacy({version:1,ink:{main:[stroke]}});
 assert.equal(data.notesHeight,BASE_NOTE_HEIGHT);
 assert.deepEqual(data.ink.note[0].points,stroke.points);
 assert.equal(style('blank'),'blank'); assert.equal(style(null),'ruled');
 assert.equal(style('other'),'ruled'); assert.equal(EXTRA_NOTE_HEIGHT,256);
 assert.equal(fromLegacy(null),null);
});
test('keyboard is a third view without replacing the remembered paper preference',()=>{
 const {mode}=require('../client/paper.js');
 assert.equal(mode('ruled','type'),'type');
 assert.equal(mode('blank','type'),'type');
 assert.equal(mode('ruled','pen'),'ruled');
 assert.equal(mode('blank','highlight'),'blank');
 assert.equal(style('type'),'ruled');
});
test('shrink leaves ink and text height, keeps at least a small blank space and expands again',()=>{
 const {resize}=require('../client/paper.js');
 assert.equal(resize(576,32,-1),320);
 assert.equal(resize(320,32,-1),128);
 assert.equal(resize(128,32,-1),128);
 assert.equal(resize(576,480,-1),480);
 assert.equal(resize(480,512,-1),480);
 assert.equal(resize(320,400,1),576);
});
test('vertical drag works at zoom and cannot crop the occupied area',()=>{
 const {dragHeight}=require('../client/paper.js');
 assert.equal(dragHeight(300,80,2,120),340);
 assert.equal(dragHeight(300,-500,.6,160),160);
 assert.equal(dragHeight(300,-900,1,32),64);
 assert.equal(dragHeight(300,9000,1,120),8192);
});
test('a quote resizes from its compact height while honoring wrapped text and ink floor',()=>{
 assert.equal(require("../client/paper.js").dragHeight(40,120,1,40,40),160);
 assert.equal(require("../client/paper.js").dragHeight(160,-190,2,88,40),88);
 assert.equal(require("../client/paper.js").dragHeight(40,0,1,40,40),40);
});
