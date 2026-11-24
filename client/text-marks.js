(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YeoTextMarks=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const string=v=>typeof v==='string'?v:'';
  function boundary(text,index){
    return Number.isInteger(index)&&index>=0&&index<=text.length&&!(index>0&&index<text.length&&/[\uD800-\uDBFF]/.test(text[index-1])&&/[\uDC00-\uDFFF]/.test(text[index]));
  }
  function clean(items,text){
    text=string(text);
    return (Array.isArray(items)?items:[]).flatMap(m=>{
      if(!m||!boundary(text,m.start)||!boundary(text,m.end)||m.start>=m.end||typeof m.quote!=='string'||text.slice(m.start,m.end)!==m.quote)return [];
      const mark={start:m.start,end:m.end,quote:m.quote};
      if(typeof m.color==='string')mark.color=m.color;
      return [mark];
    });
  }
  function forEdit(items,oldText,newText,selection){
    oldText=string(oldText);newText=string(newText);
    const marks=clean(items,oldText);
    if(oldText===newText)return marks;
    const limit=Math.min(oldText.length,newText.length);let prefix=0,suffix=0;
    while(prefix<limit&&oldText[prefix]===newText[prefix])prefix++;
    while(suffix<limit&&oldText[oldText.length-1-suffix]===newText[newText.length-1-suffix])suffix++;
    function preserveEdit(start,end){
      if(!boundary(oldText,start)||!boundary(oldText,end)||start>end)return null;
      const after=newText.length-(oldText.length-end);
      if(after<start||(after===start?end===start:!/^\s+$/u.test(newText.slice(start,after)))||
        newText.slice(0,start)!==oldText.slice(0,start)||newText.slice(after)!==oldText.slice(end))return null;
      const offset=after-end;
      return clean(marks.flatMap(m=>{
        const result=[];
        const leftEnd=Math.min(m.end,start),rightStart=Math.max(m.start,end);
        if(m.start<leftEnd)result.push({...m,end:leftEnd,quote:oldText.slice(m.start,leftEnd)});
        if(rightStart<m.end)result.push({...m,start:rightStart+offset,end:m.end+offset,quote:oldText.slice(rightStart,m.end)});
        return result;
      }),newText);
    }
    // Browser selection disambiguates repeated characters. Verify it against
    // both texts before remapping; new whitespace stays uncolored.
    const delta=newText.length-oldText.length, kept=Math.min(limit,prefix+suffix);
    const lo=Math.max(0,kept-suffix),hi=Math.min(prefix,kept);
    let known=preserveEdit(selection?.start,selection?.end);
    if(!known&&delta<0&&Number.isInteger(selection?.start)&&selection.start===selection.end){
      const pos=selection.start;
      if(/^delete.*Backward$/.test(selection.type??''))known=preserveEdit(pos+delta,pos);
      else if(/^delete.*Forward$/.test(selection.type??''))known=preserveEdit(pos,pos-delta);
    }
    if(!known&&delta>0)known=preserveEdit(prefix,prefix);
    if(!known&&delta<0&&lo===hi)known=preserveEdit(lo,oldText.length-kept+lo);
    if(known)return known;
    // Unrelated replacements or ambiguous edits without a cursor retain only
    // ranges whose location is the same for every minimal edit.
    return marks.flatMap(m=>{
      let position=null;
      for(let start=lo;start<=hi;start++){
        const end=oldText.length-kept+start;
        let next;
        if(m.end<=start)next={...m};
        else if(m.start>=end)next={...m,start:m.start+delta,end:m.end+delta};
        else return [];
        if(position&&(position.start!==next.start||position.end!==next.end))return [];
        position=next;
      }
      return clean(position?[position]:[],newText);
    });
  }
  function segments(text,marks){
    text=string(text);
    const ranges=clean(marks,text);
    const bounds=[...new Set([0,text.length,...ranges.flatMap(m=>[m.start,m.end])])].sort((a,b)=>a-b);
    const result=[];
    for(let i=1;i<bounds.length;i++){
      const start=bounds[i-1],end=bounds[i],top=ranges.findLast(m=>m.start<=start&&m.end>=end);
      const marked=!!top, color=top?.color,last=result.at(-1);
      if(last&&last.marked===marked&&last.color===color){last.end=end;last.text+=text.slice(start,end);}
      else result.push({start,end,text:text.slice(start,end),marked,...(color?{color}:{})});
    }
    return result;
  }
  // Snap a UTF-16 offset away from the middle of a surrogate pair.
  function codepointBoundary(text,index,direction=1){
    text=string(text);index=Number.isFinite(index)?Math.max(0,Math.min(text.length,Math.trunc(index))):0;
    return boundary(text,index)?index:index+(direction<0?-1:1);
  }
  return {clean,forEdit,segments,codepointBoundary};
});
