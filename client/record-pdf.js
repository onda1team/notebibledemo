/* Self-contained, local print view: no storage, sync, or external assets. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YeoRecordPDF=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const array=x=>Array.isArray(x)?x:[];
  const text=x=>typeof x==='string'?x:'';
  const shade=(x,fallback)=>/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(text(x))?x:fallback;
  function strokes(raw){
    return array(raw).filter(s=>s&&['pen','highlight'].includes(s.mode)&&Array.isArray(s.points)&&s.points.length&&s.points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)));
  }
  function model(p,s,bible,{Quotes,Order,Records}){
    s=s?.version===2?s:{};
    const blocks=['note'];
    const saved=array(s.blocks);
    for(let i=1;i<saved.length&&saved[i]==='note-'+i;i++)blocks.push(saved[i]);
    const cards=Quotes.normalize(s.quotes,bible).map(q=>{
      const verse=Quotes.verse(bible,q.id,q.number),id=Quotes.key(q);
      return {id,kind:'quote',after:blocks.includes(q.after)?q.after:'before',title:verse.ref,text:verse.text,
        memo:text(s.quoteMemos?.[id]),marks:array(s.noteMarks?.[id]),ink:strokes(s.ink?.[id]),height:s.quoteHeights?.[id]??120};
    });
    const items=cards.filter(q=>q.after==='before');
    for(const k of blocks){
      const title=text(s.titles?.[k]),value=text(s.text?.[k]),ink=strokes(s.ink?.[k]);
      if(!s.deletedBlocks?.[k]&&(title.trim()||value.trim()||ink.length))
        items.push({id:'block:'+k,kind:'note',title,text:value,ink,marks:array(s.noteMarks?.[k]),height:k==='note'?s.notesHeight:s.heights?.[k]});
      items.push(...cards.filter(q=>q.after===k));
    }
    const migrated=new Map();
    array(s.timeline).forEach((e,i)=>{
      if(e?.kind==='type')migrated.set('type:'+(e.uid||i+':'+e.at),'block:'+e.block);
      if(e?.kind==='ink'&&e.ids?.[0])migrated.set('ink:'+e.ids[0],'block:'+e.block);
    });
    const preferred=Array.isArray(s.inlineOrder)?s.inlineOrder:array(s.manualOrder).filter(k=>typeof k==='string').map(k=>
      k.startsWith('legacy-text:')||k.startsWith('legacy-ink:')?'block:'+k.slice(k.indexOf(':')+1):migrated.get(k)||k);
    const lookup=new Map(items.map(item=>[item.id,item]));
    const highlights=new Map();
    for(const h of array(s.highlights))if(Number.isInteger(h?.verse)){
      if(!highlights.has(h.verse))highlights.set(h.verse,[]);
      highlights.get(h.verse).push(h);
    }
    return {label:p.label,customTitle:Records?.title(s.recordTitle)||'',verses:p.verses.map(([number,body])=>({number,body,marks:highlights.get(number)??[]})),
      scriptureInk:strokes(s.ink?.scripture),bulletinBody:Records?.bulletinBody?.(s.bulletinBody)??[],bulletinQuestions:Records?.bulletinQuestions?.(s.bulletinQuestions)??[],
      items:Order.ordered(items.map(i=>i.id),preferred).map(id=>lookup.get(id))};
  }
  function add(doc,where,tag,value='',className=''){
    const el=doc.createElement(tag);if(value)el.textContent=value;if(className)el.className=className;where.append(el);return el;
  }
  function marked(doc,el,value,marks,TextMarks){
    for(const item of TextMarks.segments(value,marks)){
      if(item.marked){const span=add(doc,el,'mark',item.text);span.style.backgroundColor=shade(item.color,'#f4df8d');}
      else el.append(doc.createTextNode(item.text));
    }
  }
  function drawInk(doc,parent,ink,rawHeight){
    if(!ink.length)return;
    const width=650,height=Math.max(64,Math.min(8192,Number.isFinite(rawHeight)?rawHeight:576)),svgNS='http://www.w3.org/2000/svg';
    const paths=ink.map(s=>{
      const pts=s.points.map(p=>[Math.max(-width,Math.min(width*2,p.x*width)),Math.max(-height,Math.min(height*2,p.y*height))]);
      const weight=Math.max(1,Math.min(20,Number(s.width)||3));
      const bounds=pts.reduce(([lo,hi],[,y])=>[Math.min(lo,y),Math.max(hi,y)],[Infinity,-Infinity]);
      return {pts,bounds,weight,color:shade(s.color,'#26352d'),opacity:s.mode==='highlight'?'.35':'1'};
    });
    // Bounded SVG strips let very tall handwriting split across pages rather than crop.
    for(let top=0;top<height;top+=480){
      const size=Math.min(480,height-top), visible=paths.filter(p=>p.bounds[1]+p.weight>=top&&p.bounds[0]-p.weight<=top+size);
      if(!visible.length)continue;
      const svg=doc.createElementNS(svgNS,'svg');svg.setAttribute('viewBox','0 '+top+' '+width+' '+size);
      svg.setAttribute('width',String(width));svg.setAttribute('height',String(size));svg.setAttribute('class','print-ink');svg.setAttribute('aria-label','손글씨 필기');
      for(const p of visible){
        const point=p.pts.length===1,el=doc.createElementNS(svgNS,point?'circle':'polyline');
        el.setAttribute('opacity',p.opacity);
        if(point){el.setAttribute('cx',p.pts[0][0]);el.setAttribute('cy',p.pts[0][1]);el.setAttribute('r',p.weight/2);el.setAttribute('fill',p.color);}
        else{el.setAttribute('points',p.pts.map(x=>x.join(',')).join(' '));el.setAttribute('fill','none');el.setAttribute('stroke',p.color);el.setAttribute('stroke-width',p.weight);el.setAttribute('stroke-linejoin','round');el.setAttribute('stroke-linecap','round');}
        svg.append(el);
      }
      parent.append(svg);
    }
  }
  // Use real DOM page containers so the screen and PDF share the same boundaries,
  // including browsers that cannot print CSS @page margin boxes.
  function paginate(doc,main){
    const source=main.cloneNode(true),pages=[];
    const wrap=(parent,child)=>{const out=parent.cloneNode(false);out.append(child);return out;};
    let body;
    function page(){
      if(pages.length>=250)throw Error('too_many_pages');
      const sheet=add(doc,main,'div','','print-sheet');
      body=add(doc,sheet,'div','','print-sheet-body');
      pages.push(add(doc,sheet,'footer','','print-page-end'));
    }
    function tryPlace(unit){
      body.append(unit);
      if(body.scrollHeight<=body.clientHeight+1)return true;
      unit.remove();return false;
    }
    function textSlice(el,from,to){
      let index=0;
      function copy(node){
        if(node.nodeType===3){
          const start=index;index+=node.length;
          const part=node.data.slice(Math.max(0,from-start),Math.max(0,Math.min(node.length,to-start)));
          return part?doc.createTextNode(part):null;
        }
        if(node.nodeType!==1||index>=to)return null;
        const next=node.cloneNode(false);
        for(const child of node.childNodes){const part=copy(child);if(part)next.append(part);}
        return next.childNodes.length?next:null;
      }
      const out=copy(el);if(!out)throw Error('text_range');return out;
    }
    function splitText(el,builder){
      const sourceText=el.textContent;
      const lowSurrogate=i=>i>0&&i<sourceText.length&&/[\udc00-\udfff]/.test(sourceText[i])&&/[\ud800-\udbff]/.test(sourceText[i-1]);
      let offset=0;
      while(offset<sourceText.length){
        let lo=offset+1,hi=sourceText.length,best=offset;
        while(lo<=hi){
          const mid=Math.floor((lo+hi)/2),end=lowSurrogate(mid)?mid-1:mid;
          if(end<=offset){lo=mid+1;continue;}
          const trial=builder(textSlice(el,offset,end));
          const fits=tryPlace(trial);
          if(fits){trial.remove();best=end;lo=mid+1;}else hi=mid-1;
        }
        if(best===offset)throw Error('paragraph_does_not_fit');
        if(best<sourceText.length){
          let word=best;
          while(word>offset&&best-word<25&&!/\s/.test(sourceText[word-1]))word--;
          if(word>offset&&best-word<25)best=word;
        }
        if(!tryPlace(builder(textSlice(el,offset,best))))throw Error('paragraph_overflow');
        offset=best;if(offset<sourceText.length)page();
      }
    }
    function place(row,builder=x=>x){
      if(tryPlace(builder(row.cloneNode(true))))return;
      if(body.childElementCount){page();if(tryPlace(builder(row.cloneNode(true))))return;}
      if(row.matches('p')&&row.textContent.length){splitText(row,builder);return;}
      if(row.childElementCount&&row.matches('article,header,div')){
        for(const child of row.children)place(child,x=>builder(wrap(row,x)));
        return;
      }
      throw Error('unbreakable_print_content');
    }
    try{
      main.replaceChildren();main.dataset.paginated='true';page();
      const header=doc.createElement('header');
      for(const item of source.children){
        if(item.tagName!=='SECTION')header.append(item.cloneNode(true));
      }
      if(header.childElementCount)place(header);
      for(const section of source.querySelectorAll(':scope > section')){
        const children=[...section.children];
        for(let i=0;i<children.length;i++){
          const row=children[i];
          if(row.matches('h2,h3')&&children[i+1]?.matches('p')){
            const group=doc.createElement('div');group.className='print-keep';
            group.append(row.cloneNode(true),children[++i].cloneNode(true));place(group,x=>wrap(section,x));
          }else place(row,x=>wrap(section,x));
        }
      }
      pages.forEach((footer,i)=>footer.textContent=(i+1)+' / '+pages.length+'쪽');
      return true;
    }catch{
      delete main.dataset.paginated;main.replaceChildren(...source.childNodes);
      return false;
    }
  }
  function render(printWindow,data,stamp,TextMarks,stylesheet){
    const doc=printWindow.document;doc.documentElement.lang='ko';
    doc.head.replaceChildren();doc.body.replaceChildren();doc.title=(data.customTitle?[data.customTitle.replace(/[\\/:*?"<>|]+/g,' ').trim(),data.label].filter(Boolean).join(' · '):data.label)+' - 여백성경 내 기록';
    const viewport=doc.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1';doc.head.append(viewport);
    const css=doc.createElement('link');css.rel='stylesheet';css.href=stylesheet;
    const tools=add(doc,doc.body,'aside','','print-tools');
    const save=add(doc,tools,'button','PDF로 저장');save.type='button';
    save.addEventListener('click',()=>{try{printWindow.focus();printWindow.print();}catch{info.textContent='인쇄를 열지 못했어요. 브라우저의 인쇄 메뉴를 사용해 주세요.';}});
    save.disabled=true;
    const info=add(doc,tools,'p','A4 페이지를 나누는 중이에요.');
    const main=add(doc,doc.body,'main');
    add(doc,main,'p','주의열매 · 코넬 여백성경','print-brand');add(doc,main,'h1',data.customTitle||data.label);
    if(data.customTitle)add(doc,main,'p',data.label,'print-date');
    if(stamp)add(doc,main,'p',stamp,'print-date');
    const scripture=add(doc,main,'section','','print-scripture');add(doc,scripture,'h2','성경 본문');
    for(const verse of data.verses){
      const line=add(doc,scripture,'p');add(doc,line,'sup',String(verse.number));line.append(' ');marked(doc,line,verse.body,verse.marks,TextMarks);
    }
    add(doc,scripture,'p','성경전서 개역한글판 © 대한성서공회 1961','print-date');
    if(data.scriptureInk.length){
      add(doc,scripture,'h3','본문 위 손글씨');add(doc,scripture,'p','화면과 종이의 줄바꿈이 달라 손글씨는 별도로 표시했어요.','print-date');
      drawInk(doc,scripture,data.scriptureInk,Math.min(8192,Math.max(490,data.verses.reduce((h,v)=>h+Math.max(1,Math.ceil(v.body.length/44))*27+9,0))));
    }
    if(data.bulletinBody?.length){
      const body=add(doc,main,'section','','print-bulletin-body');add(doc,body,'h2','주보 본문');
      data.bulletinBody.forEach(({text,reference},i)=>{
        // Paragraphs remain literal text. The existing paginator can split a long
        // paragraph while preserving its line breaks and ordinary text wrapping.
        if(data.bulletinBody.length>1)add(doc,body,'h3','주보 '+(i+1));
        if(reference.trim())add(doc,body,'p','관련 말씀: '+reference,'print-bulletin-reference print-value');
        add(doc,body,'p',text,'print-bulletin-text print-value');
      });
    }
    if(data.bulletinQuestions?.length){
      const bulletin=add(doc,main,'section','','print-bulletin');add(doc,bulletin,'h2','주보 질문과 답변');
      data.bulletinQuestions.forEach(({question,answer,reference},i)=>{
        add(doc,bulletin,'h3','질문 '+(i+1));
        if(question.trim())add(doc,bulletin,'p',question,'print-value');
        if(reference.trim())add(doc,bulletin,'p','관련 말씀: '+reference,'print-bulletin-reference print-value');
        if(answer.trim())add(doc,bulletin,'p','답변: '+answer,'print-value');
      });
    }
    const notes=add(doc,main,'section','','print-notes');add(doc,notes,'h2','나의 여백');
    if(!data.items.length)add(doc,notes,'p','작성한 메모나 손글씨가 없어요.','print-date');
    for(const item of data.items){
      const box=add(doc,notes,'article','',item.kind==='quote'?'print-card':'print-note');
      add(doc,box,'h3',item.title||(item.kind==='note'?(item.text.trim()?'메모':'손글씨'):'말씀 카드'));
      if(item.text.trim())marked(doc,add(doc,box,'p','','print-value'),item.text,item.marks,TextMarks);
      if(item.memo?.trim()){add(doc,box,'h4','말씀 메모');add(doc,box,'p',item.memo,'print-value');}
      if(item.kind==='quote'){
        drawInk(doc,box,item.ink.filter(s=>s.zone!=='pad'),item.height);
        drawInk(doc,box,item.ink.filter(s=>s.zone==='pad'),item.height);
      }else drawInk(doc,box,item.ink,item.height);
    }
    const ready='A4 세로 · 100% 기준이에요. 점선 아래 숫자는 페이지 번호입니다. 인쇄 창에서 A4와 기본 여백을 확인하고 PDF로 저장하세요.';
    css.addEventListener('load',async()=>{
      try{await doc.fonts?.ready;}catch{}
      const ok=paginate(doc,main);save.disabled=false;
      info.textContent=ok?ready:'페이지 경계를 계산하지 못했어요. 일반 PDF 인쇄는 할 수 있습니다.';
      save.focus({preventScroll:true});
    },{once:true});
    css.addEventListener('error',()=>{save.disabled=false;info.textContent='PDF 서식을 불러오지 못했어요. 미리보기를 닫고 다시 열어 주세요.';},{once:true});
    doc.head.append(css);
  }
  return {model,render};
});
