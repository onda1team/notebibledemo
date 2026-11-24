(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YeoPin=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const available=(view,scale)=>Math.max(12,(view-12)/scale);
  function offset(scroll,scale,column,reference){
    return Math.max(0,Math.min((scroll-1)/scale,column-reference));
  }
  return {available,offset};
});
