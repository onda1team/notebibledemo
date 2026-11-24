(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YeoVerseSearch=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function words(value){
    return String(value??'').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu)??[];
  }
  function create(bible){
    let index;
    return function search(value){
      const terms=words(value),phrase=terms.join('');
      if(!phrase)return [];
      index??=bible.books.flatMap(book=>book.chapters.flatMap(chapter=>chapter.verses.map(([number,text])=>({
        code:book.code,chapter:chapter.chapter,id:chapter.id,number,text,ref:chapter.label+' '+number+'절',normalized:words(text).join('')
      }))));
      const exact=[],related=[],distinct=[...new Set(terms)];
      for(const result of index){
        if(result.normalized.includes(phrase))exact.push(result);
        else if(distinct.length>=2&&distinct.every(term=>result.normalized.includes(term)))related.push(result);
      }
      return exact.concat(related);
    };
  }
  return {create};
});
