(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YeoBulletinQuestions=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const LIMIT=30,MAX_QUESTION=700,MAX_ANSWER=5000,MAX_BODIES=10,MAX_BODY=12000;
  const mark=/^[\s▶▷►▸◆◇■□●○▪–—:>*#·ㆍ|]+/u;
  const markNumber=/^\s*(?:(?:[Qq]|문항|질문)\s*)?(?:\(?([0-9０-９]{1,2})\s*[.．、)）:：]|([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]))\s*/u;
  const weakNumber=/^([0-9０-９]{1,2})\s+(?=[가-힣ㄱ-ㅎㅏ-ㅣ])/u;
  const recognized=/^(?:본문나눔|본문나눔질문|결단하기|결단질문|적용하기|적용질문|나눔질문|묵상질문|말씀나눔|말씀질문|오늘의질문|함께나눌질문|질문나눔|생각나누기|토의질문|실천하기|삶에적용(?:하기)?|나의결단|질문)$/u;
  const general=/^(?:교회소식|광고|예배안내|모임안내|헌금안내|기도제목|새가족안내|새가족소개|교우동정|들어가기|본문이해|찬송|마무리기도)$/u;
  const question=/[?？]|(?:나눠\s*보세요|나누어\s*봅시다|생각해\s*보세요|적어\s*보세요|이야기해\s*보세요|무엇인가요|있나요|했나요|하셨나요|일까요|어떨까요)[.!。]?\s*(?:\([^()]*\))?\s*$/u;
  const compact=s=>s.replace(/[ \t]+/g,' ').trim();
  const sectionKey=s=>s.replace(mark,'').replace(/[\s:：.．]+/g,'').replace(/^[▷▶►▸>4ㅣl]+(?=[가-힣])/u,'');
  function sliced(raw,n){const s=raw.slice(0,n);return s.replace(/[\uD800-\uDBFF]$/,'');}
  function split(raw){
    return String(raw??'').normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'')
      .slice(0,60000).split('\n').map(compact);
  }
  function number(line,strict){
    const stripped=line.replace(mark,'');
    const m=markNumber.exec(stripped)||(!strict&&weakNumber.exec(stripped));
    if(!m)return null;
    const n=m[1]?Number(m[1].normalize('NFKC')):'①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'.indexOf(m[2])+1;
    return n>=1&&n<=30?{n,head:m[2]?m[2]:n+'.',body:stripped.slice(m[0].length).trim()}:null;
  }
  function extract(raw){
    const rows=split(raw);
    const hasSection=rows.some(line=>recognized.test(sectionKey(line)));
    const groups=[];let group='',active=null,paused=hasSection;
    const finish=()=>{
      if(active?.body&&/[가-힣A-Za-z]/u.test(active.body))groups.push(active);
      active=null;
    };
    for(const line of rows){
      if(!line)continue; // Wrapped questions can have blank OCR rows.
      const key=sectionKey(line);
      if(recognized.test(key)){
        finish();paused=false;
        group=key.startsWith('본문나눔')?'본문나눔':key.startsWith('결단')?'결단하기':/^(?:적용|실천|삶에적용|나의결단)/u.test(key)?'적용하기':'';
        continue;
      }
      if(general.test(key)){finish();paused=hasSection||key!=='본문이해';group='';continue;}
      if(paused)continue;
      const n=number(line,!hasSection);
      if(n){
        finish();active={...n,group,body:n.body};continue;
      }
      // Bullet headings are boundaries, not continuations. A wrapped second
      // sentence belongs to the same item even if the first ends in '?'.
      if(/^[▶▷►▸◆■]/u.test(line)){finish();paused=hasSection;continue;}
      if(active){active.body+=' '+line;continue;}
      if(question.test(line))groups.push({head:'',group,body:line});
    }
    finish();
    const found=groups.filter(q=>hasSection||question.test(q.body));
    return found.map(q=>sliced([q.group,q.head,q.body].filter(Boolean).join(' '),MAX_QUESTION)).slice(0,LIMIT);
  }
  function parseReview(raw){return split(raw).filter(Boolean).slice(0,LIMIT).map(q=>sliced(q,MAX_QUESTION));}
  function canonical(raw){
    return String(raw??'').normalize('NFKC')
      .replace(/^(?:본문\s*나눔|결단\s*하기|적용\s*하기)\s*/u,'')
      .replace(/^(?:(?:[Qq]|문항|질문)\s*)?\(?\d{1,2}[.、):]?\s*/u,'')
      .replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
  }
  function alike(a,b){
    if(!a||!b)return false;
    if(a===b)return true;
    const width=Math.max(a.length,b.length),limit=Math.floor(width*.12);
    if(Math.min(a.length,b.length)<28||Math.abs(a.length-b.length)>limit)return false;
    let prev=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      const row=[i];
      for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      prev=row;
    }
    return prev[b.length]<=limit;
  }
  function mergeQuestions(previous,questions,make){
    const keys=previous.map(q=>canonical(q.question)), used=new Set();
    const incoming=[];
    for(const question of questions){
      const key=canonical(question);
      // Match one saved item to one incoming item only. Never replace its question, answer or ID.
      const exact=keys.findIndex((k,i)=>!used.has(i)&&!!key&&k===key);
      const near=keys.flatMap((k,i)=>!used.has(i)&&alike(k,key)?[i]:[]);
      const i=exact>=0?exact:near.length===1?near[0]:-1;
      if(i>=0){used.add(i);incoming.push(previous[i]);}
      else incoming.push(make(question,incoming.length));
    }
    const first=used.size?Math.min(...used):previous.length;
    const rest=previous.filter((_,i)=>!used.has(i));
    rest.splice(first,0,...incoming);
    return {entries:rest,added:questions.length-used.size,first};
  }
  function cleanBody(raw){
    return String(raw??'').normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'')
      .split('\n').map(line=>line.trimEnd()).join('\n').trim();
  }
  function normalizeBody(raw){
    const seen=new Set();
    return Array.isArray(raw)?raw.slice(0,MAX_BODIES).flatMap(item=>{
      if(!item||typeof item.id!=='string'||!item.id.trim()||item.id.length>80||seen.has(item.id)||
        typeof item.text!=='string'||typeof item.reference!=='string')return [];
      seen.add(item.id);
      return [{id:item.id,text:sliced(item.text,MAX_BODY),reference:sliced(item.reference,100)}];
    }):[];
  }
  function bodyIndex(items,raw){
    const comparison=s=>cleanBody(s).replace(/\s+/g,'');
    const key=comparison(raw);
    return key?items.findIndex(item=>comparison(item.text)===key):-1;
  }
  const displayKinds=[
    ['opening','들어가기',/^(?:들어가기|시작하기|마음열기|마음나누기|환영과나눔|아이스브레이크|도입|여는질문|함께시작하기)$/u],
    ['scripture','본문이해',/^(?:본문이해|말씀이해|말씀묵상|본문묵상|오늘의말씀|성경본문|말씀읽기|본문읽기|성경읽기|설교요약|말씀요약|말씀해설)$/u],
    ['questions','본문나눔',/^(?:본문나눔(?:질문)?|말씀나눔|나눔질문|말씀질문|묵상질문|질문나눔|질문|생각나누기|함께나눌질문|토의질문)$/u],
    ['action','결단하기',/^(?:결단하기|결단질문|적용하기|적용질문|적용과결단|삶에적용하기|삶에적용|실천하기|나의결단|실천과결단|이번주실천)$/u],
    ['prayer','기도·찬양',/^(?:기도|합심기도|함께기도|함께기도하기|기도제목|기도나눔|마무리기도|기도인도|찬양|찬송)$/u],
    ['notice','교회 소식',/^(?:교회소식|교회광고|광고|안내|예배안내|예배순서|모임안내|헌금안내|새가족안내|새가족소개|교우동정|교회일정|주간일정)$/u],
  ];
  function heading(line){
    const clip=line.trim().replace(/^[\s\[\]【〔(（<]+/u,'').replace(mark,'').replace(/^[\s\[\]【〔(（<]+/u,'');
    const label=clip.replace(/[\s:：.．>\]】〕)）]+$/u,'');
    const key=sectionKey(label);
    const known=displayKinds.find(([, ,pattern])=>pattern.test(key));
    if(known)return {kind:known[0],title:label};
    // Preserve unfamiliar, clearly marked headings. Verse numbers and
    // numbered questions must not be confused with headings.
    if(!markNumber.test(line)&&/^\s*(?:[▶▷►▸◆◇■□]|#{1,4}\s|[【〔\[]|\*\s)/u.test(line)&&
      label.length>=2&&label.length<=28&&/[가-힣A-Za-z]/u.test(label)&&!/[?？,，.!]/u.test(label)&&!/\d/.test(label))
      return {kind:'other',title:label};
    return null;
  }
  function sections(raw){
    const source=cleanBody(raw);
    if(!source)return [];
    const rows=source.split('\n'),hasHeadings=rows.some(line=>heading(line));
    const result=[];let current={kind:'overview',title:hasHeadings?'주보 기본 정보':'주보 내용',lines:[]};
    const finish=()=>{
      const body=current.lines.join('\n').trim();
      if(body||current.headingLine)result.push({kind:current.kind,title:current.title,text:body,headingLine:current.headingLine||''});
    };
    for(const line of rows){
      const h=heading(line);
      if(h){
        finish();current={...h,headingLine:line.trim(),lines:[]};continue;
      }
      if(!hasHeadings&&!line.trim()&&current.lines.some(x=>x.trim())){
        finish();current={kind:'other',title:'',lines:[]};continue;
      }
      current.lines.push(line);
    }
    finish();return result;
  }
  function sectionHasAnswerCards(item,saved){
    if(!item||!['questions','action'].includes(item.kind)||!item.text||!item.headingLine)return false;
    const source=extract(item.headingLine+'\n'+item.text).map(canonical);
    const cards=Array.isArray(saved)?saved.map(card=>canonical(card.question)):[];
    if(!source.length||source.length>cards.length)return false;
    const used=new Set();
    for(const q of source){
      const exact=cards.findIndex((key,i)=>!!q&&!used.has(i)&&key===q);
      const near=exact<0?cards.flatMap((key,i)=>!used.has(i)&&alike(q,key)?[i]:[]):[];
      const index=exact>=0?exact:near.length===1?near[0]:-1;
      if(index<0)return false;
      used.add(index);
    }
    return true;
  }
  function questionKind(line){
    const m=String(line??'').trim().match(/^([가-힣 ]{2,20})\s+\d{1,2}[.)]/u);
    return (m&&heading(m[1])?.kind)||'questions';
  }
  function normalize(raw){
    if(!Array.isArray(raw))return [];
    const used=new Set();
    return raw.slice(0,LIMIT).flatMap(q=>{
      if(!q||typeof q.id!=='string'||!q.id||q.id.length>80||used.has(q.id)||
        typeof q.question!=='string'||typeof q.answer!=='string'||typeof q.reference!=='string')return [];
      used.add(q.id);
      return [{id:q.id,question:sliced(q.question,MAX_QUESTION),answer:sliced(q.answer,MAX_ANSWER),reference:sliced(q.reference,100)}];
    });
  }
  return {LIMIT,MAX_QUESTION,MAX_ANSWER,extract,parseReview,normalize,mergeQuestions,MAX_BODIES,MAX_BODY,cleanBody,normalizeBody,bodyIndex,sections,questionKind,sectionHasAnswerCards};
});
