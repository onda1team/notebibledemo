(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YeoRecords=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const prefixes=['yeobaek-paper-v3:','yeobaek-paper-v2:','yeobaek-cornell-v1:'];
  const visitPrefix='yeobaek-opened-chapter-v1:';
  const accountPrefix=account=>typeof account==='string'&&account?visitPrefix+encodeURIComponent(account)+':':null;
  const array=v=>Array.isArray(v)?v:[];
  const text=v=>typeof v==='string'?v.trim():'';
  const title=v=>text(typeof v==='string'?v.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g,' '):v).slice(0,80).replace(/[\uD800-\uDBFF]$/,'').trimEnd();
  const bulletinLimits={id:80,question:700,answer:5000,reference:100};
  const bulletinKeys=Object.keys(bulletinLimits);
  function bulletinQuestions(value){
    const seen=new Set(),out=[];
    for(const entry of array(value).slice(0,30)){
      if(!entry||!text(entry.id)||seen.has(entry.id)||
        !bulletinKeys.every(key=>typeof entry[key]==='string'&&entry[key].length<=bulletinLimits[key]))continue;
      seen.add(entry.id);
      if(entry.question.trim()||entry.answer.trim()){
        const {id,question,answer,reference}=entry;out.push({id,question,answer,reference});
      }
    }
    return out;
  }
  function bulletinBody(value){
    const seen=new Set(),out=[];
    for(const entry of array(value).slice(0,10)){
      if(!entry||!text(entry.id)||entry.id.length>80||seen.has(entry.id)||
        typeof entry.text!=='string'||entry.text.length>12000||
        typeof entry.reference!=='string'||entry.reference.length>100)continue;
      seen.add(entry.id);
      if(entry.text.trim()){
        const {id,text,reference}=entry;out.push({id,text,reference});
      }
    }
    return out;
  }
  const clip=(value,length)=>value.slice(0,length).replace(/[\uD800-\uDBFF]$/,'');
  const oneLine=v=>text(v).replace(/\s+/g,' ');
  function bulletinSnippet(entry){
    const question=oneLine(entry.question),answer=oneLine(entry.answer);
    if(question&&answer)return '질문: '+clip(question,28)+' · 답변: '+clip(answer,30);
    return (question?'질문: ':'답변: ')+clip(question||answer,66);
  }
  function ink(value){return array(value).some(s=>s&&['pen','highlight'].includes(s.mode)&&Array.isArray(s.points)&&s.points.length>0&&s.points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)));}
  function date(value){
    if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;
    if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)){const n=Date.parse(value);return Number.isFinite(n)&&n>0?n:null;}
    return null;
  }
  const trashed=s=>Number.isSafeInteger(s?.trashedAt)&&s.trashedAt>0&&s.trashedAt<=8.64e15;
  function describe(s,p,bible,sourceKey){
    if(!s||typeof s!=='object'||Array.isArray(s))return null;
    const legacy=sourceKey.startsWith(prefixes[2]);
    if(s.version!==(legacy?1:2))return null;
    const blocks=legacy?['cue','main','summary']:['note'];
    if(!legacy&&Array.isArray(s.blocks))for(let i=1;i<s.blocks.length&&s.blocks[i]==='note-'+i;i++)blocks.push(s.blocks[i]);
    const active=blocks.filter(k=>s.deletedBlocks?.[k]!==true);
    const snippets=active.map(k=>[text(s.titles?.[k]),text(s.text?.[k])].filter(Boolean).join(' · ')).filter(Boolean);
    const quotes=array(s.quotes).some(q=>{
      if(!q||typeof q.id!=='string'||!Number.isInteger(q.number)||q.number<1)return false;
      try{const chapter=bible.byId(q.id);return !!chapter&&(Array.isArray(chapter.verses)?chapter.verses.some(v=>v[0]===q.number):true);}catch{return false;}
    });
    const bulletin=legacy?[]:bulletinQuestions(s.bulletinQuestions);
    const fullBulletin=legacy?[]:bulletinBody(s.bulletinBody);
    const hasNotes=snippets.length>0||active.some(k=>ink(s.ink?.[k]))||quotes||bulletin.length>0||fullBulletin.length>0;
    const hasScripture=ink(s.ink?.scripture)||array(s.highlights).some(h=>h&&Number.isInteger(h.verse)&&h.verse>0&&Number.isInteger(h.start)&&h.start>=0&&Number.isInteger(h.end)&&h.end>h.start&&text(h.quote));
    const customTitle=legacy?'':title(s.recordTitle);
    if(!hasNotes&&!hasScripture&&!customTitle)return null;
    const questionPreview=bulletin.length?bulletinSnippet(bulletin[0]):'';
    const preview=fullBulletin.length?'주보: '+clip(oneLine(fullBulletin[0].text),questionPreview?28:66)+(questionPreview?' · '+questionPreview:''):questionPreview||snippets.join(' ');
    return {id:p.id,label:p.label,customTitle,code:p.code,chapter:p.chapter,hasNotes,hasScripture,updatedAt:date(s.updatedAt),...(trashed(s)?{trashedAt:s.trashedAt}:{}),
      ...(bulletin.length?{bulletinQuestionCount:bulletin.length}:{}),...(fullBulletin.length?{bulletinBodyCount:fullBulletin.length}:{}),
      snippet:clip(oneLine(preview),70),sourceKey};
  }
  function list(storage,bible){
    const ids=new Set(),result=[];
    try{
      const length=storage.length;
      for(let i=0;i<length;i++){
        let key;try{key=storage.key(i);}catch{continue;}
        if(typeof key!=='string')continue;
        const prefix=prefixes.find(p=>key.startsWith(p));
        if(prefix&&key.length>prefix.length)ids.add(key.slice(prefix.length));
      }
    }catch{return result;}
    for(const id of ids){
      try{
        const p=bible.byId(id);if(!p)continue;
        // A present current record (even empty or malformed) shadows legacy data.
        // Falling through would resurrect records the user has already erased.
        for(const prefix of prefixes){
          const sourceKey=prefix+id,raw=storage.getItem(sourceKey);
          if(raw===null||raw===undefined)continue;
          const entry=describe(JSON.parse(raw),p,bible,sourceKey);
          if(entry)result.push(entry);
          break;
        }
      }catch{/* One unreadable record must not hide the others. */}
    }
    return result.sort((a,b)=>(b.updatedAt??-1)-(a.updatedAt??-1)||a.id.localeCompare(b.id));
  }
  // Opening a chapter must never create, import, or alter its note record.
  function rememberOpening(storage,account,id,bible,now=Date.now()){
    try{
      const prefix=accountPrefix(account),p=bible.byId(id);
      if(!prefix||!p||!Number.isSafeInteger(now)||now<1||now>8.64e15)return false;
      const key=prefix+p.id;
      const previous=Number(storage.getItem(key));
      if(previous<0)return true; // Do not resurrect a trashed opening when browsing.
      if(!Number.isSafeInteger(previous)||previous<now||previous>8.64e15)storage.setItem(key,String(now));
      return true;
    }catch{return false;}
  }
  function trashOpening(storage,account,id,bible,trash){
    try{
      const prefix=accountPrefix(account),p=bible.byId(id);
      if(!prefix||p?.id!==id)return false;
      const key=prefix+id, abs=Math.abs(Number(storage.getItem(key)));
      if(!Number.isSafeInteger(abs)||abs<1||abs>8.64e15)return false;
      storage.setItem(key,String(trash?-abs:abs));return true;
    }catch{return false;}
  }
  function withOpenings(entries,storage,account,bible){
    const result=new Map(entries.map(item=>[item.id,item]));
    try{
      const prefix=accountPrefix(account);
      if(prefix){
        const length=storage.length;
        for(let i=0;i<length;i++){
          try{
            const key=storage.key(i);
            if(!key?.startsWith(prefix))continue;
            const id=key.slice(prefix.length),p=bible.byId(id),openedAt=Number(storage.getItem(key));
            if(!p||p.id!==id||result.has(id)||!Number.isSafeInteger(openedAt)||!openedAt||Math.abs(openedAt)>8.64e15)continue;
            result.set(id,{id,label:p.label,code:p.code,chapter:p.chapter,hasNotes:false,hasScripture:false,updatedAt:Math.abs(openedAt),openedOnly:true,...(openedAt<0?{trashedAt:Math.abs(openedAt)}:{})});
          }catch{/* An unreadable opening must not hide saved notes. */}
        }
      }
    }catch{/* Unavailable browser storage must not hide saved notes. */}
    return [...result.values()].sort((a,b)=>(b.updatedAt??-1)-(a.updatedAt??-1)||a.id.localeCompare(b.id));
  }
  return {title,bulletinQuestions,bulletinBody,list,rememberOpening,withOpenings,trashOpening,trashed};
});
