/* Zooms the existing paper plane. On a wide spread only the chosen pane pans vertically. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const scroller=$('readerScroll'),world=$('readerWorld'),paper=$('readerSheet');
  const out=$('zoomOut'),reset=$('zoomReset'),inside=$('zoomIn');
  const reference=$('scriptureReference'),writing=$('writingPaper')||paper.querySelector('.writing-paper');
  const notice=$('trashedChapter'),wide=matchMedia('(min-width:560px)');
  const min=.6,max=4;
  let ratio=1,left=0,width=0,readjust=0;
  const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
  function paneAt(lane,x,y){
    if(!wide.matches)return null;
    if(lane==='reference')return reference;
    if(lane==='writing')return writing;
    for(const pane of [reference,writing]){
      const b=pane.getBoundingClientRect();
      if(x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom)return pane;
    }
    return null;
  }
  function updateTabStops(isWide){
    for(const pane of [reference,writing]){
      if(isWide){if(!pane.hasAttribute('tabindex'))pane.tabIndex=0;}
      else if(pane.hasAttribute('tabindex'))pane.removeAttribute('tabindex');
    }
  }
  function layout(){
    const available=scroller.clientWidth;
    const isWide=wide.matches;
    width=Math.min(1120,Math.max(1,available-(isWide?22:10)));
    const scaled=width*ratio;
    left=Math.max(0,(available-scaled)/2);
    paper.style.width=width+'px';
    paper.style.left=left+'px';
    paper.style.transform='scale('+ratio+')';
    world.style.width=Math.max(available,Math.ceil(scaled))+'px';
    if(isWide){
      // The wheel/trackpad can still move the world horizontally after zooming.
      // Measure its actual viewport after setting width (classic scrollbars)
      // and after any visible status banner above the sheet.
      const h=Math.max(1,scroller.clientHeight-world.offsetTop);
      paper.style.height=Math.max(1,h-7)/ratio+'px';
      world.style.height=h+'px';
      if(scroller.scrollTop)scroller.scrollTop=0;
    }else{
      paper.style.height='';
      world.style.height=Math.ceil(paper.offsetHeight*ratio+21)+'px';
    }
    updateTabStops(isWide);
    reset.textContent=Math.round(ratio*100)+'%';
    out.disabled=ratio<=min;inside.disabled=ratio>=max;
  }
  function schedule(){if(!readjust)readjust=requestAnimationFrame(()=>{readjust=0;layout();window.CornellApp?.redraw();});}
  function pinch({scale=1,fromX,fromY,toX=fromX,toY=fromY,lane}){
    if(!Number.isFinite(scale)||scale<=0||![fromX,fromY,toX,toY].every(Number.isFinite))return;
    const box=scroller.getBoundingClientRect();
    const aX=fromX-box.left,aY=fromY-box.top,bX=toX-box.left,bY=toY-box.top;
    const localX=(scroller.scrollLeft+aX-left)/ratio;
    const pane=paneAt(lane,fromX,fromY);
    const localY=pane?pane.scrollTop+(fromY-pane.getBoundingClientRect().top)/ratio:(scroller.scrollTop+aY-1)/ratio;
    const next=clamp(ratio*scale,min,max);
    const panOnly=wide.matches&&next===ratio;
    const vertical=panOnly&&Math.abs(toY-fromY)>=Math.abs(toX-fromX);
    if(next!==ratio){ratio=next;layout();window.CornellApp?.redraw();}
    // At a fixed zoom, constrain panning to its dominant axis. A few pixels of
    // horizontal finger drift must not move the opposite pane on a vertical pan.
    if(!vertical)scroller.scrollLeft=left+localX*ratio-bX;
    if(pane&&(!panOnly||vertical))pane.scrollTop=localY-(toY-pane.getBoundingClientRect().top)/ratio;
    else if(!wide.matches)scroller.scrollTop=1+localY*ratio-bY;
  }
  function step(scale){
    const b=scroller.getBoundingClientRect();
    const x=b.left+scroller.clientWidth/2,y=b.top+Math.min(160,scroller.clientHeight/2);
    pinch({scale,fromX:x,fromY:y});
  }
  out.addEventListener('click',()=>step(1/1.25));
  inside.addEventListener('click',()=>step(1.25));
  reset.addEventListener('click',()=>step(1/ratio));
  scroller.addEventListener('wheel',e=>{
    if(!e.ctrlKey)return;
    e.preventDefault();
    pinch({scale:Math.exp(-clamp(e.deltaY,-120,120)*.01),fromX:e.clientX,fromY:e.clientY});
  },{passive:false});
  const observer=new ResizeObserver(schedule);
  observer.observe(scroller);observer.observe(paper);
  if(notice)observer.observe(notice);
  window.addEventListener('resize',schedule);
  window.CornellZoom={pinch,scale:()=>ratio,restoreScale:value=>{
    if(Number.isFinite(value)){ratio=clamp(value,min,max);layout();}
  }};
  layout();
})();
