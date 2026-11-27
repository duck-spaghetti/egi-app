/** Gesture behavior at the existing map seam: stable nodes, anchors, coalescing and teardown. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
(async()=>{
 const frames=new Map();let id=0,gl,writes=0,described=0;
 const env=environment(),createElement=env.document.createElement;
 env.document.createElement=()=>{
  const el=createElement(),path=createElement();let html='';
  el.style.setProperty=(name,value)=>el.style[name]=value;
  el.querySelector=()=>path;
  Object.defineProperty(el,'innerHTML',{get:()=>html,set:value=>{writes++;html=value;}});
  return el;
 };
 const markers=[],events=[];
 class MapLibre{
  constructor(){gl=this;this.zoom=17;this.handlers={};}
  on(k,f){(this.handlers[k]||=[]).push(f);}off(k,f){this.handlers[k]=(this.handlers[k]||[]).filter(h=>h!==f);}
  fire(k){for(const f of this.handlers[k]||[])f();}addControl(c){c.onAdd?.(this);}
  getPitch(){return 45;}getZoom(){return this.zoom;}
  project([x,y]){return {x:600+(x-12.5)*30000,y:400+(y-41.9)*30000};}
  getContainer(){return {clientWidth:1280,clientHeight:800};}remove(){}
 }
 class Marker{
  constructor(o){this.o=o;markers.push(this);}setLngLat(ll){this.ll=ll;return this;}
  addTo(){return this;}remove(){this.removed=true;}getElement(){return this.o.element;}
 }
 const {createMap3d}=await env.load('features/map3d/index.js');
 const {createSites}=await env.load('features/map/sites.js');
 const rows=[0,1,2].map(i=>({id:String(i),title:`Civic ${10+i*2}`,longitude:12.5+i*.00001,latitude:41.9}));
 const state={pois:rows,selectedId:'0'},sites=createSites({context:{canonical:true},snapshot:()=>state});
 const map=createMap3d({context:{longitude:12.5,latitude:41.9,map3d:{base:'/map3d/test'}},sites,
  describe:p=>{described++;return {title:p.title,category:{slug:'test',label:'Test'},status:{kind:'open',label:'Open'}};},
  emit:(...args)=>events.push(args),maplibre:{Map:MapLibre,Marker,NavigationControl:class{}},reduceMotion:true,
  frame:fn=>{frames.set(++id,fn);return id;},cancelFrame:id=>frames.delete(id)});
 map.mount();map.update(state,rows);
 const original=markers.filter(m=>!m.removed),buttons=original.map(m=>m.getElement().children[0]);
 const shifted=buttons.find(b=>Math.abs(parseFloat(b.style['--site-head-x']))>0);assert(shifted);
 const offset=()=>parseFloat(shifted.style['--site-head-x']),initial=offset();
 const flush=()=>gl.fire('render');
 const htmlWrites=writes,descriptions=described;
 gl.zoom=16.75;gl.fire('move');gl.zoom=16.5;gl.fire('move');assert.equal(writes,htmlWrites,'camera events defer writes to the map render frame');
 flush();assert.equal(offset(),initial,'do not shorten a necessary separation into a collision');
 assert.equal(Number(shifted.querySelector().attributes.d.split('L')[1].split(' ')[0]),offset(),'leader endpoint moves with head');
 gl.project=([x,y])=>({x:600-(x-12.5)*30000,y:400+(y-41.9)*30000});gl.fire('move');flush();
 assert.equal(writes,htmlWrites,'rotation placement must not replace pin content');
 gl.zoom=17;gl.fire('move');flush();
 assert.equal(writes,htmlWrites,'zoom must not replace labels or pin content');assert.equal(described,descriptions,'zoom must not reformat services');
 original.forEach((m,i)=>assert.deepEqual(Array.from(m.ll),[rows[i].longitude,rows[i].latitude],'feet preserve exact source anchors'));
 assert.deepEqual(markers.filter(m=>!m.removed),original,'gesture keeps the same focusable marker nodes');
 gl.zoom=13.9;gl.fire('move');flush();assert.equal(offset(),0);assert.equal(shifted.dataset.anchored,'false');
 gl.zoom=17;gl.fire('move');gl.fire('moveend');assert.equal(frames.size,0,'settled layout cancels pending gesture work');
 buttons[0].click();assert.equal(events.at(-1)[0],'choose');
 for(let i=0;i<20;i++){gl.fire('move');assert.equal(frames.size,0,'layout uses the map render frame, not a second RAF');map.servicesVisible(false);assert.equal(frames.size,0);map.servicesVisible(true);assert.equal(map.markerCount(),3);}
 gl.fire('move');assert.equal(frames.size,0,'layout uses the map render frame, not a second RAF');map.dispose();assert.equal(frames.size,0);
 gl.fire('move');assert.equal(frames.size,0,'disposed map never schedules late work');
 console.log('PASS: adaptive camera layout preserves separation, markup, anchor, identity and lifecycle ownership');
})().catch(e=>{console.error(e);process.exitCode=1;});
