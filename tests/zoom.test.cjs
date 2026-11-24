'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../client/zoom.js'),'utf8');

function fixture({wide=true,noticeSpace=0}={}){
  function el(rect={}){
    const attributes=new Set(),events={};
    return {style:{},scrollTop:0,scrollLeft:0,events,clientWidth:1000,clientHeight:600,offsetHeight:720,offsetTop:0,
      getBoundingClientRect:()=>({left:0,right:1000,top:100,bottom:700,...rect}),
      querySelector:()=>null,addEventListener:(name,cb)=>{events[name]=cb;},
      set tabIndex(value){attributes.add('tabindex');this.tabValue=value;},
      hasAttribute:name=>attributes.has(name),removeAttribute:name=>attributes.delete(name)};
  }
  const box=el(),world=el(),paper=el(),reference=el({left:10,right:460,top:110}),writing=el({left:460,right:990,top:110});
  world.offsetTop=noticeSpace;
  const ids={readerScroll:box,readerWorld:world,readerSheet:paper,
    scriptureReference:reference,writingPaper:writing,zoomOut:el(),zoomIn:el(),zoomReset:el(),trashedChapter:el()};
  const window={addEventListener(){}};
  vm.runInNewContext(source,{window,document:{getElementById:id=>ids[id]},
    matchMedia:()=>({matches:wide}),ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1});
  return {zoom:window.CornellZoom,box,world,paper,reference,writing};
}

test('wide sheet reserves space for notice and scales height to viewport without layout pinning',()=>{
  const {zoom,world,paper,reference,writing}=fixture({noticeSpace:40});
  assert.equal(world.style.height,'560px');
  assert.equal(paper.style.height,'553px');
  assert.equal(reference.tabValue,0);
  assert.equal(writing.tabValue,0);
  zoom.pinch({scale:2,fromX:200,fromY:150,lane:'reference'});
  assert.equal(zoom.scale(),2);
  assert.equal(world.style.height,'560px');
  assert.equal(paper.style.height,'276.5px');
  assert.equal(world.style.width,'1956px');
  assert.equal(reference.style.transform,undefined);
});

test('wide vertical pans with horizontal drift only move the selected reader pane',()=>{
  const {zoom,box,reference,writing}=fixture();
  zoom.pinch({scale:2,fromX:200,fromY:150,lane:'reference'});
  reference.scrollTop=40;writing.scrollTop=60;box.scrollLeft=180;
  zoom.pinch({fromX:575,fromY:230,toX:565,toY:180,lane:'reference'});
  assert.equal(reference.scrollTop,65,'explicit lane ignores a centroid over the opposite pane');
  assert.equal(writing.scrollTop,60);
  assert.equal(box.scrollTop,0);
  assert.equal(box.scrollLeft,180);
  zoom.pinch({fromX:650,fromY:200,toX:640,toY:156,lane:'writing'});
  assert.equal(writing.scrollTop,82);
  assert.equal(reference.scrollTop,65);
  assert.equal(box.scrollLeft,180);
});

test('wide horizontal pans and target-anchored pinch keep the other vertical offsets fixed',()=>{
  const {zoom,box,reference,writing}=fixture();
  reference.scrollTop=20;writing.scrollTop=50;
  zoom.pinch({scale:2,fromX:600,fromY:210,lane:'writing'});
  assert.equal(writing.scrollTop,100);
  assert.equal(reference.scrollTop,20);
  const before=box.scrollLeft;
  zoom.pinch({fromX:600,fromY:200,toX:520,toY:205,lane:'writing'});
  assert.equal(box.scrollLeft,before+80);
  assert.equal(reference.scrollTop,20);
  assert.equal(writing.scrollTop,100);
});

test('narrow still scrolls the whole world, not an individual pane',()=>{
  const {zoom,box,world,paper,reference,writing}=fixture({wide:false});
  assert.equal(world.style.height,'741px');
  assert.equal(paper.style.height,'');
  assert.ok(!writing.hasAttribute('tabindex')&&!reference.hasAttribute('tabindex'));
  box.scrollTop=100;
  zoom.pinch({fromX:600,fromY:200,toX:590,toY:160,lane:'writing'});
  assert.equal(box.scrollTop,140);
  assert.equal(writing.scrollTop,0);
  assert.equal(reference.scrollTop,0);
});
