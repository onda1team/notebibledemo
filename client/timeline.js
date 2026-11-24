(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.YeoTimeline=factory();
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function typedDelta(before,after){
   if(before===after||!after.trim())return '';
   if(after.startsWith(before))return after.slice(before.length).trim();
   return after.trim();
 }
 function pushInk(events,block,id,at){
   const last=events[events.length-1];
   if(last?.kind==='ink'&&last.block===block&&at-last.at<90000&&at>=last.at){last.ids.push(id);last.at=at;}
   else events.push({kind:'ink',block,ids:[id],at});
 }
 function read(items,blocks){
   return (Array.isArray(items)?items:[]).filter(e=>{
     if(!e||!Number.isFinite(e.at))return false;
     if(e.kind==='ink')return blocks.includes(e.block)&&Array.isArray(e.ids)&&e.ids.every(v=>typeof v==='string');
     if(e.kind==='type')return blocks.includes(e.block)&&typeof e.text==='string';
     return e.kind==='quote'&&typeof e.id==='string'&&Number.isInteger(e.number);
   });
 }
 return {typedDelta,pushInk,read};
});
