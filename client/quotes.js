(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YeoQuotes=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const extra={id:'PRO3',label:'잠언 3장',verses:[[3,'인자와 진리로 네게서 떠나지 않게 하고 그것을 네 목에 매며 네 마음판에 새기라']]};
  const colors={sage:'연초록',sand:'노랑',sky:'하늘색',neutral:'무채색'};
  const palette=v=>Object.hasOwn(colors,v)?v:'sage';
  function catalog(passages){return [...passages,extra];}
  function verse(passages,id,n){
    const chapter=typeof passages.byId==='function'?passages.byId(id):catalog(passages).find(p=>p.id===id);
    const match=chapter?.verses.find(v=>String(v[0])===String(n));
    return match?{id:chapter.id,number:match[0],ref:chapter.label+' '+match[0]+'절',text:match[1]}:null;
  }
  const validInstance=v=>typeof v==='string'&&/^[a-z0-9-]{8,80}$/i.test(v);
  function key(q){
    return 'quote:'+q.id+':'+q.number+(validInstance(q.instance)?':copy:'+q.instance:'');
  }
  function add(verse,existing,after){
    const item={id:verse.id,number:verse.number,color:'sage',after};
    if(existing.some(q=>q.id===item.id&&q.number===item.number)){
      do{item.instance=globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
      while(existing.some(q=>key(q)===key(item)));
    }
    return item;
  }
  function normalize(items,passages){
    const seen=new Set();
    return (Array.isArray(items)?items:[]).flatMap(item=>{
      if(!item||typeof item!=='object')return [];
      const v=verse(passages,item.id,item.number);
      if(!v)return [];
      const card={id:v.id,number:v.number,color:palette(item.color),...(typeof item.after==='string'?{after:item.after}:{}),
        ...(validInstance(item.instance)?{instance:item.instance}:{})};
      const k=key(card);if(seen.has(k))return [];
      seen.add(k);return [card];
    });
  }
  return {catalog,verse,normalize,colors,palette,key,add};
});
