/** The actual renderer must avoid creating/reformatting hundreds of offscreen service buttons on a pan. */
const assert=require('node:assert/strict');const {performance}=require('node:perf_hooks');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const env=environment(),{createMap3d}=await env.load('features/map3d/index.js');
 const {createSites}=await env.load('features/map/sites.js');let gl,described=0;const markers=[];
 const container={clientWidth:1280,clientHeight:720};
 class Map {constructor(){gl=this;this.handlers={};}on(k,f){(this.handlers[k]||=[]).push(f);}fire(k){for(const f of this.handlers[k]||[])f();}addControl(c){c.onAdd?.(this);}getPitch(){return 45;}getZoom(){return 17;}project([x,y]){return {x:640+(x-12.5)*30000,y:360+(y-41.9)*30000};}getContainer(){return container;}remove(){} }
 class Marker {constructor(o){this.o=o;markers.push(this);}setLngLat(){return this;}addTo(){return this;}remove(){this.removed=true;}getElement(){return this.o.element;} }
 const pois=Array.from({length:600},(_,i)=>({id:i,title:'Service '+i,longitude:12.2+i%30*.02,latitude:41.7+Math.floor(i/30)*.02}));
 const state={pois},sites=createSites({context:{canonical:true},snapshot:()=>state});
 const map=createMap3d({context:{longitude:12.5,latitude:41.9,map3d:{base:'/map3d/test'},boundsWest:12.2,boundsEast:12.9,boundsSouth:41.6,boundsNorth:42.2},sites,describe:p=>{described++;return {title:p.title,kind:p.kind||'Service type',category:{slug:'a',label:'A'},status:p.status||{kind:'unknown',label:'Unknown'}};},emit(){},maplibre:{Map,Marker,NavigationControl:class{}},reduceMotion:true});
 map.mount();map.update(state,pois);described=0;const timings=[];
 for(let i=0;i<20;i++){const start=performance.now();gl.fire('moveend');timings.push(performance.now()-start);}
 const result={markers:map.markerCount(),describedOnPan:described,p50:timings.sort((a,b)=>a-b)[10]};console.log(JSON.stringify(result));
 if(!process.argv.includes('--baseline')){assert(map.markerCount()<30,'only viewport service markers should be mounted');assert.equal(described,0,'camera moves reuse formatted service data');}
 const crowded=[{id:'c',title:'Centre',longitude:12.5,latitude:41.9},{id:'l',title:'Left',longitude:12.4967,latitude:41.9},{id:'r',title:'Right',longitude:12.5033,latitude:41.9}];
 state.pois=crowded;map.update(state,crowded);
 const centre=markers.filter(m=>!m.removed).map(m=>m.getElement().children[0]).find(b=>b?.title?.startsWith('Centre:'));
 assert.equal(centre.dataset.labelled,'false','a label must not cover another service button');
 assert.equal(map.markerCount(),3,'collision suppression preserves every service button');
 const room=[{id:'c',title:'Centre',longitude:12.5,latitude:41.9},{id:'l',title:'Left',longitude:12.4927,latitude:41.9},{id:'r',title:'Right',longitude:12.5073,latitude:41.9}];
 state.pois=room;map.update(state,room);
 const narrow=markers.filter(m=>!m.removed).map(m=>m.getElement().children[0]).find(b=>b?.title?.startsWith('Centre:'));
 assert.equal(narrow.dataset.labelled,'true','a narrow head fits before information is suppressed');
 const shared=[{id:'a',title:'Matched A',kind:'Kind A',longitude:12.5,latitude:41.9,status:{kind:'open',label:'Open A'}},{id:'b',title:'Selected B',kind:'Kind B',longitude:12.5,latitude:41.9,status:{kind:'closed',label:'Closed B'}}];state.pois=shared;
 map.update({pois:shared,selectedId:'b'},[shared[0]]);
 const chosen=markers.filter(m=>!m.removed).map(m=>m.getElement().children[0]).find(b=>b?.className==='map3d-pin');
 assert(chosen.innerHTML.includes('Kind B'));assert(!chosen.innerHTML.includes('Kind A'));assert(chosen.innerHTML.includes('Closed B'));assert(!chosen.innerHTML.includes('Open A'),'selected filtered-out service keeps its own status');
 container.clientWidth=390;gl.project=([x,y])=>({x:195+(x-12.5)*30000,y:422+(y-41.9)*30000});
 state.pois=[shared[1]];map.update({pois:state.pois,selectedId:'b'},state.pois);
 const mobile=markers.filter(m=>!m.removed).map(m=>m.getElement().children[0]).find(b=>b?.className==='map3d-pin');
 assert.equal(mobile.dataset.labelled,'true','mobile-centred service label fits beside the anchor');// At this Y the head is below both tool rails; either side can fit.
 env.document.documentElement.dir='rtl';map.update({pois:state.pois,selectedId:'b'},state.pois);
 assert.equal(mobile.dataset.labelled,'true');// Control collision geometry is covered by the shared planner tests.
 const adjacent=[{id:'near-a',title:'Via Uno 10',longitude:12.5,latitude:41.9},{id:'near-b',title:'Via Uno 12',longitude:12.50001,latitude:41.9}];
 state.pois=adjacent;map.update(state,adjacent);const nearButtons=markers.filter(m=>!m.removed).map(m=>m.getElement().children[0]);assert.equal(nearButtons.length,2);assert(nearButtons.some(b=>/L-?56 /.test(b.innerHTML)),'close separate sites get an inclined leader');assert.equal(adjacent[1].longitude,12.50001,'head separation preserves source coordinates');
 map.dispose();
})().catch(e=>{console.error(e);process.exitCode=1;});
