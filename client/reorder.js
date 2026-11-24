(function(root,factory){
 if(typeof module==='object'&&module.exports) module.exports=factory();
 else root.YeoReorder=factory();
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function ordered(ids,preferred){
   const pending=new Set(ids),out=[];
   for(const id of preferred||[])if(pending.delete(id))out.push(id);
   for(const id of ids)if(pending.delete(id))out.push(id);
   return out;
 }
 function moved(ids,id,target,after=false){
   if(id===target||!ids.includes(id)||!ids.includes(target))return ids.slice();
   const out=ids.filter(k=>k!==id);
   out.splice(out.indexOf(target)+(after?1:0),0,id);
   return out;
 }
 function hit(rect,x,y){
   return !!rect&&x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;
 }
 function mount(list,scroller,onDrop,options={}){
   const activeScroller=()=>drag?.scroller??options.getScroller?.()??scroller;
   const top=()=>options.clipTop?.()??activeScroller().getBoundingClientRect().top;
   let drag=null, frame=0, target=null, trashTarget=false;
   const trash=options.trash;
   function trashHover(on){trashTarget=on;trash?.classList.toggle('is-over',on);}
   const cardFor=e=>e.target.closest?.('[data-order-id]');
   function clearTarget(){if(target)target.card.removeAttribute('data-insert');target=null;}
   function locate(){
     clearTarget();trashHover(false);
     if(!drag?.moving)return;
     if(trash&&!trash.hidden&&hit(trash.getBoundingClientRect(),drag.x,drag.y)){trashHover(true);return;}
     const visible=activeScroller().getBoundingClientRect();
     if(drag.x<visible.left-20||drag.x>visible.right+20||drag.y<visible.top-20||drag.y>visible.bottom+20)return;
     const clipTop=top();
     const cards=[...list.querySelectorAll('[data-order-id]')].filter(c=>c!==drag.card&&c.dataset.empty!=='true'&&c.getBoundingClientRect().bottom>clipTop&&c.getBoundingClientRect().top<visible.bottom);
     if(!cards.length)return;
     const y=Math.max(clipTop,Math.min(visible.bottom,drag.y));
     for(const card of cards){
       const r=card.getBoundingClientRect();
       if(y<r.top+r.height/2){target={card,after:false};break;}
     }
     if(!target)target={card:cards.at(-1),after:true};
     target.card.dataset.insert=target.after?'after':'before';
   }
   function tick(){
     if(!drag?.moving)return;
     const lane=activeScroller(),r=lane.getBoundingClientRect(),clipTop=top();
     if(!trashTarget&&drag.y>r.bottom-39&&drag.y<r.bottom+12)lane.scrollTop+=10;
     else if(!trashTarget&&drag.y<clipTop+30&&drag.y>r.top-5)lane.scrollTop-=10;
     locate();frame=requestAnimationFrame(tick);
   }
   function reset(){
     if(frame)cancelAnimationFrame(frame);
     frame=0;clearTarget();trashHover(false);if(trash)trash.hidden=true;
     if(drag){
       const {card,id,handle}=drag;drag=null;
       card.classList.remove('is-dragging');
       if(handle.hasPointerCapture?.(id))handle.releasePointerCapture(id);
     }
   }
   list.addEventListener('pointerdown',e=>{
     const handle=e.target.closest?.('[data-drag-handle]'),card=cardFor(e);
     if(!handle||!card||handle.disabled||e.target.closest?.('select, [data-card-control]')||!e.isPrimary||e.button!==0)return;
     drag={card,handle,id:e.pointerId,start:e.clientY,x:e.clientX,y:e.clientY,moving:false,scroller:options.getScroller?.()??scroller};
     try{handle.setPointerCapture(e.pointerId);}catch{}
   });
   list.addEventListener('pointermove',e=>{
     if(!drag||drag.id!==e.pointerId)return;
     drag.x=e.clientX;drag.y=e.clientY;
     if(!drag.moving&&Math.abs(drag.y-drag.start)>5){drag.moving=true;drag.card.classList.add('is-dragging');if(trash)trash.hidden=false;tick();}
     if(drag.moving){e.preventDefault();locate();}
   });
   list.addEventListener('pointerup',e=>{
     if(!drag||drag.id!==e.pointerId)return;
     if(drag.moving){
       drag.x=e.clientX;drag.y=e.clientY;locate();
       const id=drag.card.dataset.orderId,t=target,remove=trashTarget;
       reset();if(remove)options.onTrash?.(id);else if(t)onDrop(id,t.card.dataset.orderId,t.after);
     }else reset();
   });
   list.addEventListener('pointercancel',reset);list.addEventListener('lostpointercapture',reset);
   scroller.addEventListener('close',reset);
 }
 return {ordered,moved,mount,hit};
});
