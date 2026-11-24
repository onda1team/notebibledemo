(() => {
  const body=document.body, reader=document.getElementById('readerScroll');
  const pages=[...document.querySelectorAll('[data-page]')];
  const offsets={scripture:0,note:0};
  pages.forEach(b=>b.addEventListener('click',()=>{
    const page=b.dataset.page,from=body.dataset.mobile;
    if(page!==from) offsets[from]=reader.scrollTop;
    body.dataset.mobile=page;
    pages.forEach(el=>el.setAttribute('aria-pressed',String(el===b)));
    reader.scrollTop=offsets[page];
  }));
  window.CornellView={
    captureOffsets:()=>({...offsets,[body.dataset.mobile]:reader.scrollTop}),
    restoreOffsets:saved=>{
      for(const key of ['scripture','note'])if(Number.isFinite(saved?.[key])&&saved[key]>=0)offsets[key]=saved[key];
    }
  };
  const font=document.getElementById('fontSize'); let size=0;
  font.addEventListener('click',()=>{
    size=(size+1)%3;
    body.dataset.textSize=String(size);
    font.setAttribute('title',['기본 글자 크기','큰 글자','가장 큰 글자'][size]);
  });
  const guide=document.querySelector('.gesture-guide span:last-child'), small=matchMedia('(max-width:559px)');
  const compactLandscape=matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
  function updateGuide(){
    const mode=body.dataset.tool;
    const quoteSwipe=small.matches?body.dataset.mobile==='note':compactLandscape.matches;
    guide.textContent=mode==='read'?'읽기 모드 · 한 손가락으로 스크롤':mode==='type'?'키보드 모드 · 노트 칸을 눌러 입력':!small.matches?'왼쪽은 한 손가락으로 이동 · 오른쪽은 두 손가락으로 이동':quoteSwipe?'추가한 말씀 위에서 스크롤 · 빈 여백에 손글씨':'한 손가락으로 쓰기 · 두 손가락으로 이동·확대';
  }
  new MutationObserver(updateGuide).observe(body,{attributes:true,attributeFilter:['data-tool','data-mobile']});
  small.addEventListener('change',updateGuide);
  compactLandscape.addEventListener('change',updateGuide);
  updateGuide();
})();
