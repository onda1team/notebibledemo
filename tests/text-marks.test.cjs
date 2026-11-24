const M=require('../client/text-marks.js'),test=require('node:test'),assert=require('node:assert/strict');
const mark=(s,start,end,color)=>({start,end,quote:s.slice(start,end),...(color?{color}:{})});
test('clean validates exact UTF16 snapshots and drops invalid or split-codepoint ranges',()=>{
 const s='가😀나';const good=mark(s,1,3,'#ffee00');
 assert.deepEqual(M.clean([good,{start:0,end:1,quote:'틀림'},mark(s,1,2),mark(s,-1,2),mark(s,0,0),null,{start:0.2,end:1,quote:'가'}],s),[good]);
 assert.deepEqual(M.clean(null,s),[]);
});
test('edits before and after a mark shift or preserve its exact range',()=>{
 const s='앞 말씀 뒤',m=mark(s,2,4);
 assert.deepEqual(M.forEdit([m],s,'새 '+s),[{...m,start:4,end:6}]);
 assert.deepEqual(M.forEdit([m],s,s+' 끝'),[m]);
 assert.deepEqual(M.forEdit([m],s,'말씀 뒤'),[{...m,start:0,end:2}]);
 assert.deepEqual(M.forEdit([m],s,s),[m]);
});
test('touching text deletes its highlight but keeps unaffected marks',()=>{
 const s='하나 둘 셋',a=mark(s,0,2),b=mark(s,5,6);
 assert.deepEqual(M.forEdit([a,b],s,'한가나 둘 셋'),[{...b,start:6,end:7}]);
 assert.deepEqual(M.forEdit([a,b],s,'하나 둘 끝'),[a]);
 assert.deepEqual(M.forEdit([a],s,''),[]);
});
test('insertion immediately before or after nonambiguous marked word does not extend it',()=>{
 const s='word',m=mark(s,0,4);
 assert.deepEqual(M.forEdit([m],s,'Xword'),[{...m,start:1,end:5}]);
 assert.deepEqual(M.forEdit([m],s,'wordX'),[m]);
});
test('repeated text edits drop ambiguous highlights, retain clearly external ones',()=>{
 const s='aaa Z',a=mark(s,1,2),z=mark(s,4,5);
 assert.deepEqual(M.forEdit([a,z],s,'aaaa Z'),[{...z,start:5,end:6}]);
 assert.deepEqual(M.forEdit([mark('aaa',0,1)],'aaa','aa'),[]);
});
test('multiple separated edits conservatively invalidate intervening highlights',()=>{
 const s='a WORD z';assert.deepEqual(M.forEdit([mark(s,2,6)],s,'b WORD x'),[]);
});
test('segments merge overlapping or adjacent marks and preserve full original text',()=>{
 const s='abcdefghi',marks=[mark(s,4,7),mark(s,1,4),mark(s,3,5)];
 const result=M.segments(s,marks);
 assert.deepEqual(result,[{start:0,end:1,text:'a',marked:false},{start:1,end:7,text:'bcdefg',marked:true},{start:7,end:9,text:'hi',marked:false}]);
 assert.equal(result.map(s=>s.text).join(''),s);assert.deepEqual(M.segments('',marks),[]);
 assert.deepEqual(M.segments('abc',[]),[{start:0,end:3,text:'abc',marked:false}]);
});
test('emoji edits and boundary snapping preserve complete codepoints',()=>{
 const s='가😀나',m=mark(s,1,3);
 assert.deepEqual(M.forEdit([m],s,'x'+s),[{...m,start:2,end:4}]);
 assert.equal(M.codepointBoundary(s,2,-1),1);assert.equal(M.codepointBoundary(s,2),3);
 assert.equal(M.codepointBoundary(s,100),s.length);assert.equal(M.codepointBoundary(s,-10),0);
});
test('space inserted inside marked words leaves the original letters marked, not the new space',()=>{
 const s='하나님의주권',next='하나님의 주권',m=mark(s,0,s.length,'#ffee00');
 const result=M.forEdit([m],s,next,{start:4,end:4});
 assert.deepEqual(result,[mark(next,0,4,'#ffee00'),mark(next,5,7,'#ffee00')]);
 assert.deepEqual(M.segments(next,result).map(x=>[x.text,x.marked]),[['하나님의',true],[' ',false],['주권',true]]);
 assert.deepEqual(M.forEdit([m],s,next),result);
});
test('space insertion at mark edges or among repeated spaces does not color the new character',()=>{
 const old='말 씀',next='말  씀',m=mark(old,0,3);
 const at=M.forEdit([m],old,next,{start:1,end:1});
 assert.deepEqual(M.segments(next,at).map(x=>[x.text,x.marked]),[['말',true],[' ',false],[' 씀',true]]);
 assert.deepEqual(M.forEdit([mark('말씀',0,2)],'말씀',' 말씀'),[mark(' 말씀',1,3)]);
 assert.deepEqual(M.forEdit([mark('말씀',0,2)],'말씀','말씀 '),[mark('말씀 ',0,2)]);
});
test('a selected range replaced with a space retains only surviving marked letters',()=>{
 const old='가나다라',next='가 라',m=mark(old,0,4);
 assert.deepEqual(M.forEdit([m],old,next,{start:1,end:3}),[mark(next,0,1),mark(next,2,3)]);
 assert.deepEqual(M.forEdit([m],old,' ',{start:0,end:4}),[]);
});
test('visible color follows the mark and a newer overlapping color takes precedence',()=>{
 const t='가나다라마';
 assert.deepEqual(M.segments(t,[mark(t,0,4,'#f4df8d'),mark(t,1,3,'#f5b5cf'),mark(t,4,5,'#c9e79e')]).map(x=>[x.text,x.color]),
   [['가','#f4df8d'],['나다','#f5b5cf'],['라','#f4df8d'],['마','#c9e79e']]);
});
test('backspace and forward delete inside a mark keep all surviving colored letters',()=>{
 const t='하나님의주권',n='하나님주권',m=mark(t,0,t.length,'#f5b5cf');
 for(const selection of [{start:4,end:4,type:'deleteContentBackward'},{start:3,end:3,type:'deleteContentForward'},{start:3,end:4,type:'deleteContentBackward'},undefined]){
  const next=M.forEdit([m],t,n,selection);
  assert.deepEqual(M.segments(n,next),[{start:0,end:n.length,text:n,marked:true,color:'#f5b5cf'}]);
 }
});
test('the actual cursor disambiguates deletion among repeated letters and preserves its neighbors',()=>{
 const t='가가가',n='가가',a=mark(t,0,1,'#f4df8d'),b=mark(t,1,2,'#f5b5cf'),c=mark(t,2,3,'#c9e79e');
 assert.deepEqual(M.forEdit([a,b,c],t,n,{start:2,end:2,type:'deleteContentBackward'}),[a,mark(n,1,2,'#c9e79e')]);
});
