(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YeoBible=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // [book code, Korean name, chapters]; each chapter contains numbered verse pairs.
  function create(rows,legacy=[]){
    const preserved=new Map(legacy.map(chapter=>[chapter.id,chapter]));
    const books=[],byBook=new Map(),byChapter=new Map();
    rows.forEach(([code,name,chapters],i)=>{
      const book={code,name,testament:i<39?'구약':'신약',chapters:[]};
      books.push(book);byBook.set(code,book);
      chapters.forEach((source,index)=>{
        const chapter=index+1,id=code+chapter,old=preserved.get(id);
        const verses=old?.verses??source;
        const entry={id,code,book:name,chapter,label:name+' '+chapter+'장',verses};
        book.chapters.push(entry);byChapter.set(id,entry);
      });
    });
    return {books,book:code=>byBook.get(code),byId:id=>byChapter.get(id),chapter:(code,n)=>byBook.get(code)?.chapters[Number(n)-1]};
  }
  function range(p,from,to){
    const start=Number(from),end=Number(to);
    if(!p||!Number.isInteger(start)||!Number.isInteger(end)||start>end||
      !p.verses.some(([n])=>n===start)||!p.verses.some(([n])=>n===end))return null;
    return {start,end,chapterId:p.id,full:start===p.verses[0][0]&&end===p.verses.at(-1)[0],
      label:p.label+' '+(start===end?start:start+'–'+end)+'절'};
  }
  // An untouched end follows the start; an intentionally extended range stays put
  // until the new start exceeds it.
  function endForStart(start,previousStart,previousEnd){
    const a=Number(start),before=Number(previousStart),end=Number(previousEnd);
    return before===end||end<a?a:end;
  }
  function viewKey(account,p){return account&&p?.id?'yeobaek-verse-view-v1:'+account+':'+p.id:null;}
  function readView(storage,account,p){
    const key=viewKey(account,p);
    try{const v=key?JSON.parse(storage.getItem(key)):null;const r=v&&range(p,v.start,v.end);return r&&!r.full?r:null;}catch{return null;}
  }
  function writeView(storage,account,p,r){
    const key=viewKey(account,p);
    if(!key)return;
    try{
      if(r&&!r.full&&r.chapterId===p.id)storage.setItem(key,JSON.stringify({start:r.start,end:r.end}));
      else storage.removeItem(key);
    }catch{}
  }
  return {create,range,endForStart,readView,writeView};
});
