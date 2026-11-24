const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const handlers={},captures=new Set(),log=[];let writing=true;
const surface={style:{touchAction:'pan-y',overscrollBehavior:''},addEventListener(n,f){handlers[n]=f},removeEventListener(n){delete handlers[n]},setPointerCapture(id){captures.add(id)},hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id)}};
const window={addEventListener(){},removeEventListener(){}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../client/gestures.js'),'utf8'),{window});
const destroy=window.CornellGestures.mount(surface,{canWrite:()=>writing,canStart:e=>!e.control,start:e=>log.push(['start',e.pointerId]),move:e=>log.push(['move',e.pointerId]),finish:e=>log.push(['finish',e.pointerId]),cancel:()=>log.push(['cancel']),scrollBy:y=>log.push(['scroll',y])});
function send(type,id,y=100,kind='touch',extra={}){let prevented=false;handlers[type]({type,pointerId:id,pointerType:kind,isPrimary:true,button:0,clientX:id*100,clientY:y,preventDefault(){prevented=true},...extra});return prevented;}
assert.equal(surface.style.touchAction,'none');send('pointerdown',1);assert.deepEqual(log,[['start',1]]);send('pointermove',1,90);send('pointerdown',2,90);assert.deepEqual(log.at(-1),['cancel']);send('pointermove',1,70);assert.deepEqual(log.at(-1),['scroll',10]);send('pointerup',2);let length=log.length;send('pointermove',1,60);assert.equal(log.length,length);send('pointerup',1);send('pointerdown',3);send('pointerup',3);assert.deepEqual(log.at(-1),['finish',3]);
send('pointerdown',4,0,'pen');send('pointercancel',4,0,'pen');assert.deepEqual(log.at(-1),['cancel']);send('pointerdown',5,0,'mouse');send('lostpointercapture',5,0,'mouse');assert.deepEqual(log.at(-1),['cancel']);
const penStart=log.length;
send('pointerdown',14,190,'pen');assert.equal(send('pointerdown',15,80),true);assert.equal(send('pointerdown',16,90),true);
send('pointermove',15,30);send('pointermove',16,40);send('pointermove',14,200,'pen');send('pointerup',14,210,'pen');send('pointerup',15);send('pointerup',16);
assert.deepEqual(log.slice(penStart),[['start',14],['move',14],['finish',14]]);
send('pointerdown',17,100);send('pointerdown',18,100);send('pointermove',18,80);assert.deepEqual(log.at(-1),['scroll',10]);
send('pointerup',18);send('pointerup',17);
length=log.length;assert.equal(send('pointerdown',6,0,'touch',{control:true}),false);assert.equal(log.length,length);
writing=false;destroy.sync();assert.equal(surface.style.touchAction,'pan-y');assert.equal(send('pointerdown',7),false);assert.equal(log.length,length);
writing=true;destroy.sync();send('pointerdown',8);writing=false;destroy.sync();assert.deepEqual(log.at(-1),['cancel']);assert.equal(captures.size,0);destroy();assert.equal(Object.keys(handlers).length,0);assert.equal(surface.style.touchAction,'pan-y');
console.log('PASS immediate draw, two-touch centroid pan/cancel, no resume, finish, pointercancel, lost capture, controls/native read, mode cleanup, destroy');
// Pinch callbacks batch per animation frame to avoid staggered finger samples.
{
  const listeners={},points=new Set(),frames=new Map(),calls=[];let frameId=0,cancels=0,starts=0;
  const win={addEventListener(){},removeEventListener(){},requestAnimationFrame(f){frames.set(++frameId,f);return frameId},cancelAnimationFrame(id){frames.delete(id)}};
  const area={style:{touchAction:'pan-y',overscrollBehavior:''},addEventListener(n,f){listeners[n]=f},removeEventListener(n){delete listeners[n]},setPointerCapture(id){points.add(id)},hasPointerCapture:id=>points.has(id),releasePointerCapture:id=>points.delete(id)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../client/gestures.js'),'utf8'),{window:win});
  const stop=win.CornellGestures.mount(area,{canWrite:()=>true,canStart:()=>true,start(){starts++},cancel(){cancels++},pinch:change=>calls.push(change),scrollBy(){throw Error('pinch must replace fallback scroll')}});
  function event(type,id,x,y){listeners[type]({type,pointerId:id,pointerType:'touch',clientX:x,clientY:y,preventDefault(){}})}
  function frame(){let callbacks=[...frames.values()];frames.clear();callbacks.forEach(f=>f())}
  event('pointerdown',1,0,0);event('pointerdown',2,200,0);assert.equal(cancels,1);
  // Even a large staggered parallel movement must remain a scale=1 pan.
  event('pointermove',1,30,120);event('pointermove',2,230,120);frame();
  assert.equal(calls.length,1);assert.equal(calls[0].scale,1);assert.equal(calls[0].fromX,100);assert.equal(calls[0].toX,130);assert.equal(calls[0].toY,120);
  event('pointermove',1,30,130);event('pointermove',2,235,132);frame();assert.equal(calls.at(-1).scale,1);
  // Cumulative 20% separation activates actual zoom, centered in client coords.
  event('pointermove',1,10,140);event('pointermove',2,250,140);frame();assert(Math.abs(calls.at(-1).scale-1.2)<1e-9);
  event('pointermove',1,-10,140);event('pointermove',2,270,140);frame();assert(Math.abs(calls.at(-1).scale-280/240)<1e-9);
  event('pointermove',1,10,140);event('pointermove',2,250,140);frame();assert(Math.abs(calls.at(-1).scale-240/280)<1e-9);
  event('pointerup',2,250,140);const count=calls.length;event('pointermove',1,10,200);frame();assert.equal(calls.length,count);assert.equal(starts,1);
  event('pointerup',1,10,200);event('pointerdown',3,20,20);assert.equal(starts,2);
  event('pointerdown',4,220,20);event('pointermove',4,240,20);assert.equal(frames.size,1);stop();assert.equal(frames.size,0);assert.equal(points.size,0);
  console.log('PASS pinch deadband, staggered parallel XY pan without zoom, cumulative activation, incremental in/out scale, no draw resume, queued-frame cleanup');
}

const test=require('node:test');
test('single finger pans a quote without editing; pad, stylus and pinch still work',()=>{
  const calls=[],listeners={},held=new Set();let writable=true;
  const area={style:{touchAction:'',overscrollBehavior:''},addEventListener:(n,f)=>{listeners[n]=f},
    removeEventListener:n=>{delete listeners[n]},setPointerCapture:id=>held.add(id),
    hasPointerCapture:id=>held.has(id),releasePointerCapture:id=>held.delete(id)};
  const stop=window.CornellGestures.mount(area,{
    canWrite:()=>writable,laneFor:e=>e.area==='bulletin'?'reference':e.area==='quote'||e.area==='pad'?'writing':null,canPan:e=>e.area==='bulletin'?'reference':e.area==='quote',canStart:e=>['quote','pad'].includes(e.area),
    start:e=>calls.push(['start',e.pointerId]),move:e=>calls.push(['move',e.pointerId]),
    finish:e=>calls.push(['finish',e.pointerId]),cancel:()=>calls.push(['cancel']),
    scrollBy:(dy,target)=>calls.push(target==='reference'?['ref',dy]:['scroll',dy]),pinch:change=>calls.push(['pinch',change.scale,change.toY,change.lane])
  });
  function fire(type,id,y,{area='quote',kind='touch',x=id*100}={}){
    let prevented=false;
    listeners['pointer'+type]({type:'pointer'+type,pointerId:id,pointerType:kind,area,button:0,isPrimary:true,clientX:x,clientY:y,preventDefault(){prevented=true}});
    return prevented;
  }
  // A tap or slight jitter over the quote never inks or scrolls.
  fire('down',1,100);fire('move',1,96);fire('up',1,96);assert.deepEqual(calls,[]);
  fire('down',2,100);fire('move',2,70);fire('move',2,80);fire('up',2,80);
  assert.deepEqual(calls.splice(0),[['scroll',30],['scroll',-10]]);
  fire('down',22,100,{area:'bulletin'});fire('move',22,71,{area:'bulletin'});fire('up',22,71,{area:'bulletin'});
  assert.deepEqual(calls.splice(0),[['ref',29]]);
  fire('down',3,100,{area:'pad'});fire('move',3,90,{area:'pad'});fire('up',3,90,{area:'pad'});
  fire('down',4,100,{kind:'pen'});fire('move',4,90,{kind:'pen'});fire('up',4,90,{kind:'pen'});
  assert.deepEqual(calls.splice(0),[['start',3],['move',3],['finish',3],['start',4],['move',4],['finish',4]]);
  fire('down',5,100);fire('down',6,100);fire('move',6,70);fire('up',6,70);fire('move',5,60);fire('up',5,60);
  assert.deepEqual(calls.splice(0),[['pinch',1,85,'writing']]);
  fire('down',15,100,{area:'bulletin'});fire('down',16,100,{area:'quote'});fire('move',16,70);fire('up',16,70);fire('up',15,100);
  assert.deepEqual(calls.splice(0),[['pinch',1,85,'reference']]);
  assert.equal(fire('down',7,100,{area:'control'}),false);assert.equal(held.size,0);
  fire('down',8,100);fire('cancel',8,100);fire('move',8,80);assert.deepEqual(calls,[]);
  fire('down',9,100);writable=false;stop.sync();assert.equal(held.size,0);
  assert.equal(fire('down',10,100),false);assert.equal(area.style.touchAction,'');assert.deepEqual(calls,[]);
  stop();
});
