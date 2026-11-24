(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YeoPaper = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const BASE_NOTE_HEIGHT = 576, EXTRA_NOTE_HEIGHT = 256;
  const list = value => Array.isArray(value) ? value : [];
  const string = value => typeof value === 'string' ? value : '';
  function fromLegacy(old) {
    if (!old || old.version !== 1) return null;
    const bodyHeight = Number.isFinite(old.notesHeight) && old.notesHeight >= BASE_NOTE_HEIGHT ? old.notesHeight : BASE_NOTE_HEIGHT;
    const hasSummary = !!string(old.text?.summary) || list(old.ink?.summary).length > 0;
    const hasCue = !!string(old.text?.cue) || list(old.ink?.cue).length > 0;
    const notesHeight = bodyHeight + (hasSummary ? 192 : 0);
    const move = (key, offset, span, top, height) => list(old.ink?.[key])
      .filter(s => s && Array.isArray(s.points) && s.points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)))
      .map(s => ({ ...s, points:s.points.map(p => ({ x:offset + p.x*span, y:(top + p.y*height)/notesHeight })) }));
    return {
      version:2, notesHeight,
      ink:{scripture:list(old.ink?.scripture), note:[
        ...move('cue',0,.29,0,bodyHeight),
        ...move('main',hasCue?.29:0,hasCue?.71:1,0,bodyHeight),
        ...move('summary',0,1,bodyHeight+32,160),
      ]},
      text:{note:['cue','main','summary'].map(k => string(old.text?.[k])).filter(Boolean).join('\n\n')},
      highlights:list(old.highlights),
    };
  }
  const style=value => value === 'blank' ? 'blank' : 'ruled';
  const mode=(paper,tool) => tool === 'type' ? 'type' : style(paper);
  const resize=(height,needed,direction) => direction>0 ? height+EXTRA_NOTE_HEIGHT : Math.min(height,Math.max(128,needed,height-EXTRA_NOTE_HEIGHT));
  const dragHeight=(start,delta,scale,needed,minimum=64) => {
    const safeScale=Number.isFinite(scale)&&scale>0?scale:1;
    return Math.min(Math.max(start,8192,needed), Math.max(minimum,needed,Math.round(start+delta/safeScale)));
  };
  return {BASE_NOTE_HEIGHT,EXTRA_NOTE_HEIGHT,fromLegacy,style,mode,resize,dragHeight};
});
