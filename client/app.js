/* Open Bible: account-scoped notes, normalized ink and scripture character anchors. */
(function () {
'use strict';
const $=id=>document.getElementById(id), clone=x=>JSON.parse(JSON.stringify(x));
const quoteKey=q=>window.YeoQuotes.key(q);
const regions=()=>['scripture',...state.blocks,...state.quotes.map(quoteKey)], notes=()=>state.blocks;
const noteSource=k=>quoteTexts[k]??state.text[k]??'';
const canvases={scripture:$('scriptureInk')}, noteInputs={}, notePlanes={}, noteReaders={}, quoteTexts={}, quotePads={};
let inkObserver;
const scroll=$('readerScroll'),scriptureReference=$('scriptureReference'),writingPaper=$('writingPaper'),scriptureClip=$('scriptureClip'),scripturePlane=$('scripturePlane'),wideSpread=matchMedia('(min-width:560px)'),sheet=$('readerSheet'),select=$('bookSelect'),chapterSelect=$('chapterSelect');
const noteScroll=()=>wideSpread.matches?writingPaper:scroll;
if(!window.YeoBible||!Array.isArray(window.YEO_KRV)||window.YEO_KRV.length!==66){
  $('status').textContent='성경 본문을 불러오지 못했어요. 새로고침해 주세요.';
  $('activeRef').textContent='본문을 불러오지 못했어요';
  [select,chapterSelect,$('addQuote'),$('openPassageRange')].forEach(el=>el.disabled=true);
  return;
}
const bible=window.YeoBible.create(window.YEO_KRV,window.YEO_PASSAGES||[]);
const LAST_CHAPTER_KEY='yeobaek-paper-last-krv';
function savedChapter(){try{return bible.byId(localStorage.getItem(LAST_CHAPTER_KEY));}catch{return null;}}
function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
function populateBooks(el){
  const groups=new Map();
  for(const book of bible.books){
    if(!groups.has(book.testament)){const group=document.createElement('optgroup');group.label=book.testament;groups.set(book.testament,group);el.append(group);}
    groups.get(book.testament).append(option(book.code,book.name));
  }
}
function populateChapters(el,code,n=1){
  el.replaceChildren(...(bible.book(code)?.chapters??[]).map(p=>option(p.chapter,p.chapter+'장')));
  el.value=String(n);
}
let verseRange=null;
const Bible=window.YeoBible;
function navigateChapter(p,selection){
  if(!p)return;
  const explicit=selection!==undefined;
  const nextRange=explicit?(selection&&!selection.full?selection:null):Bible.readView(localStorage,sync.account(),p);
  if(explicit)Bible.writeView(localStorage,sync.account(),p,nextRange);
  if(p.id===passage.id){
    if(!verseRange&&!nextRange&&!explicit)return;
    cancel();verseRange=nextRange;renderVerseRange();scriptureReference.scrollTop=0;paint();
  }else{
    verseRange=nextRange;load(p);
  }
  try{
    localStorage.setItem(LAST_CHAPTER_KEY,p.id);
  }catch{}
  if(syncReady&&!window.YeoRecords.rememberOpening(localStorage,sync.account(),p.id,bible))
    status('이 브라우저에 열어본 말씀을 저장하지 못했어요.');
}
const KEY='yeobaek-paper-v3:', PREVIOUS_KEY='yeobaek-paper-v2:', OLD_KEY='yeobaek-cornell-v1:', STYLE_KEY='yeobaek-paper-style';
const Bulletin=window.YeoBulletinQuestions, Quotes=window.YeoQuotes, Timeline=window.YeoTimeline, Order=window.YeoReorder, TextMarks=window.YeoTextMarks, Records=window.YeoRecords;
const recordTitleInput=$('recordTitle');
const Paper=window.YeoPaper, {BASE_NOTE_HEIGHT, EXTRA_NOTE_HEIGHT}=Paper;
let trashSnapshot=null, trashToastTimer=0, stateUpdatedAt=null, topicBefore=null, recordTitleBefore=null;
const MARKERS={yellow:{fill:'#f4df8d',ink:'#e5bd42'},pink:{fill:'#f5b5cf',ink:'#db5487'},green:{fill:'#c9e79e',ink:'#83b642'}};
const markerPreference='yeobaek-highlighter-color';
let marker='yellow';
try{const saved=localStorage.getItem(markerPreference);if(Object.hasOwn(MARKERS,saved))marker=saved;}catch{}
const markColor=()=>MARKERS[marker].fill;
function syncMarkerButtons(){for(const b of document.querySelectorAll('[data-marker]'))b.setAttribute('aria-pressed',String(b.dataset.marker===marker));}
function selectMarker(key){if(!Object.hasOwn(MARKERS,key))return;marker=key;syncMarkerButtons();try{localStorage.setItem(markerPreference,key);}catch{}}

let passage=savedChapter()||bible.byId('PSA23')||bible.books[0]?.chapters[0],state,tool='pen',color='#25352e',gesture=null,draft=null,undo=[],redo=[],typingBefore=null,typingKey=null,chars=[],geometry=[],saveOK=true;
const empty=()=>({version:2,notesHeight:BASE_NOTE_HEIGHT,ink:{scripture:[],note:[]},text:{note:''},titles:{note:''},noteMarks:{note:[]},quoteHeights:{},quoteMemos:{},highlights:[],quotes:[],blocks:['note'],heights:{},timeline:[],legacyText:{},manualOrder:[],inlineOrder:null,sizedBlocks:{},deletedBlocks:{},bulletinQuestions:[],bulletinBody:[]});
function status(message){if($('status'))$('status').textContent=message;}
function buttons(){if(trashSnapshot&&undo.at(-1)!==trashSnapshot)hideTrashToast();if($('undo'))$('undo').disabled=!undo.length;if($('redo'))$('redo').disabled=!redo.length;}
let syncReady=false, applyingRemote=false, editedCurrent=false;const activeSyncPointers=new Set();
let bulletinBefore=null,currentTrashed=false,manualFeedbackTimer=0,composing=false;
let bulletinReceipt=0,afterInteractionTimer=0,recordsNeedRefresh=false;
function canApplyChapter(id){
  return id!==passage?.id||(!activeSyncPointers.size&&!composing&&!typingBefore&&!topicBefore&&!recordTitleBefore&&!bulletinBefore&&!draft&&
    !document.activeElement?.matches('textarea:not([readonly]),.note-topic,#recordTitle')&&
    !$('bulletinPicker')?.open&&!document.querySelector('.bulletin-body-editor:not([hidden])'));
}
function afterInteraction(){
  clearTimeout(afterInteractionTimer);
  afterInteractionTimer=setTimeout(()=>{
    if(document.hidden)return;
    refreshOpenRecords();
    if(syncReady&&sync.hasDeferred()&&canApplyChapter(passage?.id))void sync.refresh();
  },120);
}
document.addEventListener('compositionstart',()=>{composing=true;});
document.addEventListener('compositionend',()=>{composing=false;afterInteraction();});
document.addEventListener('focusout',afterInteraction);
document.addEventListener('close',afterInteraction,true);
window.addEventListener('pointerdown',e=>activeSyncPointers.add(e.pointerId),true);
const releaseSyncPointer=e=>{activeSyncPointers.delete(e.pointerId);if(!activeSyncPointers.size)afterInteraction();};
window.addEventListener('pointerup',releaseSyncPointer,true);window.addEventListener('pointercancel',releaseSyncPointer,true);
window.addEventListener('blur',()=>{activeSyncPointers.clear();afterInteraction();});
const sync=window.YeoSync.create({storage:localStorage,request:window.fetch.bind(window),onStatus:message=>{status(message);if($('syncSummary'))$('syncSummary').textContent=message;},canApply:canApplyChapter,onChange:id=>{
  if(!syncReady)return;
  if(id===passage?.id){applyingRemote=true;try{load(passage,true);}finally{applyingRemote=false;}}
  if($('recordsPicker')?.open){recordsNeedRefresh=true;afterInteraction();}
},onLock:()=>{syncReady=false;bulletinReceipt++;recordsNeedRefresh=false;activeSyncPointers.clear();setSyncLocked(true);for(const id of ['recordsPicker','syncPicker','quotePicker','bulletinPicker'])$(id)?.close();for(const id of ['recordsList','syncConflicts'])$(id)?.replaceChildren();if($('importResult'))$('importResult').textContent='';typingBefore=null;topicBefore=null;recordTitleBefore=null;bulletinBefore=null;verseRange=null;renderVerseRange();cancel();currentTrashed=false;state=empty();undo=[];redo=[];restoreUI();buttons();syncTrashView();}});
function setSyncLocked(locked){if(locked)$('passageRangePicker')?.close();for(const el of [scroll,$('readerTools'),document.querySelector('.dock-wrap'),select,chapterSelect,$('openRecords'),$('openPassageRange'),$('fullChapter'),recordTitleInput])if(el){if('disabled' in el)el.disabled=locked;else el.inert=locked;}document.body.dataset.syncLocked=String(locked);if($('reconnectSync'))$('reconnectSync').hidden=!locked;syncTrashView();}
function syncTrashView(){
  $('trashedChapter').hidden=!currentTrashed;
  const locked=document.body.dataset.syncLocked==='true';
  for(const el of [$('readerTools'),document.querySelector('.dock-wrap'),$('noteFlow')])if(el)el.inert=locked||currentTrashed;
  recordTitleInput.disabled=locked||currentTrashed;
  $('openBulletin').disabled=locked||currentTrashed;
}
function persist(touch=false){if(!passage||!syncReady||applyingRemote||currentTrashed)return;if(touch===true){editedCurrent=true;stateUpdatedAt=Date.now();}if(!editedCurrent)return;syncDragBlocks();try{saveOK=sync.write(passage.id,stateUpdatedAt===null?state:{...state,updatedAt:stateUpdatedAt})!==false;status(sync.status());}catch(e){saveOK=false;status('저장 공간이 부족하거나 저장이 차단됨 · 창을 닫지 마세요');}buttons();}
function record(before,touch=true){if(JSON.stringify(before)===JSON.stringify(state))return;undo.push(before);if(undo.length>40)undo.shift();redo=[];persist(touch);}
function finishTopic(){if(!topicBefore)return;const before=topicBefore;topicBefore=null;record(before);}
function finishTyping(){
  finishRecordTitle();
  finishBulletinEdit();
  finishTopic();
  if(!typingBefore)return;
  const before=typingBefore,k=typingKey;typingBefore=null;typingKey=null;
  if(k?.startsWith('quote:')){record(before);return;}
  const text=k&&Timeline.typedDelta(before.text[k]||'',state.text[k]||'');
  if(text)state.timeline.push({kind:'type',block:k,text,at:Date.now(),uid:globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random()});
  record(before);
}
function captureRecordTitle(){
  if(!syncReady||applyingRemote||!state)return;
  const title=Records.title(recordTitleInput.value);
  if(title===(state.recordTitle??''))return;
  recordTitleBefore??=clone(state);
  if(title)state.recordTitle=title;else delete state.recordTitle;
  renderRecordTitle();
  persist(true);
}
function finishRecordTitle(){
  if(!recordTitleBefore)return;
  const before=recordTitleBefore;recordTitleBefore=null;
  record(before,false);
}
recordTitleInput.addEventListener('input',e=>{if(!e.isComposing)captureRecordTitle();});
recordTitleInput.addEventListener('compositionend',captureRecordTitle);
recordTitleInput.addEventListener('blur',()=>{
  const changed=!!recordTitleBefore;
  finishRecordTitle();if(state)recordTitleInput.value=state.recordTitle??'';
  const account=sync.account(),chapter=passage?.id,title=state?.recordTitle??'';
  if(!changed||!syncReady||!account||!chapter)return;
  void sync.flush().then(()=>{
    if(sync.account()!==account||passage?.id!==chapter||(state?.recordTitle??'')!==title||document.activeElement===recordTitleInput)return;
    const result=sync.chapterSyncState(chapter);
    if(result==='confirmed')saveFeedback('기록 제목을 서버에 저장했어요.');
    else if(result==='conflict')saveFeedback('다른 기기와 수정이 겹쳐 제목을 아직 서버에 저장하지 못했어요. 양쪽 기록은 그대로예요.',true);
    else if(result==='pending')saveFeedback('기록 제목을 이 기기에 저장했어요. 서버 저장은 아직 확인되지 않았어요.',true);
  });
});
recordTitleInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!composing&&!e.isComposing&&e.keyCode!==229){
    e.preventDefault();captureRecordTitle();recordTitleInput.blur();
  }
});
function saveFeedback(message,warning=false,keep=false){
  const el=$('manualSaveFeedback');clearTimeout(manualFeedbackTimer);el.dataset.warning=String(warning);el.textContent=message;
  if(!keep)manualFeedbackTimer=setTimeout(()=>{el.textContent='';},warning?11000:6500);
}
const lastBlock=()=>state.blocks[state.blocks.length-1];
function noteHeight(k){return k==='note'?state.notesHeight:state.heights[k];}
function setHeight(k,h){
  const old=noteHeight(k);
  if(old!==h){state.ink[k].forEach(s=>s.points.forEach(p=>{p.y=p.y*old/h;}));}
  if(k==='note')state.notesHeight=h;else state.heights[k]=h;
  notePlanes[k]?.style.setProperty('--notes-height',h+'px');
  notePlanes[k]?.parentElement?.querySelector('.resize-note')?.setAttribute('aria-valuenow',String(h));
}
function resizeNote(direction){
  if(!state)return;showNotePage();cancel();finishTyping();
  const before=clone(state),k=lastBlock(),old=noteHeight(k);
  const next=Paper.resize(old,neededHeight(k),direction);
  if(next===old){status('작성한 내용은 남겨야 해서 더 줄일 수 없어요');return;}
  setHeight(k,next);state.sizedBlocks[k]=true;geometry=[];record(before);paint();
}
const moreLines=()=>resizeNote(1);
function appendBlock(){
  const k='note-'+state.blocks.length;
  state.blocks.push(k);state.heights[k]=BASE_NOTE_HEIGHT;state.text[k]='';state.titles[k]='';state.ink[k]=[];state.noteMarks[k]=[];
}
function separateInput(next){
  if(!state)return;
  const k=lastBlock(), hasInk=state.ink[k].length>0, hasText=!!state.text[k].trim();
  if((next==='type'&&hasInk)||(next==='ink'&&hasText)){
    // Keep the written surface where it is when preparing a fresh handwriting block below.
    if(next==='type')compactBlock(k);
    appendBlock();renderFlow();paint();
  }
}
function inkBottom(k){return state.ink[k].reduce((max,s)=>s.points.reduce((a,p)=>Math.max(a,p.y*noteHeight(k)+s.width/2),max),0);}
function textHeight(k){
  const value=state.text[k];if(!value)return 0;
  const el=noteInputs[k];
  if(!el?.clientWidth)return value.split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/15))*32,0);
  const previous=el.style.height;el.style.height='0px';
  const measured=el.scrollHeight;el.style.height=previous;
  return measured;
}
function compactBlock(k){if(!state.sizedBlocks[k])setHeight(k,neededHeight(k));}
function neededHeight(k){return Math.max(32,Math.ceil(Math.max(inkBottom(k)+16,textHeight(k)+12)/32)*32);}
const paperButtons=[...document.querySelectorAll('button[data-paper]')];
let paperStyle='ruled';
function syncPaperControls(){
  const displayStyle=Paper.mode(paperStyle,tool);
  $('noteFlow').dataset.paperStyle=displayStyle;
  paperButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.paper===displayStyle)));
}
function setPaperStyle(value,save=false){
  paperStyle=Paper.style(value);syncPaperControls();
  if(save){try{localStorage.setItem(STYLE_KEY,paperStyle);}catch{status('이 브라우저에 종이 종류를 저장하지 못했습니다.');}}
}
function showNotePage(){
  const page=document.querySelector('button[data-page="note"]');
  if(page&&page.getClientRects().length&&document.body.dataset.mobile!=='note')page.click();
}
function openKeyboard(){
  showNotePage();
  setTool('type');
  focusLast();
}
try{setPaperStyle(localStorage.getItem(STYLE_KEY));}catch{setPaperStyle('ruled');}
paperButtons.forEach(b=>b.addEventListener('click',()=>{
  if(b.dataset.paper==='type'){openKeyboard();return;}
  showNotePage();setPaperStyle(b.dataset.paper,true);
  if(tool==='type'||tool==='read')setTool('pen');
}));
function syncInputs(){
  notes().forEach(k=>{
    const el=noteInputs[k];if(!el)return;
    const editing=tool==='type'&&(!state.ink[k].length||!!state.text[k]);
    const box=notePlanes[k]?.parentElement;
    const title=box?.querySelector('.note-topic');if(title)title.hidden=tool!=='type'&&!state.text[k]&&!state.titles[k];
    const resize=box?.querySelector('.resize-note');
    if(resize)resize.hidden=!editing&&!state.text[k].trim();
    el.hidden=!editing&&!state.text[k];el.readOnly=!editing;el.style.pointerEvents=editing?'auto':'none';
  });
}
function focusVisibleNote(el){
  if(!el||el.hidden)return;
  const b=el.getBoundingClientRect(),frame=noteScroll().getBoundingClientRect();
  // Don't summon the keyboard for a newly appended block outside the visible paper.
  if(b.width&&b.height&&b.top>=frame.top-1&&b.top+16<=frame.bottom&&b.right>frame.left&&b.left<frame.right)
    el.focus({preventScroll:true});
}
function focusLast(){focusVisibleNote(noteInputs[lastBlock()]);}
function fitVerseRange(){
  if(!verseRange)return;
  const rows=$('scriptureText').children;
  const first=[...rows].find(r=>Number(r.dataset.verse)===verseRange.start);
  const last=[...rows].find(r=>Number(r.dataset.verse)===verseRange.end);
  if(!first||!last||!scripturePlane.offsetWidth)return;
  // Keep the entire chapter at its original width/height. Crop the viewport,
  // not the canvas: existing normalized handwriting coordinates stay valid.
  const start=first.offsetTop,end=last.offsetTop+last.offsetHeight+2;
  const height=Math.max(end-start,1)+'px',shift='translateY('+(-start)+'px)';
  if(scriptureClip.style.height!==height)scriptureClip.style.height=height;
  if(scripturePlane.style.transform!==shift)scripturePlane.style.transform=shift;
  geometry=[];
}
function renderVerseRange(){
  const limited=verseRange?.chapterId===passage.id;
  $('activeRef').textContent=limited?verseRange.label:passage.label;
  $('fullChapter').hidden=!limited;
  const rangeButton=$('openPassageRange');
  rangeButton.textContent=limited?(verseRange.start===verseRange.end?verseRange.start+'절':verseRange.start+'–'+verseRange.end+'절'):'절 범위';
  rangeButton.setAttribute('aria-label',limited?'절 범위 변경: '+verseRange.label:'절 범위');
  scriptureClip.dataset.limited=String(limited);
  for(const row of $('scriptureText').children){
    const n=Number(row.dataset.verse),outside=limited&&(n<verseRange.start||n>verseRange.end);
    if(outside){row.dataset.outsideRange='true';row.setAttribute('aria-hidden','true');}
    else{delete row.dataset.outsideRange;row.removeAttribute('aria-hidden');}
  }
  if(limited)fitVerseRange();
  else{scriptureClip.style.height='';scripturePlane.style.transform='';}
  geometry=[];
}
function renderRecordTitle(){
  const caption=$('activeRecordTitle'),title=state.recordTitle??'';
  caption.querySelector('strong').textContent=title;caption.hidden=!title;
}
function restoreUI(){recordTitleInput.value=state.recordTitle??'';renderRecordTitle();renderFlow();renderBulletin();paint();}
function history(direction){cancel();finishTyping();const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo;if(!from.length)return;to.push(clone(state));state=from.pop();restoreUI();persist(true);}
function load(p,keepScroll=false){cancel();if(!applyingRemote)finishTyping();editedCurrent=false;passage=p;state=empty();stateUpdatedAt=null;undo=[];redo=[];
const previousScroll=keepScroll?[scroll.scrollTop,scriptureReference.scrollTop,writingPaper.scrollTop]:[0,0,0];
let readError=false;currentTrashed=false;
try{
  const s=sync.read(p.id);
  currentTrashed=Records.trashed(s);
  if(s&&s.version===2&&!currentTrashed){
    state.bulletinQuestions=Bulletin.normalize(s.bulletinQuestions);
    state.bulletinBody=Bulletin.normalizeBody(s.bulletinBody);
    const title=Records.title(s.recordTitle);if(title)state.recordTitle=title;
    if(Number.isFinite(s.updatedAt)&&s.updatedAt>0)stateUpdatedAt=s.updatedAt;
    const validHeight=h=>Number.isFinite(h)&&h>=32;
    state.notesHeight=validHeight(s.notesHeight)?s.notesHeight:BASE_NOTE_HEIGHT;
    if(Array.isArray(s.blocks))for(let i=1;i<s.blocks.length&&s.blocks[i]==='note-'+i;i++){
      appendBlock();
      const k=s.blocks[i];if(validHeight(s.heights?.[k]))state.heights[k]=s.heights[k];
    }
    state.quotes=Quotes.normalize(s.quotes,bible);
    regions().forEach(k=>{state.ink[k]=(Array.isArray(s.ink?.[k])?s.ink[k]:[]).filter(a=>a&&['pen','highlight'].includes(a.mode)&&Array.isArray(a.points)&&a.points.every(v=>v&&Number.isFinite(v.x)&&Number.isFinite(v.y))).map(a=>({...a,width:Math.max(1,Math.min(20,Number(a.width)||3)),color:typeof a.color==='string'?a.color:'#39382f'}));});
    notes().forEach(k=>{state.text[k]=typeof s.text?.[k]==='string'?s.text[k]:'';state.noteMarks[k]=TextMarks.clean(s.noteMarks?.[k],state.text[k]);state.titles[k]=typeof s.titles?.[k]==='string'?s.titles[k].slice(0,100):'';});
    for(const q of state.quotes){
      const k=quoteKey(q),v=Quotes.verse(bible,q.id,q.number);
      state.noteMarks[k]=TextMarks.clean(s.noteMarks?.[k],v.text);
      if(Number.isFinite(s.quoteHeights?.[k]))state.quoteHeights[k]=Math.max(40,Math.min(8192,s.quoteHeights[k]));
      if(typeof s.quoteMemos?.[k]==='string'&&s.quoteMemos[k])state.quoteMemos[k]=s.quoteMemos[k];
    }
    state.timeline=Timeline.read(s.timeline,state.blocks);
    state.manualOrder=Array.isArray(s.manualOrder)?s.manualOrder.filter(k=>typeof k==='string'):[];
    state.inlineOrder=Array.isArray(s.inlineOrder)?s.inlineOrder.filter(k=>typeof k==='string'):null;
    state.sizedBlocks=Object.fromEntries(state.blocks.filter(k=>s.sizedBlocks?.[k]===true).map(k=>[k,true]));
    state.deletedBlocks=Object.fromEntries(state.blocks.filter(k=>s.deletedBlocks?.[k]===true).map(k=>[k,true]));
    if(state.deletedBlocks[lastBlock()])appendBlock();
    state.legacyText=Object.fromEntries(state.blocks.map(k=>[k,Array.isArray(s.timeline)?(typeof s.legacyText?.[k]==='string'?s.legacyText[k]:''):state.text[k]]));
    state.highlights=(Array.isArray(s.highlights)?s.highlights:[]).filter(h=>h&&Number.isInteger(h.start)&&Number.isInteger(h.end)&&typeof h.quote==='string');
    state.quotes.forEach(item=>{if(item.after!=='before'&&!state.blocks.includes(item.after))item.after='before';});
  }
}catch(e){readError=true;}

chars=[];const target=$('scriptureText');target.replaceChildren();
p.verses.forEach(([num,text])=>{const row=document.createElement('p');row.className='verse';row.dataset.verse=num;const sup=document.createElement('sup');sup.textContent=num;const words=document.createElement('span');words.className='verseWords';words.dataset.verse=num;for(let i=0;i<text.length;i++){const ch=document.createElement('span');ch.textContent=text[i];words.append(ch);chars.push({el:ch,verse:num,offset:i,text:text[i],index:chars.length});}row.append(sup,document.createTextNode(' '),words);target.append(row);});
renderVerseRange();select.value=p.code;if(chapterSelect.dataset.book!==p.code){populateChapters(chapterSelect,p.code,p.chapter);chapterSelect.dataset.book=p.code;}else chapterSelect.value=String(p.chapter);restoreUI();syncTrashView();scroll.scrollTop=previousScroll[0];scriptureReference.scrollTop=previousScroll[1];writingPaper.scrollTop=previousScroll[2];buttons();status(readError?'저장된 기록을 읽지 못했습니다.':sync.status());requestAnimationFrame(paint);
}
function validHighlight(h){const a=chars.filter(c=>c.verse===h.verse);return h.start>=0&&h.end>h.start&&h.end<=a.length&&a.slice(h.start,h.end).map(c=>c.text).join('')===h.quote;}
function paintText(){chars.forEach(c=>c.el.style.backgroundColor='');state.highlights.filter(validHighlight).forEach(h=>chars.filter(c=>c.verse===h.verse&&c.offset>=h.start&&c.offset<h.end).forEach(c=>c.el.style.backgroundColor=h.color||'#f4df8d'));if(draft?.kind==='text'){const a=Math.min(draft.start,draft.end),b=Math.max(draft.start,draft.end);chars.slice(a,b+1).forEach(c=>c.el.style.backgroundColor=draft.color||'#f4df8d');}}
function markRange(d,text){
  const start=Math.min(d.start.start,d.end.start),end=Math.max(d.start.end,d.end.end);
  return {start,end,quote:text.slice(start,end),color:d.color};
}
function paintNote(k){
  const mirror=noteReaders[k];if(!mirror)return;
  const text=noteSource(k), marks=state.noteMarks[k];
  const preview=draft?.kind==='note-text'&&draft.region===k?markRange(draft,text):null;
  const key=JSON.stringify([text,marks,preview]);
  if(mirror._drawKey===key)return;
  mirror._drawKey=key;
  const frag=document.createDocumentFragment();
  for(const chunk of TextMarks.segments(text,preview?[...marks,preview]:marks)){
    const node=document.createElement(chunk.marked?'mark':'span');
    node.dataset.start=chunk.start;node.dataset.end=chunk.end;node.textContent=chunk.text;if(chunk.marked&&/^#[0-9a-f]{6}$/i.test(chunk.color??''))node.style.backgroundColor=chunk.color;frag.append(node);
  }
  if(text.endsWith('\n'))frag.append(document.createTextNode('\u200b'));
  mirror.replaceChildren(frag);
}
function noteHit(e,k,radius=8){
  const mirror=noteReaders[k];if(!mirror)return null;
  let node,off;
  const pos=document.caretPositionFromPoint?.(e.clientX,e.clientY);
  if(pos){node=pos.offsetNode;off=pos.offset;}
  if(!node||!mirror.contains(node)){
    const r=document.caretRangeFromPoint?.(e.clientX,e.clientY);node=r?.startContainer;off=r?.startOffset;
  }
  if(node?.nodeType!==3||!mirror.contains(node)||!node.parentElement?.matches('[data-start]'))return null;
  const base=Number(node.parentElement.dataset.start),value=node.data,r=document.createRange();
  let best=null,nearest=Infinity;
  for(let i=Math.max(0,off-3);i<Math.min(value.length,off+3);i++){
    if(/[\uDC00-\uDFFF]/.test(value[i])&&i>0&&/[\uD800-\uDBFF]/.test(value[i-1]))continue;
    const end=i+(value.codePointAt(i)>0xFFFF?2:1);
    r.setStart(node,i);r.setEnd(node,end);
    for(const rect of r.getClientRects()){
      if(!rect.width||!rect.height)continue;
      const dx=Math.max(rect.left-e.clientX,0,e.clientX-rect.right),dy=Math.max(rect.top-e.clientY,0,e.clientY-rect.bottom),d=Math.hypot(dx,dy);
      if(d<nearest){nearest=d;best={start:base+i,end:base+end};}
    }
  }
  return nearest<=radius?best:null;
}
function eraseNoteMarks(k,a,b){
  const mirror=noteReaders[k];if(!mirror||!state.noteMarks[k]?.length)return;
  const struck=[];
  for(const node of mirror.querySelectorAll('mark')){
    for(const r of node.getClientRects()){
      const l=r.left-3,t=r.top-3,x=r.right+3,y=r.bottom+3;
      const inside=p=>p.x>=l&&p.x<=x&&p.y>=t&&p.y<=y;
      const corners=[{x:l,y:t},{x,y:t},{x,y},{x:l,y}];
      if(inside(a)||inside(b)||corners.some((p,i)=>segments(a,b,p,corners[(i+1)%4])<1)){
        // Determine which saved range was actually touched, including overlapping marks.
        for(const mark of state.noteMarks[k]){
          const start=Math.max(Number(node.dataset.start),mark.start),end=Math.min(Number(node.dataset.end),mark.end);
          if(start>=end)continue;
          const range=document.createRange(),base=Number(node.dataset.start);
          range.setStart(node.firstChild,start-base);range.setEnd(node.firstChild,end-base);
          const touches=[...range.getClientRects()].some(rect=>{
            const left=rect.left-3,right=rect.right+3,top=rect.top-3,bottom=rect.bottom+3;
            const inBox=p=>p.x>=left&&p.x<=right&&p.y>=top&&p.y<=bottom;
            const s=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
            return inBox(a)||inBox(b)||s.some((p,i)=>segments(a,b,p,s[(i+1)%4])<1);
          });
          if(touches)struck.push(mark);
        }
        break;
      }
    }
  }
  if(struck.length)state.noteMarks[k]=state.noteMarks[k].filter(mark=>!struck.includes(mark));
}
function paintStroke(ctx,s,w,h){if(!s.points.length)return;ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=s.mode==='highlight'?.28:1;ctx.lineWidth=s.width;ctx.beginPath();s.points.forEach((p,i)=>{if(i)ctx.lineTo(p.x*w,p.y*h);else ctx.moveTo(p.x*w,p.y*h);});if(s.points.length===1){const p=s.points[0];ctx.arc(p.x*w,p.y*h,s.width/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();ctx.globalAlpha=1;}
function quoteBase(k){const p=noteReaders[k];return Math.max(40,(p?.offsetTop||0)+(p?.offsetHeight||0));}
function quoteHeight(k){return Math.max(quoteBase(k),state.quoteHeights[k]??40);}
function fitQuoteMemo(memo){
  const w=memo.clientWidth;if(!w||(memo._fitWidth===w&&memo._fitValue===memo.value))return;
  memo._fitWidth=w;memo._fitValue=memo.value;
  if(document.activeElement===memo){
    // Measuring by briefly collapsing a focused input can move the viewport to its caret.
    if(memo.scrollHeight>memo.clientHeight)memo.style.height=(memo.scrollHeight+memo.offsetHeight-memo.clientHeight)+'px';
    return;
  }
  memo.style.height='0px';
  memo.style.height=(memo.scrollHeight+memo.offsetHeight-memo.clientHeight)+'px';
}
function layoutQuote(k){
  const pieces=quotePads[k];if(!pieces)return;
  fitQuoteMemo(pieces.memo);
  // Keep existing markup and connected handwriting beside the verse. Only
  // unused free space moves below the memo; ink drawn there stays there.
  const logical=quoteHeight(k),base=quoteBase(k);
  const used=strokeBottom(state.ink[k].filter(s=>s.zone!=='pad'),logical);
  const upper=Math.min(logical,Math.max(base,Math.ceil(used)));
  const plane=canvases[k].parentElement,upperCss=upper+'px';
  if(plane.style.minHeight!==upperCss)plane.style.minHeight=upperCss;
  const css=Math.max(0,logical-(plane.offsetHeight||upper))+'px';
  if(pieces.pad.style.height!==css)pieces.pad.style.height=css;
}
function inkParts(k){
  const canvas=canvases[k];if(!canvas)return [];
  const pad=quotePads[k]?.canvas;
  return pad?[{canvas,offset:0},{canvas:pad,offset:canvas.parentElement.offsetHeight||40}]:[{canvas,offset:0}];
}
function paintInkPart(k,part,logicalHeight){
  const c=part.canvas,b=c.getBoundingClientRect(),w=c.clientWidth,h=c.clientHeight;
  if(!w||!h)return;
  const zoom=b.width/w||1,d=Math.min((window.devicePixelRatio||1)*zoom,3,8192/Math.max(w,h),Math.sqrt(8000000/(w*h)));
  if(c.width!==Math.round(w*d))c.width=Math.round(w*d);if(c.height!==Math.round(h*d))c.height=Math.round(h*d);
  const ctx=c.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);ctx.translate(0,-part.offset);
  const height=logicalHeight??h;
  state.ink[k].forEach(s=>paintStroke(ctx,s,w,height));
  if(draft?.kind==='ink'&&draft.region===k)paintStroke(ctx,draft.stroke,w,height);
}
function paint(){
  if(!state)return;paintText();
  for(const k of regions()){
    if(k!=='scripture')paintNote(k);if(!canvases[k])continue;
    layoutQuote(k);
    const logical=quotePads[k]?quoteHeight(k):undefined;
    for(const part of inkParts(k))paintInkPart(k,part,logical);
  }
}
function insidePart(e,b){return b.width>0&&b.height>0&&e.clientX>=b.left&&e.clientX<=b.right&&e.clientY>=b.top&&e.clientY<=b.bottom;}
function region(e){
  if(currentTrashed)return null;
  for(const k of regions()){
    if(k==='scripture'&&((wideSpread.matches&&!insidePart(e,scriptureReference.getBoundingClientRect()))||
      (verseRange&&!insidePart(e,scriptureClip.getBoundingClientRect()))))continue;
    for(const part of inkParts(k))if(insidePart(e,part.canvas.getBoundingClientRect()))return k;
  }
  return null;
}
function point(e,k){
  const parts=inkParts(k),clamp=f=>Math.max(0,Math.min(1,f));
  if(quotePads[k]){
    const candidates=parts.flatMap(part=>{const b=part.canvas.getBoundingClientRect();return b.width&&b.height?[{...part,b}]:[];});
    const dy=b=>Math.max(0,b.top-e.clientY,e.clientY-b.bottom);
    const wanted=draft?.kind==='ink'&&draft.region===k?draft.stroke.zone:null;
    const matching=wanted?candidates.filter(p=>(p.offset>0)===(wanted==='pad')):candidates;
    const best=(matching.length?matching:candidates).reduce((a,p)=>!a||dy(p.b)<dy(a.b)?p:a,null);
    if(best){const {b,offset,canvas}=best;return {x:clamp((e.clientX-b.left)/b.width),y:clamp((offset+canvas.clientHeight*clamp((e.clientY-b.top)/b.height))/quoteHeight(k))};}
  }
  const b=parts[0].canvas.getBoundingClientRect();
  const crop=k==='scripture'&&verseRange?scriptureClip.getBoundingClientRect():null;
  const y=crop?Math.max(crop.top,Math.min(crop.bottom,e.clientY)):e.clientY;
  return {x:clamp((e.clientX-b.left)/b.width),y:clamp((y-b.top)/b.height)};
}
function measure(){geometry=chars.filter(c=>!verseRange||(c.verse>=verseRange.start&&c.verse<=verseRange.end)).map(c=>({c,r:c.el.getBoundingClientRect()}));}
function charHit(e,nearest){let best=null,dist=Infinity;geometry.forEach(({c,r})=>{const dx=Math.max(r.left-e.clientX,0,e.clientX-r.right),dy=Math.max(r.top-e.clientY,0,e.clientY-r.bottom),d=dx*dx+dy*dy;if(d<dist){dist=d;best=c;}});return nearest||dist<100?best:null;}
function distance(p,a,b){const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y,t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/l)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
function segments(a,b,c,d){const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0?0:Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b));}
function erase(e){
  const k=draft.region,b=canvases[k].getBoundingClientRect(),w=canvases[k].clientWidth||b.width,h=quotePads[k]?quoteHeight(k):(canvases[k].clientHeight||b.height),p=point(e,k),px=q=>({x:q.x*w,y:q.y*h}),a=px(draft.last||p),z=px(p);
  state.ink[k]=state.ink[k].filter(s=>{const ps=s.points.map(px),r=10+s.width/2;if(ps.length===1)return distance(ps[0],a,z)>r;for(let i=1;i<ps.length;i++)if(segments(a,z,ps[i-1],ps[i])<=r)return false;return true;});
  if(k==='scripture'){
    const hit=charHit(e,false);if(hit)state.highlights=state.highlights.filter(h=>!(h.verse===hit.verse&&h.start<=hit.offset&&h.end>hit.offset));
  }else{
    const client={x:e.clientX,y:e.clientY};
    if(!quotePads[k]||insidePart(e,b))eraseNoteMarks(k,draft.lastClient||client,client);
    draft.lastClient=quotePads[k]&&!insidePart(e,b)?null:client;
  }
  draft.last=p;paint();
}
function start(e){
  finishTyping();const k=region(e);if(!k)return;if(k==='scripture')measure();const before=clone(state);
  if(tool==='erase'){draft={kind:'erase',region:k,before,last:null};erase(e);}
  else if(tool==='highlight'&&k==='scripture'){
    const hit=charHit(e,false);if(hit)draft={kind:'text',region:k,before,start:hit.index,end:hit.index,color:markColor()};
  }else if(tool==='highlight'&&noteSource(k).trim()){
    const hit=noteHit(e,k);if(hit)draft={kind:'note-text',region:k,before,start:hit,end:hit,color:markColor()};
  }else{
    draft={kind:'ink',region:k,before,stroke:{mode:tool==='highlight'?'highlight':'pen',color:tool==='highlight'?MARKERS[marker].ink:color,width:tool==='highlight'?14:2.8,...(quotePads[k]?{zone:insidePart(e,quotePads[k].canvas.getBoundingClientRect())?'pad':'verse'}:{}),points:[point(e,k)]}};
  }
  paint();
}
function move(e){
  if(!draft)return;
  if(draft.kind==='erase')erase(e);
  else if(draft.kind==='text'){const c=charHit(e,true);if(c)draft.end=c.index;paintText();}
  else if(draft.kind==='note-text'){const c=noteHit(e,draft.region,26);if(c){draft.end=c;paintNote(draft.region);}}
  else{draft.stroke.points.push(point(e,draft.region));paint();}
}
function finish(e){
  if(!draft)return;if(e&&Number.isFinite(e.clientX))move(e);
  const d=draft;draft=null;
  if(d.kind==='ink'){
    if(d.region!=='scripture'&&!d.region.startsWith('quote:')){d.stroke.uid=globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random();Timeline.pushInk(state.timeline,d.region,d.stroke.uid,Date.now());}
    state.ink[d.region].push(d.stroke);
  }
  if(d.kind==='text'){
    const chosen=chars.slice(Math.min(d.start,d.end),Math.max(d.start,d.end)+1);
    [...new Set(chosen.map(c=>c.verse))].forEach(v=>{const c=chosen.filter(c=>c.verse===v);state.highlights.push({verse:v,start:c[0].offset,end:c[c.length-1].offset+1,quote:c.map(c=>c.text).join(''),color:d.color||'#f4df8d'});});
  }
  if(d.kind==='note-text'){
    const k=d.region,hits=state.noteMarks[k],mark=markRange(d,noteSource(k));
    state.noteMarks[k]=TextMarks.clean([...hits,mark],noteSource(k));
  }
  record(d.before);paint();
}
function cancel(){if(!draft)return;state=draft.before;draft=null;paint();}
function setTool(t){cancel();finishTyping();if(t==='type'&&tool!=='type')separateInput('type');else if(['pen','highlight'].includes(t)&&!['pen','highlight'].includes(tool))separateInput('ink');tool=t;document.body.dataset.tool=t;document.querySelectorAll('button[data-tool]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.tool===t));b.classList.toggle('active',b.dataset.tool===t);});syncInputs();gesture?.sync?.();syncPaperControls();}
const picker=$('quotePicker'),quoteBook=$('quoteBook'),quoteChapter=$('quoteChapter'),quoteVerse=$('quoteVerse'),flow=$('noteFlow');
populateBooks(quoteBook);
function currentQuote(){const chapter=bible.chapter(quoteBook.value,quoteChapter.value);return chapter?Quotes.verse(bible,chapter.id,quoteVerse.value):null;}
function updateQuotePreview(){
  const q=currentQuote();
  $('quotePreview').textContent=q?.text||'';
  const exists=q&&state.quotes.some(item=>item.id===q.id&&item.number===q.number);
  $('quoteConfirm').disabled=!q;
  $('quoteConfirm').textContent=exists?'한 번 더 추가':'여백에 추가';
}
function changeQuoteChapter(){
  quoteVerse.replaceChildren();
  for(const [n] of bible.chapter(quoteBook.value,quoteChapter.value)?.verses||[])quoteVerse.append(option(n,n+'절'));
  updateQuotePreview();
}
const quoteQuery=$('quoteQuery'),quoteResults=$('quoteResults'),quoteSearchStatus=$('quoteSearchStatus'),quoteSearchMore=$('quoteSearchMore');
const findVerses=window.YeoVerseSearch.create(bible), resultPageSize=15;
let searchMatches=[],shownMatches=0;
function clearQuoteSearch(){
  searchMatches=[];shownMatches=0;quoteResults.replaceChildren();
  quoteSearchStatus.hidden=quoteResults.hidden=quoteSearchMore.hidden=true;
}
function appendQuoteMatches(){
  const start=shownMatches;
  const page=searchMatches.slice(start,start+resultPageSize);
  for(const result of page){
    const li=document.createElement('li'),button=document.createElement('button'),title=document.createElement('strong'),body=document.createElement('span');
    button.type='button';button.className='quote-result';title.textContent=result.ref;body.textContent=result.text;
    if(state.quotes.some(q=>q.id===result.id&&q.number===result.number)){
      const badge=document.createElement('small');badge.textContent='다시 추가 가능';title.append(' ',badge);
    }
    button.append(title,body);button.addEventListener('click',()=>{
      quoteBook.value=result.code;populateChapters(quoteChapter,result.code,result.chapter);changeQuoteChapter();
      quoteVerse.value=String(result.number);updateQuotePreview();
      const target=$('quoteConfirm').disabled?quoteVerse:$('quoteConfirm');
      target.focus();
    });
    li.append(button);quoteResults.append(li);
  }
  shownMatches+=page.length;
  quoteSearchMore.hidden=shownMatches>=searchMatches.length;
  if(start>0)quoteResults.children[start]?.firstElementChild?.focus();
}
function runQuoteSearch(){
  clearQuoteSearch();
  const value=quoteQuery.value.trim();
  quoteSearchStatus.hidden=false;
  if(!/[\p{L}\p{N}]/u.test(value)){quoteSearchStatus.textContent='기억나는 단어나 문장을 입력해 주세요.';return;}
  searchMatches=findVerses(value);
  quoteSearchStatus.textContent=searchMatches.length?searchMatches.length.toLocaleString('ko-KR')+'개 구절을 찾았어요.':'일치하는 구절이 없어요. 다른 단어나 더 짧은 문장으로 검색해 보세요.';
  if(searchMatches.length){quoteResults.hidden=false;appendQuoteMatches();}
}
$('quoteSearch').addEventListener('click',runQuoteSearch);
quoteQuery.addEventListener('input',clearQuoteSearch);
quoteQuery.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();runQuoteSearch();}
});
quoteSearchMore.addEventListener('click',appendQuoteMatches);
function blockKind(k){
  const ink=state.ink[k].length>0,typed=!!state.text[k].trim();
  return ink?(typed?'필기와 타이핑':'손글씨'):(typed||state.titles[k]?.trim()?'타이핑':'새 메모');
}
function makeHandle(label,id){
  const grip=document.createElement('button');grip.type='button';grip.className='inline-grab';grip.dataset.dragHandle='true';
  grip.textContent='⠿ '+label;grip.setAttribute('aria-label',label+' 박스 잡고 이동');
  grip.addEventListener('keydown',e=>{
    if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;
    e.preventDefault();
    const ids=inlineIds(),down=e.key==='ArrowDown',target=ids[ids.indexOf(id)+(down?1:-1)];
    if(target)saveInlineOrder(id,target,down,true);
  });
  return grip;
}
function syncDragBlocks(){
  if(!state||!flow)return;
  for(const k of state.blocks){
    const box=notePlanes[k]?.parentElement;
    const grip=box?.querySelector('[data-drag-handle]');if(!grip)continue;
    const label=blockKind(k);grip.textContent=(label==='새 메모'?'':'⠿ ')+label;
    grip.setAttribute('aria-label',label==='새 메모'?label:label+' 박스 잡고 이동');
    grip.disabled=label==='새 메모';box.dataset.empty=String(grip.disabled);
  }
}
const inlineIds=()=>[...flow.children].filter(e=>e.dataset.orderId&&e.dataset.empty!=='true').map(e=>e.dataset.orderId);
function migratedOrder(){
  if(state.inlineOrder!==null)return state.inlineOrder;
  const old=state.manualOrder,index=new Map();
  state.timeline.forEach((e,i)=>{
    if(e.kind==='type')index.set('type:'+(e.uid||i+':'+e.at),'block:'+e.block);
    if(e.kind==='ink')index.set('ink:'+e.ids[0],'block:'+e.block);
  });
  return old.map(key=>key.startsWith('legacy-text:')||key.startsWith('legacy-ink:')?'block:'+key.slice(key.indexOf(':')+1):index.get(key)||key);
}
function applyInlineOrder(){
  const boxes=[...flow.children], ids=inlineIds(), byId=new Map(boxes.map(b=>[b.dataset.orderId,b]));
  const arranged=Order.ordered(ids,migratedOrder()), untouched=boxes.filter(b=>!ids.includes(b.dataset.orderId));
  for(const box of [...arranged.map(id=>byId.get(id)),...untouched])flow.append(box);
}
function saveInlineOrder(id,target,after,keepFocus=false){
  cancel();finishTyping();const ids=inlineIds(),next=Order.moved(ids,id,target,after);
  if(next.join('|')===ids.join('|'))return;
  const before=clone(state);state.inlineOrder=next;
  const k=lastBlock();
  if(blockKind(k)!=='새 메모'){
    compactBlock(k);appendBlock();renderFlow();
  }else applyInlineOrder();
  record(before);paint();$('inlineOrderStatus').textContent='여백에서 박스 순서를 바꿨어요.';
  if(keepFocus)[...flow.children].find(b=>b.dataset.orderId===id)?.querySelector('[data-drag-handle]')?.focus({preventScroll:true});
}
function strokeBottom(strokes,height){return strokes.reduce((max,s)=>s.points.reduce((m,p)=>Math.max(m,p.y*height+s.width/2+4),max),0);}
function forgetQuote(k){delete state.ink[k];delete state.noteMarks[k];delete state.quoteHeights[k];delete state.quoteMemos[k];}
function renderCard(q){
    const v=Quotes.verse(bible,q.id,q.number);if(!v)return;
    const card=document.createElement('article');card.className='quote-card';card.dataset.tint=q.color;card.dataset.orderId=quoteKey(q);
    const top=document.createElement('div');top.className='quote-card-top';
    const ref=makeHandle(v.ref,card.dataset.orderId);
    const actions=document.createElement('div');actions.className='quote-card-actions';
    const tint=document.createElement('select');tint.setAttribute('aria-label',v.ref+' 카드 색');
    for(const [key,label] of Object.entries(Quotes.colors)){const o=document.createElement('option');o.value=key;o.textContent=label;tint.append(o);}
    tint.value=q.color;
    tint.addEventListener('change',()=>{finishTyping();const current=state.quotes.find(item=>quoteKey(item)===card.dataset.orderId);if(!current)return;const before=clone(state);current.color=Quotes.palette(tint.value);card.dataset.tint=current.color;record(before);});
    const remove=document.createElement('button');remove.type='button';remove.dataset.cardControl='true';remove.textContent='×';remove.setAttribute('aria-label',v.ref+' 카드 빼기');
    remove.addEventListener('click',()=>{finishTyping();const before=clone(state);state.quotes=state.quotes.filter(item=>quoteKey(item)!==card.dataset.orderId);forgetQuote(card.dataset.orderId);renderFlow();record(before);paint();status('카드를 뺐어요 · 되돌리기로 복구 가능');});
    const key=quoteKey(q),plane=document.createElement('div'),quote=document.createElement('p'),canvas=document.createElement('canvas');
    plane.className='quote-plane';canvas.className='ink-plane';canvas.setAttribute('aria-hidden','true');
    canvases[key]=canvas;noteReaders[key]=quote;quoteTexts[key]=v.text;state.ink[key]??=[];state.noteMarks[key]??=[];
    const applyHeight=()=>layoutQuote(key);
    const resizer=makeResizer(key,plane,{
      label:v.ref+' 카드 높이 조절',minimum:40,
      getHeight:()=>quoteHeight(key),
      floor:()=>Math.max(40,quote.offsetTop+quote.offsetHeight+6,strokeBottom(state.ink[key],quoteHeight(key))),
      setHeight:h=>{const old=quoteHeight(key);state.quoteHeights[key]=h;applyHeight();const next=quoteHeight(key);
        if(next!==old)state.ink[key].forEach(s=>s.points.forEach(p=>p.y*=old/next));},
      restore:before=>{state=before;applyHeight();},commit:()=>{}
    });
    const memoLabel=document.createElement('label'),labelText=document.createElement('span'),memo=document.createElement('textarea');
    memoLabel.className='quote-memo';labelText.textContent='말씀 메모';
    memo.rows=2;memo.placeholder='이 말씀에 대한 메모를 남겨보세요.';memo.setAttribute('aria-label',v.ref+' 말씀 메모');
    memo.value=state.quoteMemos[key]??'';memo.spellcheck=false;
    const beginMemo=()=>{
      if(typingBefore&&typingKey!==key)finishTyping();
      if(!typingBefore){typingBefore=clone(state);typingKey=key;}
    };
    memo.addEventListener('beforeinput',beginMemo);
    memo.addEventListener('input',()=>{
      beginMemo();
      if(memo.value)state.quoteMemos[key]=memo.value;else delete state.quoteMemos[key];
      fitQuoteMemo(memo);persist(true);
    });
    memo.addEventListener('blur',()=>{finishTyping();memo._fitValue=null;fitQuoteMemo(memo);});
    memoLabel.append(labelText,memo);
    const pad=document.createElement('div'),padCanvas=document.createElement('canvas');
    pad.className='quote-pad';padCanvas.className='ink-plane';padCanvas.setAttribute('aria-hidden','true');pad.append(padCanvas);
    quotePads[key]={pad,canvas:padCanvas,memo};
    actions.append(tint,remove);top.append(ref,actions);plane.append(quote,canvas);card.append(top,plane,memoLabel,pad,resizer);paintNote(key);
    requestAnimationFrame(()=>{if(card.isConnected){applyHeight();resizer.setAttribute('aria-valuenow',String(quoteHeight(key)));}});
    inkObserver?.observe(canvas);inkObserver?.observe(padCanvas);return card;
}
function makeResizer(k,plane,config={}){
  const minimum=config.minimum??64, label=config.label??'타이핑 칸 높이 조절';
  const height=config.getHeight??(()=>noteHeight(k)),floor=config.floor??(()=>neededHeight(k));
  const applyHeight=config.setHeight??(h=>setHeight(k,h));
  const commit=config.commit??(()=>{state.sizedBlocks[k]=true;});
  const bar=document.createElement('button');bar.type='button';bar.className='resize-note';
  bar.setAttribute('role','slider');bar.setAttribute('aria-orientation','vertical');
  bar.setAttribute('aria-label',label);bar.title='위아래로 끌어서 '+label;bar.dataset.cardControl='true';
  const measure=()=>{
    bar.setAttribute('aria-valuemin',String(Math.min(height(),Math.max(minimum,floor()))));
    bar.setAttribute('aria-valuemax',String(Math.max(8192,height())));
    bar.setAttribute('aria-valuenow',String(height()));
  };
  bar.addEventListener('focus',measure);
  const grip=document.createElement('span');grip.setAttribute('aria-hidden','true');bar.append(grip);
  let active=null,frame=0;
  function apply(delta,initial=height(),scale=1){
    const next=Paper.dragHeight(initial,delta,scale,floor(),minimum);
    if(next!==height()){applyHeight(next);geometry=[];paint();}
    measure();return next;
  }
  function tick(){
    if(!active)return;
    const lane=active.lane,r=lane.getBoundingClientRect();
    if(active.y>r.bottom-27&&active.y<r.bottom+16)lane.scrollTop+=9;
    if(active.y<r.top+24&&active.y>r.top-10)lane.scrollTop-=9;
    apply(active.y-active.startY+(lane.scrollTop-active.scroll)*active.laneScale,active.height,active.scale);
    frame=requestAnimationFrame(tick);
  }
  bar.addEventListener('pointerdown',e=>{
    if(!e.isPrimary||e.button!==0)return;
    cancel();finishTyping();e.preventDefault();
    const lane=noteScroll(),scale=plane.getBoundingClientRect().height/plane.offsetHeight||1;
    active={id:e.pointerId,startY:e.clientY,y:e.clientY,lane,laneScale:lane===scroll?1:scale,scroll:lane.scrollTop,height:height(),scale,before:clone(state),moved:false};
    try{bar.setPointerCapture(e.pointerId);}catch{}
  });
  bar.addEventListener('pointermove',e=>{
    if(!active||active.id!==e.pointerId)return;
    active.y=e.clientY;
    if(!active.moved&&Math.abs(e.clientY-active.startY)>3){active.moved=true;tick();}
    if(active.moved)apply(e.clientY-active.startY+(active.lane.scrollTop-active.scroll)*active.laneScale,active.height,active.scale);
  });
  function end(e,abort){
    if(!active||active.id!==e.pointerId)return;
    const d=active;active=null;
    if(frame)cancelAnimationFrame(frame);frame=0;
    if(abort&&d.moved){if(config.restore)config.restore(d.before);else applyHeight(d.height);paint();measure();}
    else if(d.moved&&height()!==d.height){commit();record(d.before);}
    if(bar.hasPointerCapture?.(e.pointerId))bar.releasePointerCapture(e.pointerId);
  }
  bar.addEventListener('pointerup',e=>end(e,false));
  bar.addEventListener('pointercancel',e=>end(e,true));bar.addEventListener('lostpointercapture',e=>end(e,true));
  bar.addEventListener('keydown',e=>{
    if(!['ArrowUp','ArrowDown','Home'].includes(e.key))return;
    e.preventDefault();cancel();finishTyping();
    const before=clone(state),old=height();
    if(apply(e.key==='Home'?-old:e.key==='ArrowUp'?-32:32)!==old){commit();record(before);}
  });
  bar.setAttribute('aria-valuemin',String(minimum));bar.setAttribute('aria-valuemax',String(Math.max(8192,height())));bar.setAttribute('aria-valuenow',String(height()));
  return bar;
}
function renderFlow(){
  for(const k of Object.keys(notePlanes)){inkObserver?.unobserve(canvases[k]);delete canvases[k];delete notePlanes[k];delete noteInputs[k];delete noteReaders[k];}
  for(const k of Object.keys(quoteTexts)){inkObserver?.unobserve(canvases[k]);if(quotePads[k])inkObserver?.unobserve(quotePads[k].canvas);delete canvases[k];delete noteReaders[k];delete quoteTexts[k];delete quotePads[k];}
  flow.replaceChildren();
  for(const q of state.quotes)if(q.after==='before'){const card=renderCard(q);if(card)flow.append(card);}
  for(const [index,k] of state.blocks.entries()){
    if(state.deletedBlocks[k]){
      for(const q of state.quotes)if(q.after===k){const card=renderCard(q);if(card)flow.append(card);}
      continue;
    }
    const box=document.createElement('section');box.className='inline-note-box';box.dataset.orderId='block:'+k;
    const head=document.createElement('div'),title=document.createElement('input');head.className='note-box-head';
    title.className='note-topic';title.type='text';title.maxLength=100;title.value=state.titles[k]||'';
    title.placeholder='소주제 적기';title.setAttribute('aria-label','소주제 '+(index+1));title.dataset.cardControl='true';
    title.addEventListener('beforeinput',()=>{if(!topicBefore)topicBefore=clone(state);});
    title.addEventListener('input',()=>{if(!topicBefore)topicBefore=clone(state);state.titles[k]=title.value;persist(true);});
    title.addEventListener('blur',finishTopic);
    title.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){
        event.preventDefault();finishTopic();openKeyboardFor(k);
      }
    });
    head.append(makeHandle(blockKind(k),box.dataset.orderId),title);box.append(head);
    const plane=document.createElement('div');plane.className='note-plane';plane.dataset.block=k;
    const canvas=document.createElement('canvas');canvas.className='ink-plane';canvas.setAttribute('aria-hidden','true');
    const input=document.createElement('textarea');input.spellcheck=false;input.value=state.text[k];
    const reader=document.createElement('div'),readText=document.createElement('div');
    reader.className='note-reader';reader.setAttribute('aria-hidden','true');readText.className='note-reader-text';reader.append(readText);
    input.addEventListener('scroll',()=>{reader.scrollTop=input.scrollTop;});
    input.setAttribute('aria-label',index?'나의 여백 이어쓰기 '+index:'나의 여백 키보드 메모');
    input.placeholder=index===state.blocks.length-1?'여기에 메모를 입력하세요.':'';
    let editSelection;
    input.addEventListener('beforeinput',event=>{
      if(!typingBefore){typingBefore=clone(state);typingKey=k;}
      editSelection={start:input.selectionStart,end:input.selectionEnd,type:event.inputType};
    });
    input.addEventListener('input',()=>{
      if(!typingBefore){typingBefore=clone(state);typingKey=k;}
      state.noteMarks[k]=TextMarks.forEdit(state.noteMarks[k],state.text[k],input.value,editSelection);editSelection=undefined;state.text[k]=input.value;paintNote(k);
      // Use the current textarea's overflow, not a temporary collapse of the focused control.
      const height=input.scrollHeight>input.clientHeight?Math.ceil((input.scrollHeight+12)/32)*32:noteHeight(k);
      if(height>noteHeight(k)){setHeight(k,height);geometry=[];paint();}
      persist(true);
    });
    input.addEventListener('blur',finishTyping);
    canvases[k]=canvas;noteInputs[k]=input;notePlanes[k]=plane;noteReaders[k]=readText;
    plane.append(reader,canvas,input);paintNote(k);setHeight(k,noteHeight(k));box.append(plane,makeResizer(k,plane));flow.append(box);
    inkObserver?.observe(canvas);
    for(const q of state.quotes){if(q.after===k){const card=renderCard(q);if(card)flow.append(card);}}
  }
  syncInputs();syncDragBlocks();applyInlineOrder();
}
function openKeyboardFor(k){
  if(tool!=='type'){
    const last=lastBlock();
    if(k===last&&!state.text[k]&&state.ink[k].length){openKeyboard();return;}
    cancel();finishTyping();tool='type';setTool('type');
  }
  focusVisibleNote(noteInputs[k]);
}
$('addTopic').addEventListener('click',()=>{
  showNotePage();cancel();finishTyping();
  let k=lastBlock();
  if(state.text[k].trim()||state.ink[k].length||state.titles[k]?.trim()){
    const before=clone(state);compactBlock(k);appendBlock();k=lastBlock();renderFlow();record(before);paint();
  }
  openKeyboardFor(k);
  const title=notePlanes[k]?.parentElement?.querySelector('.note-topic');
  title?.closest('.inline-note-box')?.scrollIntoView({block:'start'});
  title?.focus({preventScroll:true});
});
$('addQuote').addEventListener('click',()=>{showNotePage();cancel();finishTyping();quoteQuery.value='';clearQuoteSearch();quoteBook.value=passage.code;populateChapters(quoteChapter,passage.code,passage.chapter);changeQuoteChapter();picker.showModal();});
$('quoteCancel').addEventListener('click',()=>picker.close());
quoteBook.addEventListener('change',()=>{populateChapters(quoteChapter,quoteBook.value);changeQuoteChapter();});
quoteChapter.addEventListener('change',changeQuoteChapter);
quoteVerse.addEventListener('change',updateQuotePreview);
picker.querySelector('form').addEventListener('submit',e=>{
  e.preventDefault();const q=currentQuote();if(!q||$('quoteConfirm').disabled)return;
  const before=clone(state),k=lastBlock(),sortBefore=state.inlineOrder!==null||state.manualOrder.length?inlineIds():null;
  const card=Quotes.add(q,state.quotes,k),id=quoteKey(card);
  compactBlock(k);state.quotes.push(card);state.timeline.push({kind:'quote',id:q.id,number:q.number,at:Date.now(),...(card.instance?{instance:card.instance}:{})});
  if(sortBefore)state.inlineOrder=[...sortBefore,id];appendBlock();renderFlow();record(before);paint();picker.close();
  requestAnimationFrame(()=>{[...flow.children].find(b=>b.dataset.orderId===id)?.scrollIntoView({block:'nearest'});if(tool==='type')focusLast();});
});
function hideTrashToast(){
  clearTimeout(trashToastTimer);trashToastTimer=0;
  trashSnapshot=null;$('trashToast').hidden=true;
}
function showTrashToast(){
  hideTrashToast();trashSnapshot=undo.at(-1);$('trashToast').hidden=false;
  trashToastTimer=setTimeout(hideTrashToast,10000);
}
function trashBox(id){
  cancel();finishTyping();
  const ids=inlineIds();if(!ids.includes(id))return;
  const before=clone(state);
  if(id.startsWith('quote:')){
    state.quotes=state.quotes.filter(q=>quoteKey(q)!==id);forgetQuote(id);
  }else if(id.startsWith('block:')){
    const key=id.slice(6);if(!state.blocks.includes(key)||state.deletedBlocks[key])return;
    state.deletedBlocks[key]=true;
    if(lastBlock()===key)appendBlock();
  }else return;
  // Preserve the visible order of surviving items and any verse anchored to a removed note.
  state.inlineOrder=ids.filter(key=>key!==id);
  renderFlow();record(before);paint();
  showTrashToast();
}
$('undoTrash').addEventListener('click',()=>{if(undo.at(-1)===trashSnapshot)history('undo');hideTrashToast();});
Order.mount(flow,scroll,saveInlineOrder,{getScroller:noteScroll,trash:$('dragTrash'),onTrash:trashBox});
const phoneSwipe=matchMedia('(max-width:559px), (max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const protectedTouch='button, select, textarea, input, label, a, summary, [data-card-control], [contenteditable], [data-drag-handle]';
function gestureLane(e){
  if(!wideSpread.matches)return null;
  if(e.target.closest?.('#scriptureReference'))return 'reference';
  if(e.target.closest?.('#writingPaper'))return 'writing';
  return null;
}
function canSwipeQuote(e){
  if(e.target.closest?.(protectedTouch))return false;
  const lane=gestureLane(e);
  if(lane==='reference')return 'reference';
  if(e.target.closest?.('.bulletin-panel'))return 'reader';
  if(!e.target.closest?.('.quote-pad')&&e.target.closest?.('.quote-card')&&(lane==='writing'||phoneSwipe.matches))
    return lane||'reader';
  return lane==='writing'&&!region(e)?'writing':false;
}
function scrollGesture(dy,lane){
  const pane=wideSpread.matches?(lane==='reference'?scriptureReference:lane==='writing'?writingPaper:scroll):scroll;
  const scale=pane===scroll?1:window.CornellZoom?.scale()||1;
  pane.scrollBy(0,(dy||0)/scale);geometry=[];
}
// Keep a gesture in its original pane. A second finger cancels provisional ink.
if(window.CornellGestures)gesture=window.CornellGestures.mount(scroll,{laneFor:gestureLane,canPan:canSwipeQuote,
  canStart:e=>!e.target.closest?.(protectedTouch)&&!!region(e)&&['pen','highlight','erase'].includes(tool),
  canWrite:()=>['pen','highlight','erase'].includes(tool),start,move,finish,cancel,
  pinch:data=>{window.CornellZoom?.pinch(data);geometry=[];},scrollBy:scrollGesture});
else status('필기 모듈을 불러오지 못했습니다. 새로고침해 주세요.');
document.querySelectorAll('button[data-tool]').forEach(b=>b.addEventListener('click',()=>b.dataset.tool==='type'?openKeyboard():setTool(b.dataset.tool)));
document.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click',()=>{color=b.dataset.color;document.querySelectorAll('[data-color]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));}));
syncMarkerButtons();document.querySelectorAll('[data-marker]').forEach(b=>b.addEventListener('click',()=>selectMarker(b.dataset.marker)));
$('moreLines').addEventListener('click',moreLines);
$('lessLines').addEventListener('click',()=>resizeNote(-1));
$('undo')?.addEventListener('click',()=>history('undo'));$('redo')?.addEventListener('click',()=>history('redo'));
populateBooks(select);
select.addEventListener('change',()=>navigateChapter(bible.chapter(select.value,1)));
chapterSelect.addEventListener('change',()=>navigateChapter(bible.chapter(select.value,chapterSelect.value)));
const rangePicker=$('passageRangePicker'),rangeBook=$('rangeBook'),rangeChapter=$('rangeChapter'),rangeStart=$('rangeStart'),rangeEnd=$('rangeEnd');
populateBooks(rangeBook);
let previousRangeStart;
function rangeVerses(){return bible.chapter(rangeBook.value,rangeChapter.value)?.verses??[];}
function setRangeEnds(want){
  const numbers=rangeVerses().map(v=>v[0]).filter(n=>n>=Number(rangeStart.value));
  rangeEnd.replaceChildren(...numbers.map(n=>option(n,n+'절')));
  rangeEnd.value=String(numbers.includes(Number(want))?Number(want):numbers[0]);
}
function setRangeStarts(from,to){
  const numbers=rangeVerses().map(v=>v[0]);
  rangeStart.replaceChildren(...numbers.map(n=>option(n,n+'절')));
  rangeStart.value=String(numbers.includes(Number(from))?Number(from):numbers[0]);previousRangeStart=rangeStart.value;setRangeEnds(to);
}
function revealScriptureOnMobile(){
  const tab=document.querySelector('button[data-page="scripture"]');
  if(tab?.getClientRects().length){if(document.body.dataset.mobile!=='scripture')tab.click();scroll.scrollTop=0;}
}
$('openPassageRange').addEventListener('click',()=>{
  rangeBook.value=passage.code;populateChapters(rangeChapter,passage.code,passage.chapter);
  setRangeStarts(verseRange?.start,verseRange?.end);rangePicker.showModal();
});
rangeBook.addEventListener('change',()=>{populateChapters(rangeChapter,rangeBook.value);setRangeStarts();});
rangeChapter.addEventListener('change',()=>setRangeStarts());
rangeStart.addEventListener('change',()=>{
  setRangeEnds(Bible.endForStart(rangeStart.value,previousRangeStart,rangeEnd.value));
  previousRangeStart=rangeStart.value;
});
$('cancelPassageRange').addEventListener('click',()=>rangePicker.close());
function openChosenRange(e,full=false){
  e.preventDefault();
  const p=bible.chapter(rangeBook.value,rangeChapter.value);
  const selected=full?null:window.YeoBible.range(p,rangeStart.value,rangeEnd.value);
  if(!p||(!full&&!selected)||!syncReady)return;
  rangePicker.close();navigateChapter(p,selected);revealScriptureOnMobile();requestAnimationFrame(fitVerseRange);
}
$('passageRangeForm').addEventListener('submit',e=>openChosenRange(e));
$('rangeWhole').addEventListener('click',e=>openChosenRange(e,true));
$('fullChapter').addEventListener('click',()=>{navigateChapter(passage,null);revealScriptureOnMobile();});
if(window.ResizeObserver)new ResizeObserver(fitVerseRange).observe($('scriptureText'));
$('fontSize').addEventListener('click',()=>requestAnimationFrame(fitVerseRange));
const bulletinPicker=$('bulletinPicker'),bulletinReview=$('bulletinReview'),bulletinAdd=$('bulletinAdd');
const bulletinStatus=$('bulletinOCRStatus'),bulletinFull=$('bulletinFullReview'),bulletinQuestionReview=$('bulletinQuestionReview'),bulletinFullEditor=$('bulletinFullEditor');
let bulletinScan=null,bulletinContext=null;
function resetPhotoFrame(){
  const frame=$('bulletinPhotoFrame');frame.hidden=true;frame.open=false;
  $('bulletinPhotoFrameText').value='';
}
function finishBulletinEdit(){
  if(!bulletinBefore)return;
  const before=bulletinBefore;bulletinBefore=null;record(before,false);
}
function renderBulletinSections(target,raw,shortcuts=false){
  target.replaceChildren();
  const parts=Bulletin.sections(raw),nav=document.createElement('div');nav.className='bulletin-jumps';
  const showShortcuts=shortcuts&&parts.filter(item=>item.title).length>1;
  if(showShortcuts)target.append(nav);
  for(const item of parts){
    const section=document.createElement('section');
    section.className='bulletin-section';section.dataset.kind=item.kind;
    if(item.title){
      const title=document.createElement('h3');title.textContent=item.title;section.append(title);
    }
    if(item.text){
      const p=document.createElement('p');p.className='bulletin-body-text';p.textContent=item.text;
      if(shortcuts&&Bulletin.sectionHasAnswerCards(item,state.bulletinQuestions)){
        const details=document.createElement('details'),summary=document.createElement('summary');
        details.className='bulletin-source-text';summary.textContent='질문 원문 보기';
        details.append(summary,p);section.append(details);
      }else section.append(p);
    }
    target.append(section);
    if(showShortcuts&&item.title){
      const jump=document.createElement('button');jump.type='button';jump.className='bulletin-jump';
      jump.dataset.kind=item.kind;jump.textContent=item.title;
      jump.addEventListener('click',()=>section.scrollIntoView({behavior:'instant',block:'start'}));
      nav.append(jump);
    }
  }
  return parts.length;
}
function previewBulletinSections(){
  const box=$('bulletinPreview');box.hidden=!renderBulletinSections(box,bulletinFull.value);
}
function renderBulletinBody(){
  const list=$('bulletinBodyItems');list.replaceChildren();
  state.bulletinBody.forEach((entry,index)=>{
    const card=document.createElement('article');card.className='bulletin-body-card';
    const head=document.createElement('header'),ref=document.createElement('small'),actions=document.createElement('div');head.className='bulletin-body-controls';
    const edit=document.createElement('button'),remove=document.createElement('button');
    ref.textContent=entry.reference;actions.className='bulletin-body-actions';
    edit.type=remove.type='button';edit.className='records-button';remove.className='records-button record-remove';
    edit.textContent='글 수정';remove.textContent='전체 글 삭제';
    edit.setAttribute('aria-label','주보 전체 글 '+(index+1)+' 수정');
    remove.setAttribute('aria-label','주보 전체 글 '+(index+1)+' 삭제');
    const read=document.createElement('div');read.className='bulletin-body-sections';renderBulletinSections(read,entry.text);
    const editor=document.createElement('div'),area=document.createElement('textarea'),save=document.createElement('button'),cancelEdit=document.createElement('button');
    editor.className='bulletin-body-editor';editor.hidden=true;area.rows=9;area.maxLength=Bulletin.MAX_BODY;
    area.setAttribute('aria-label','주보 전체 글 '+(index+1));save.type=cancelEdit.type='button';
    save.className=cancelEdit.className='records-button';save.textContent='수정 저장';cancelEdit.textContent='취소';
    const close=()=>{editor.hidden=true;read.hidden=false;edit.focus();afterInteraction();};
    edit.addEventListener('click',()=>{area.value=entry.text;read.hidden=true;editor.hidden=false;area.focus({preventScroll:true});});
    cancelEdit.addEventListener('click',close);
    save.addEventListener('click',()=>{
      if(!syncReady||currentTrashed||!state.bulletinBody.includes(entry))return;
      const pending=Bulletin.cleanBody(area.value);if(!pending)return;
      const before=clone(state);entry.text=pending;renderBulletinSections(read,pending,true);record(before);close();
    });
    remove.addEventListener('click',()=>{
      if(!syncReady||currentTrashed||!confirm('이 주보 전체 글만 삭제할까요? 질문과 답은 그대로 유지됩니다.'))return;
      finishTyping();const before=clone(state);
      state.bulletinBody=state.bulletinBody.filter(q=>q.id!==entry.id);renderBulletin();record(before);
    });
    editor.append(area,save,cancelEdit);actions.append(edit,remove);head.append(ref,actions);card.append(head,read,editor);list.append(card);renderBulletinSections(read,entry.text,true);
  });
}
function renderBulletin(){
  const count=state.bulletinQuestions.length;
  $('bulletinPanel').hidden=!count&&!state.bulletinBody.length;
  $('showCurrentBulletin').hidden=$('bulletinPanel').hidden;
  $('bulletinBodySection').hidden=!state.bulletinBody.length;
  $('bulletinQuestionSection').hidden=!count;renderBulletinBody();
  $('bulletinTitle').textContent=count?'주보 질문과 답 · '+count+'개':'주보 질문과 답';
  const notice=$('bulletinAddedStatus');notice.hidden=true;notice.textContent='';
  const list=$('bulletinItems');list.replaceChildren();
  state.bulletinQuestions.forEach((entry,index)=>{
    const card=document.createElement('article');card.className='bulletin-card bulletin-question-card';
    const kind=Bulletin.questionKind(entry.question);card.dataset.kind=kind;
    const head=document.createElement('header'),ref=document.createElement('small'),remove=document.createElement('button');
    const type=document.createElement('h3');type.className='bulletin-question-heading';
    type.textContent=(kind==='action'?'결단 질문':'질문')+' '+(index+1);
    ref.textContent=entry.reference;remove.type='button';remove.className='records-button record-remove';remove.textContent='질문 삭제';
    remove.setAttribute('aria-label','주보 질문 '+(index+1)+' 삭제');
    remove.addEventListener('click',()=>{
      if(!syncReady||currentTrashed||!confirm('이 질문과 내 답을 삭제할까요? 되돌리기 버튼으로 복원할 수 있어요.'))return;
      finishTyping();const before=clone(state);
      state.bulletinQuestions=state.bulletinQuestions.filter(q=>q.id!==entry.id);
      renderBulletin();record(before);
    });
    head.append(type,remove);card.append(head,ref);
    for(const [key,caption,max] of [['question','질문',Bulletin.MAX_QUESTION],['answer','내 답',Bulletin.MAX_ANSWER]]){
      const label=document.createElement('label'),area=document.createElement('textarea');
      const id='bulletin-'+index+'-'+key;area.id=id;label.htmlFor=id;label.textContent=caption;
      area.value=entry[key];area.maxLength=max;area.rows=key==='answer'?3:2;
      area.setAttribute('aria-label',caption+' '+(index+1));
      if(key==='answer')area.placeholder='이 질문에 대한 내 답을 적어 보세요.';
      const capture=()=>{
        if(!syncReady||currentTrashed||entry[key]===area.value)return;
        bulletinBefore??=clone(state);entry[key]=area.value;persist(true);
      };
      area.addEventListener('input',e=>{if(!e.isComposing)capture();});
      area.addEventListener('compositionend',capture);
      area.addEventListener('blur',()=>{capture();finishBulletinEdit();});
      card.append(label,area);
    }
    list.append(card);
  });
}
function bulletinReference(){return verseRange?.label||passage.label;}
function syncBulletinAdd(){
  const count=Bulletin.parseReview(bulletinReview.value).length;
  bulletinAdd.disabled=!!bulletinScan||(!Bulletin.cleanBody(bulletinFull.value)&&!count);
  $('bulletinQuestionSummary').textContent=count?'답변 칸을 만들 질문 '+count+'개 확인':'답변 칸을 만들 질문 확인';
}
function resetBulletinScanner(){
  bulletinScan?.abort();bulletinScan=null;bulletinContext=null;
  bulletinReview.value='';bulletinFull.value='';bulletinStatus.textContent='';bulletinQuestionReview.open=false;bulletinFullEditor.open=true;resetPhotoFrame();previewBulletinSections();
  for(const id of ['bulletinCamera','bulletinFile'])$(id).value='';
  syncBulletinAdd();
}
$('openBulletin').addEventListener('click',()=>{
  if(!syncReady||currentTrashed)return;
  cancel();finishTyping();resetBulletinScanner();
  bulletinContext={chapter:passage.id,account:sync.account(),reference:bulletinReference()};
  $('bulletinTarget').textContent=bulletinContext.reference+' 아래에 추가';
  bulletinPicker.showModal();
});
$('closeBulletin').addEventListener('click',()=>bulletinPicker.close());
bulletinPicker.addEventListener('close',()=>{if(!bulletinPicker.open)resetBulletinScanner();});
$('bulletinTake').addEventListener('click',()=>$('bulletinCamera').click());
$('bulletinChoose').addEventListener('click',()=>$('bulletinFile').click());
bulletinReview.addEventListener('input',syncBulletinAdd);
bulletinFull.addEventListener('input',()=>{syncBulletinAdd();previewBulletinSections();});
async function scanBulletin(file){
  if(!file||!bulletinPicker.open)return;
  if(file.size>24000000||(!file.type.startsWith('image/')&&file.type!=='')){
    bulletinStatus.textContent='24MB 이하 사진을 선택해 주세요.';return;
  }
  bulletinScan?.abort();const controller=new AbortController();bulletinScan=controller;
  bulletinFull.value='';bulletinReview.value='';bulletinQuestionReview.open=false;bulletinFullEditor.open=true;resetPhotoFrame();previewBulletinSections();
  bulletinStatus.textContent='사진 속 글자를 읽고 있어요…';syncBulletinAdd();
  try{
    const engine=window.YeoBulletinOCR;
    if(!engine?.analyzeBulletin)throw Error('no_ocr');
    const data=await engine.analyzeBulletin(file,{signal:controller.signal,onProgress:f=>{
      if(bulletinScan===controller&&Number.isFinite(f))bulletinStatus.textContent='주보 전체를 읽는 중 · '+Math.max(0,Math.min(100,Math.round(f*100)))+'%';
    }});
    if(bulletinScan!==controller||!bulletinPicker.open)return;
    const body=Bulletin.cleanBody(data?.text);
    const found=Bulletin.extract(data?.questionText||body);
    if(body)bulletinFull.value=body;
    previewBulletinSections();bulletinFullEditor.open=!body;
    const original=Bulletin.cleanBody(data?.originalText);
    if(original&&original!==body){
      $('bulletinPhotoFrameText').value=original;
      $('bulletinPhotoFrame').hidden=false;
    }
    if(found.length)bulletinReview.value=found.join('\n');
    bulletinQuestionReview.open=found.length>0;
    bulletinStatus.textContent=body?'주보 전체 글과 질문 '+found.length+'개를 읽었어요. 사진과 대조한 뒤 추가해 주세요.':'사진에서 글을 읽지 못했어요. 주보 전체를 다시 찍거나 글을 붙여 넣어 주세요.';
  }catch{
    if(bulletinScan===controller&&!controller.signal.aborted)
      bulletinStatus.textContent='사진에서 글자를 읽지 못했어요. 사진을 다시 찍거나 질문을 붙여 넣어 주세요.';
  }finally{
    if(bulletinScan===controller){bulletinScan=null;syncBulletinAdd();}
  }
}
for(const id of ['bulletinCamera','bulletinFile'])$(id).addEventListener('change',e=>{const file=e.target.files?.[0];e.target.value='';void scanBulletin(file);});
$('bulletinForm').addEventListener('submit',e=>{
  e.preventDefault();const context=bulletinContext;
  if(!context||!syncReady||currentTrashed||bulletinScan||passage.id!==context.chapter||sync.account()!==context.account)return;
  const questions=Bulletin.parseReview(bulletinReview.value),body=Bulletin.cleanBody(bulletinFull.value);
  if(!questions.length&&!body)return;
  if(body.length>Bulletin.MAX_BODY){bulletinStatus.textContent='주보 한 페이지에 '+Bulletin.MAX_BODY.toLocaleString()+'자까지 저장할 수 있어요. 나눠서 추가해 주세요.';return;}
  const bodyExisting=Bulletin.bodyIndex(state.bulletinBody,body),addBody=!!body&&bodyExisting<0;
  if(addBody&&state.bulletinBody.length>=Bulletin.MAX_BODIES){bulletinStatus.textContent='한 장에 주보 전체 글을 최대 '+Bulletin.MAX_BODIES+'개까지 둘 수 있어요.';return;}
  const makeId=i=>globalThis.crypto?.randomUUID?.()||Date.now()+'-'+i+'-'+Math.random();
  const merged=Bulletin.mergeQuestions(state.bulletinQuestions,questions,(question,i)=>({
    id:makeId(i),question,answer:'',reference:context.reference
  }));
  if(merged.entries.length>Bulletin.LIMIT){
    bulletinStatus.textContent='한 장에 최대 '+Bulletin.LIMIT+'개의 질문을 둘 수 있어요. 추가할 질문 수를 줄여 주세요.';return;
  }
  const before=clone(state);state.bulletinQuestions=merged.entries;
  if(addBody)state.bulletinBody.push({id:makeId('body'),text:body,reference:context.reference});
  renderBulletin();record(before);bulletinPicker.close();
  const notice=$('bulletinAddedStatus'),added=[addBody?'주보 전체 글':'',merged.added?'새 질문 '+merged.added+'개':''].filter(Boolean);
  const receipt=++bulletinReceipt;
  const savedMessage=added.length?'추가: '+added.join(' · ')+'.':'이미 같은 내용이 있어요.';
  const currentReceipt=()=>receipt===bulletinReceipt&&passage?.id===context.chapter&&sync.account()===context.account&&!notice.hidden;
  notice.textContent=savedMessage+' 서버 저장을 확인하고 있어요.';
  notice.hidden=false;
  const report=()=>{
    if(!currentReceipt())return;
    const syncState=added.length&&!saveOK?'local-error':sync.chapterSyncState(context.chapter);
    notice.textContent=savedMessage+' '+(syncState==='confirmed'?'서버 저장을 확인했어요. 같은 계정의 다른 기기에서도 열 수 있어요.':
      syncState==='conflict'?'다른 기기와 수정이 겹쳤어요. 양쪽 기록은 그대로예요.':
      syncState==='local-error'||syncState==='missing'?'저장을 확인하지 못했어요. 이 창을 닫지 말아 주세요.':
      '이 기기에 저장했어요. 서버 저장은 아직 확인되지 않았어요.');
  };
  void sync.flush().then(report,report);
  requestAnimationFrame(()=>{
    const target=body?$('bulletinBodyItems').children[addBody?state.bulletinBody.length-1:bodyExisting]:$('bulletinItems').children[merged.first];
    target?.scrollIntoView({behavior:'instant',block:'start'});
  });
});
const recordsPicker=$('recordsPicker'),recordsList=$('recordsList'),recordsYear=$('recordsYear'),recordsEmpty=$('recordsEmpty');
const localDate=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
const localYear=new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'});
let recordEntries=[],showingTrash=false,pendingTrash=null;
const trashToggle=$('recordsTrashToggle'),trashConfirm=$('recordsTrashConfirm'),trashStatus=$('recordsTrashStatus');
function recordsNotice(message){trashStatus.textContent=message;trashStatus.hidden=!message;}
function cancelRecordTrash(){pendingTrash=null;trashConfirm.hidden=true;recordsList.inert=false;afterInteraction();}
function refreshOpenRecords(){
  const focus=document.activeElement;
  if(!recordsNeedRefresh||!recordsPicker.open||!syncReady||pendingTrash||activeSyncPointers.size||focus===recordsYear)return;
  const active=recordsList.contains(focus)?focus:null;
  const item=active?.closest('[data-record-id]');
  const id=item?.dataset.recordId, action=active?.dataset.recordAction, top=recordsPicker.scrollTop;
  refreshRecords();
  recordsPicker.scrollTop=top;
  if(id){
    const row=[...recordsList.children].find(el=>el.dataset.recordId===id);
    const next=[...(row?.querySelectorAll('[data-record-action]')??[])].find(el=>el.dataset.recordAction===action);
    (next&&!next.disabled?next:$('closeRecords')).focus({preventScroll:true});
  }
}
function refreshRecords(){
  recordsNeedRefresh=false;
  const year=recordsYear.value;
  try{recordEntries=Records.list(sync.viewStorage(),bible);}catch{recordEntries=[];}
  recordEntries=Records.withOpenings(recordEntries,localStorage,sync.account(),bible);
  const years=[...new Set(recordEntries.filter(item=>!item.trashedAt).map(recordYear).filter(Boolean))].sort((a,b)=>Number(b)-Number(a));
  recordsYear.replaceChildren(option('','전체'),...years.map(y=>option(y,y+'년')));
  if(years.includes(year))recordsYear.value=year;
  showRecords();
}
function moveRecord(item,toTrash){
  if(!syncReady||!sync.account())return;
  try{
    if(item.openedOnly){
      if(!Records.trashOpening(localStorage,sync.account(),item.id,bible,toTrash))throw Error('opening');
    }else{
      const saved=sync.read(item.id);
      if(!saved||Records.trashed(saved)===toTrash)throw Error('record');
      if(toTrash)saved.trashedAt=Date.now();
      else delete saved.trashedAt;
      sync.write(item.id,saved);
      if(passage.id===item.id){applyingRemote=true;try{load(passage,true);}finally{applyingRemote=false;}}
    }
    recordsNotice(toTrash?'휴지통으로 옮겼어요. 휴지통에서 복원할 수 있어요.':'내 기록으로 복원했어요.');
    refreshRecords();
    (showingTrash?trashToggle:(recordsList.querySelector('.record-item')||trashToggle)).focus();
  }catch{recordsNotice('변경하지 못했어요. 동기화 상태를 확인하고 다시 시도해 주세요.');refreshRecords();}
}
trashToggle.addEventListener('click',()=>{
  cancelRecordTrash();recordsNotice('');showingTrash=!showingTrash;
  trashToggle.setAttribute('aria-pressed',String(showingTrash));trashToggle.textContent=showingTrash?'내 기록으로 돌아가기':'휴지통';
  recordsYear.parentElement.hidden=showingTrash;refreshRecords();
});
$('recordsTrashCancel').addEventListener('click',()=>{cancelRecordTrash();trashToggle.focus();});
$('recordsTrashConfirmButton').addEventListener('click',()=>{
  const item=pendingTrash;cancelRecordTrash();if(item)moveRecord(item,true);
});
recordsPicker.addEventListener('close',cancelRecordTrash);
function recordYear(item){return item.updatedAt===null?'':localYear.format(item.updatedAt);}
function exportRecord(item){
  const feedback=$('recordPdfStatus');feedback.hidden=true;feedback.textContent='';
  const p=bible.byId(item.id);
  if(!p||!syncReady||!sync.account())return;
  let popup;
  try{
    popup=window.open('','_blank');
    if(!popup){feedback.textContent='PDF 미리보기를 열려면 이 사이트의 팝업을 허용해 주세요.';feedback.hidden=false;return;}
    const snapshot=sync.read(p.id);
    if(!item.openedOnly&&!snapshot)throw Error('missing_saved_record');
    const pdf=window.YeoRecordPDF,data=pdf.model(p,snapshot,bible,{Quotes,Order,Records});
    pdf.render(popup,data,item.updatedAt===null?'':localDate.format(item.updatedAt),TextMarks,new URL('record-print.css',location.href).href);
    popup.opener=null;
  }catch{
    popup?.close();
    feedback.textContent='이 기록의 PDF 미리보기를 열지 못했어요. 기존 기록은 그대로예요.';feedback.hidden=false;
  }
}
function openRecordBulletin(item){
  const chapter=bible.byId(item.id),account=sync.account();
  if(!chapter||!syncReady||!account)return;
  recordsPicker.close();navigateChapter(chapter);
  focusCurrentBulletin();
}
function focusCurrentBulletin(){
  const chapter=passage,account=sync.account();
  if(!chapter||!syncReady||!account)return;
  const tab=document.querySelector('button[data-page="scripture"]');
  if(tab?.getClientRects().length&&document.body.dataset.mobile!=='scripture')tab.click();
  requestAnimationFrame(()=>{
    if(!syncReady||passage?.id!==chapter.id||sync.account()!==account)return;
    const panel=$('bulletinPanel');
    if(panel.hidden)return;
    const heading=panel.querySelector('section:not([hidden]) h2');
    const pane=wideSpread.matches?scriptureReference:scroll;
    const outer=pane.getBoundingClientRect(),target=(heading||panel).getBoundingClientRect();
    const scale=outer.height/pane.offsetHeight||1;
    pane.scrollTop+=(target.top-outer.top)/scale-10;
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  });
}
$('showCurrentBulletin').addEventListener('click',focusCurrentBulletin);
function showRecords(){
  recordsList.replaceChildren();
  const entries=recordEntries.filter(item=>showingTrash?!!item.trashedAt:!item.trashedAt&&(!recordsYear.value||recordYear(item)===recordsYear.value));
  recordsEmpty.hidden=entries.length>0;
  recordsEmpty.textContent=showingTrash?'휴지통이 비어 있어요.':recordsYear.value?'이 연도에는 기록이 없어요.':'아직 저장된 기록이 없어요.';
  for(const item of entries){
    const li=document.createElement('li'),button=document.createElement('button'),title=document.createElement('strong'),meta=document.createElement('span');
    li.dataset.recordId=item.id;
    button.type='button';button.className='record-item';button.dataset.recordId=item.id;button.dataset.recordAction='open';title.textContent=item.customTitle||item.label;
    const hasBulletin=!!(item.bulletinBodyCount||item.bulletinQuestionCount);
    const kinds=item.openedOnly?['열어본 말씀']:[item.hasScripture?'본문 표시':'',hasBulletin?'주보':'',item.hasNotes?'나의 여백':''].filter(Boolean);
    meta.textContent=[...(item.customTitle?[item.label]:[]),...kinds,item.updatedAt===null?'날짜 미기록':localDate.format(item.updatedAt)].join(' · ');
    button.append(title,meta);
    if(item.snippet){const summary=document.createElement('span');summary.className='record-snippet';summary.textContent=item.snippet;button.append(summary);}
    button.addEventListener('click',()=>{
      recordsPicker.close();navigateChapter(bible.byId(item.id));if(item.hasNotes)showNotePage();
      else { const b=document.querySelector('button[data-page="scripture"]');if(b?.getClientRects().length&&document.body.dataset.mobile==='note')b.click(); }
      noteScroll().scrollTop=0;scroll.focus({preventScroll:true});
    });
    if(showingTrash){
      const restore=document.createElement('button');restore.type='button';restore.className='record-pdf';
      restore.dataset.recordAction='restore';
      restore.textContent='복원';restore.setAttribute('aria-label',(item.customTitle||item.label)+' 복원');
      restore.addEventListener('click',()=>moveRecord(item,false));
      button.disabled=true;li.append(button,restore);recordsList.append(li);continue;
    }
    const pdf=document.createElement('button');
    pdf.dataset.recordAction='pdf';
    pdf.type='button';pdf.className='record-pdf';pdf.textContent='PDF';pdf.setAttribute('aria-label',(item.customTitle?item.customTitle+' · ':'')+item.label+' PDF 내보내기');
    pdf.addEventListener('click',()=>exportRecord(item));
    const remove=document.createElement('button');
    remove.dataset.recordAction='trash';
    remove.type='button';remove.className='record-pdf record-remove';remove.textContent='삭제';
    remove.setAttribute('aria-label',(item.customTitle||item.label)+' 삭제');
    remove.addEventListener('click',()=>{
      pendingTrash=item;$('recordsTrashPrompt').textContent='‘'+(item.customTitle||item.label)+'’을 휴지통으로 옮길까요?';
      trashConfirm.hidden=false;recordsList.inert=true;$('recordsTrashCancel').focus();
    });
    const actions=document.createElement('div');actions.className='record-row-actions';
    if(hasBulletin){
      const bulletin=document.createElement('button');
      bulletin.type='button';bulletin.className='record-pdf';bulletin.dataset.recordAction='bulletin';
      bulletin.textContent='주보 보기';bulletin.setAttribute('aria-label',item.label+' 주보 보기');
      bulletin.addEventListener('click',()=>openRecordBulletin(item));actions.append(bulletin);
    }
    actions.append(pdf,remove);
    li.append(button,actions);recordsList.append(li);
  }
}
$('openRecords').addEventListener('click',()=>{
  cancel();finishTyping();
  $('recordPdfStatus').hidden=true;$('recordPdfStatus').textContent='';
  showingTrash=false;trashToggle.textContent='휴지통';trashToggle.setAttribute('aria-pressed','false');
  recordsYear.parentElement.hidden=false;recordsYear.value='';cancelRecordTrash();recordsNotice('');
  refreshRecords();recordsPicker.showModal();
});
$('closeRecords').addEventListener('click',()=>recordsPicker.close());
recordsYear.addEventListener('change',showRecords);
window.addEventListener('resize',()=>{geometry=[];paint();});scroll.addEventListener('scroll',()=>{if(draft)measure();});writingPaper.addEventListener('scroll',()=>{geometry=[];if(draft)measure();},{passive:true});$('scriptureReference').addEventListener('scroll',()=>{if(draft?.kind==='text')measure();},{passive:true});if(window.ResizeObserver){inkObserver=new ResizeObserver(()=>{geometry=[];paint();});inkObserver.observe(canvases.scripture);}
document.fonts?.ready.then(paint);
function syncOnLeave(){
  if(!syncReady||!state)return;
  if(!composing)finishTyping();
  persist();
  // Send a queued edit before common mobile tab suspensions when possible.
  // The device copy remains the fallback if this request cannot complete.
  if(!composing&&!draft&&sync.account())void sync.flush().catch(()=>{});
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)syncOnLeave();});
window.addEventListener('pagehide',syncOnLeave);
window.addEventListener('beforeunload',event=>{
  syncOnLeave();
  const unconfirmed=sync.entries().some(r=>r.storageError||r.dirty||r.pending||r.conflict);
  if(draft||composing||!saveOK||unconfirmed){event.preventDefault();event.returnValue='';}
});
window.CornellApp={sync,bible,prepareSync:()=>{cancel();finishTyping();},legacyState:s=>s?.version===1?{blocks:['note'],quotes:[],...Paper.fromLegacy(s)}:s,setTool,moreLines,undo:()=>history('undo'),redo:()=>history('redo'),getState:()=>clone(state),getPassage:()=>passage,save:()=>persist(),redraw:paint};
let updateView=null;
Object.assign(window.CornellApp,{
  canUpdate:()=>syncReady&&!applyingRemote&&!composing&&!draft&&!typingBefore&&!topicBefore&&!recordTitleBefore&&!bulletinBefore&&!activeSyncPointers.size&&
    !document.querySelector('dialog[open],.bulletin-body-editor:not([hidden])')&&!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'),
  flushForUpdate:()=>{persist();return saveOK?sync.flush():Promise.resolve({loggedIn:!!sync.account(),connected:false,localErrors:1});},
  captureUpdateView:()=>({account:sync.account(),chapter:passage.id,start:verseRange?.start,end:verseRange?.end,
    mobile:document.body.dataset.mobile,top:scroll.scrollTop,left:scroll.scrollLeft,reference:scriptureReference.scrollTop,writing:writingPaper.scrollTop,
    offsets:wideSpread.matches?null:window.CornellView?.captureOffsets(),zoom:window.CornellZoom?.scale()}),
  refreshFeedback:saveFeedback,
  showUpdateReceipt:(view,manual=false)=>{updateView={view,manual};if(syncReady)restoreUpdateView();}
});
function restoreUpdateView(){
  const receipt=updateView;updateView=null;
  const v=receipt?.view;
  if(!v||v.account!==sync.account())return;
  const restored=bible.byId(v.chapter);if(!restored)return;
  if(restored.id!==passage?.id)load(restored);
  const range=window.YeoBible.range(passage,v.start,v.end);
  verseRange=range&&!range.full?range:null;
  Bible.writeView(localStorage,sync.account(),passage,verseRange);
  renderVerseRange();
  if(v.mobile==='note')showNotePage();
  window.CornellView?.restoreOffsets(v.offsets);
  window.CornellZoom?.restoreScale(v.zoom);
  requestAnimationFrame(()=>{
    if(!syncReady||v.account!==sync.account()||v.chapter!==passage.id)return;
    for(const [el,prop,value] of [[scroll,'scrollTop',wideSpread.matches?0:v.top],[scroll,'scrollLeft',v.left],[scriptureReference,'scrollTop',v.reference],[writingPaper,'scrollTop',v.writing??v.top]])
      if(Number.isFinite(value))el[prop]=value;
    saveFeedback(receipt.manual?'기록을 저장하고 지금 위치에서 새로고침했어요.':'저장한 뒤 최신 버전으로 열었어요.');
  });
}
if(passage){load(passage);setTool('pen');setSyncLocked(true);}else status('성경 데이터를 불러오지 못했습니다.');
let connectAttempt=null,reconnectOnReturn=false,everConnected=false;
window.CornellApp.needsReconnect=()=>reconnectOnReturn&&!everConnected;
window.CornellApp.connectSync=()=>{
  if(connectAttempt)return connectAttempt;
  if(syncReady)return Promise.resolve(true);
  reconnectOnReturn=false;
  const reconnect=$('reconnectSync');if(reconnect){reconnect.disabled=true;reconnect.textContent='연결 중…';}
  connectAttempt=(async()=>{
    try{
      await sync.start();everConnected=true;syncReady=true;
      verseRange=Bible.readView(localStorage,sync.account(),passage);
      applyingRemote=true;try{load(passage);}finally{applyingRemote=false;}
      setSyncLocked(false);restoreUpdateView();return true;
    }catch(error){
      reconnectOnReturn=!everConnected&&!sync.account()&&
        (error instanceof TypeError||['network_error','storage_unavailable'].includes(error?.message));
      status(reconnectOnReturn?'연결을 기다리는 중 · 자동으로 다시 확인합니다':'로그인을 확인해 주세요 · 같은 계정으로 여백성경을 열어 주세요');setSyncLocked(true);return false;
    }finally{connectAttempt=null;if(reconnect){reconnect.disabled=false;reconnect.textContent='다시 연결';}}
  })();
  return connectAttempt;
};
})();
