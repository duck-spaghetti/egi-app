/** 3D mode on the page seam with a fake MapLibre: markers, selection, reference pick, dispose, view switch. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
function fakeMapLibre(zoom=16){
 const created={maps:[],markers:[],protocols:[]};
 class Map{constructor(options){this.options=options;this.handlers={};this.controls=[];this.zoom=zoom;this.removed=false;this.bearing=0;this.pitch=0;created.maps.push(this);}
  on(name,fn){(this.handlers[name]||=[]).push(fn);} once(name,fn){this.on(name,fn);} off(){}
  fire(name,event={}){(this.handlers[name]||[]).forEach(fn=>fn(event));}
  addControl(control,position){this.controls.push({control,position,element:control.onAdd?.(this)});}
  getZoom(){return this.zoom;} getBearing(){return this.bearing;} getPitch(){return this.pitch;}
  setBearing(b){this.bearing=b;} rotateTo(b){this.bearing=b;} jumpTo(o){this.last=o;if(o.pitch!==undefined)this.pitch=o.pitch;} easeTo(o){this.jumpTo(o);}
  addSource(){} project([lng,lat]){return {x:lng*1000,y:-lat*1000};} resize(){this.resized=true;} remove(){this.removed=true;}}
 class Marker{constructor(options){this.options=options;this.removed=false;created.markers.push(this);}
  setLngLat(ll){this.lngLat=ll;return this;} addTo(map){this.map=map;return this;} remove(){this.removed=true;} getElement(){return this.options.element;}}
 class NavigationControl{constructor(options){this.options=options;} onAdd(){return {};}}
 return {lib:{Map,Marker,NavigationControl,addProtocol:(name,fn)=>created.protocols.push(name)},created};
}
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m||`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const live=c=>c.markers.filter(m=>!m.removed&&m.options.element.children?.[0]);
(async()=>{
 const env=environment({matchMedia:()=>({matches:false})});
 const {createMap3d}=await env.load('features/map3d/index.js');
 const {createMap}=await env.load('features/map/index.js');
 const {viewMode,saveHandoff,takeHandoff,applyHandoff,switchUrl,hasWebGL2}=await env.load('features/map/view.js');
 const {isMapLibre,inertLayer}=await env.load('features/map/engine.js');
 const context={map3d:{base:'/map3d/20261126T120000Z',version:'20261126T120000Z'},latitude:41.9,longitude:12.5,zoom:12,
  boundsWest:12.2,boundsSouth:41.6,boundsEast:12.9,boundsNorth:42.2};
 const cat={slug:'mangiare',label:'Mangiare',color:'#f00'};
 const pois=[{id:1,cat,latitude:41.90,longitude:12.50,title:'A'},{id:2,cat,latitude:41.90,longitude:12.50,title:'A'},
  {id:3,cat,latitude:41.902,longitude:12.502,title:"B"},{id:4,cat,latitude:41.95,longitude:12.40,title:'C'}];
 const key=p=>`${p.latitude}:${p.longitude}`;
 const sites={groups:list=>{const g=new Map();list.forEach(p=>{if(!g.has(key(p)))g.set(key(p),[]);g.get(key(p)).push(p);});return [...g.values()];},
  siblings:poi=>pois.filter(p=>key(p)===key(poi))};
 const describe=p=>({category:p.cat});
 // Same sites and counts as the current module for the same list.
 const leafletMarkers=[];const L={latLngBounds:()=>({contains:()=>true}),latLng:()=>({}),divIcon:o=>o,
  map:()=>({setView(){return this;},attributionControl:{setPrefix(){}},getBoundsZoom:()=>10,setMinZoom(){},on(){},setMaxBounds(){},panInsideBounds(){},hasLayer:()=>true,addLayer(){},remove(){}}),
  tileLayer:()=>({addTo(){}}),layerGroup:()=>({clearLayers(){leafletMarkers.length=0;},addTo(){},addLayer(m){leafletMarkers.push(m);}}),
  marker:(ll,o)=>({ll,o,on(){},addTo(){return this;}})};
 const flat=createMap({context,sites,describe,emit(){},leaflet:L});flat.mount();flat.update({},pois);
 const events=[];const {lib,created}=fakeMapLibre(16);
 const map=createMap3d({context,sites,describe,emit:(type,payload)=>events.push([type,payload]),maplibre:lib,pmtiles:{Protocol:class{tile(){}}},origin:'http://localhost',reduceMotion:true});
 map.mount();const gl=created.maps[0];
 same(created.protocols,['pmtiles']);
 assert.equal(gl.options.style.sources.basemap.url,'pmtiles://http://localhost/map3d/20261126T120000Z/basemap.pmtiles');
 assert.equal(gl.options.pixelRatio<=2,true);assert.equal(gl.options.touchPitch,false);assert.equal(gl.options.renderWorldCopies,false);
 same(gl.options.maxBounds,[[12.2,41.6],[12.9,42.2]]);
 map.update({},pois);
 const pins=live(created);
 assert.equal(pins.length,leafletMarkers.length);assert.equal(pins.length,3);
 same(pins.map(m=>m.getElement().children[0].title).sort(),leafletMarkers.map(m=>m.o.title).sort());
 assert.match(pins[0].getElement().children[0].innerHTML,/site-pin/);
 // Selection opens the existing sheet: the same "choose" payload as the current map.
 const first=pins.find(m=>/^A:/.test(m.getElement().children[0].title));
 first.getElement().children[0].click();
 assert.equal(events.at(-1)[0],'choose');assert.equal(events.at(-1)[1].items.length,2);same([...events.at(-1)[1].matched],[1,2,3,4]);
 // Re-render keeps the same marker elements (focus survives moves).
 const before=pins.map(m=>m.getElement());gl.fire('moveend');same(live(created).map(m=>m.getElement()),before);
 // Clustering below z15: nearby sites merge into one button.
 gl.zoom=12;gl.fire('moveend');const clusters=live(created).filter(m=>m.getElement().children[0].className==='map3d-cluster');
 assert.equal(clusters.length,1);assert.equal(clusters[0].getElement().children[0].textContent,'2');
 gl.zoom=16;gl.fire('moveend');
 // Reference pick emits the same event as the current map, only while choosing.
 gl.fire('click',{lngLat:{lat:41.9,lng:12.5}});assert.notEqual(events.at(-1)[0],'pickedReference');
 map.update({choosingReference:true},pois);gl.fire('click',{lngLat:{lat:41.91,lng:12.52}});
 same(events.at(-1),['pickedReference',{lat:41.91,lng:12.52,label:'Punto scelto sulla mappa'}]);
 map.update({userLoc:{lat:41.9,lng:12.5}},pois);assert(created.markers.some(m=>!m.removed&&/user-dot/.test(m.getElement().innerHTML)));
 // Controls: rotation and tilt only by explicit buttons.
 const box=gl.controls[1].element;assert.equal(box.children.length,3);
 box.children[1].click();assert.equal(gl.bearing,30);box.children[2].click();assert.equal(gl.pitch,55);
 // Interface parity.
 assert.equal(map.contains(41.9,12.5),true);assert.equal(map.contains(45,9),false);
 map.center(41.9,12.5);same(gl.last.center,[12.5,41.9]);
 map.servicesVisible(false);assert.equal(live(created).filter(m=>m.getElement().children[0]?.className==='map3d-pin').length,0);
 map.servicesVisible(true);assert.equal(isMapLibre(gl),true);assert.equal(map.attach(m=>m),gl);
 map.invalidate();assert.equal(gl.resized,true);
 map.dispose();assert.equal(gl.removed,true);assert.equal(created.markers.filter(m=>!m.removed).length,0);
 assert.equal(isMapLibre({addSource(){},getPane(){}}),false);assert.equal(inertLayer().focusedRoutes(),null);
 // View choice: URL, device memory, WebGL2 and data availability.
 const store=new Map();const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 same(viewMode({search:'?vista=3d',storage,context,webgl2:true}),{mode:'3d',available:true,reason:null});
 same(viewMode({search:'?vista=3d',storage,context,webgl2:false}),{mode:'2d',available:false,reason:'webgl'});
 same(viewMode({search:'',storage,context:{map3d:null},webgl2:true}),{mode:'2d',available:false,reason:'data'});
 storage.setItem('egi.map.view','3d');assert.equal(viewMode({search:'',storage,context,webgl2:true}).mode,'3d');
 assert.equal(viewMode({search:'?vista=2d',storage,context,webgl2:true}).mode,'2d');
 assert.equal(hasWebGL2({createElement:()=>({getContext:()=>null})}),false);
 const state={filters:{cats:new Set(['mangiare']),offersOff:new Set(),q:'doccia vicino casa',openNow:true,section:'all'},userLoc:{lat:41.9,lng:12.5,label:'Via X 1'}};
 saveHandoff({local:storage,session:storage},'3d',state);
 const url=switchUrl({pathname:'/map',search:'?city_id=1&lang=fr&q=x'},{view:'3d',lang:'fr',service:'abc'});
 assert.equal(url,'/map?city_id=1&lang=fr&vista=3d&servizio=abc');
 assert.doesNotMatch(url,/doccia|41\.9|12\.5|Via/);
 const restored={filters:{cats:new Set(),offersOff:new Set(),q:'',openNow:false,section:'x'},userLoc:null};
 applyHandoff(restored,takeHandoff(storage));
 same([...restored.filters.cats],['mangiare']);assert.equal(restored.filters.q,'doccia vicino casa');
 same(restored.userLoc,{lat:41.9,lng:12.5,label:'Via X 1'});
 assert.equal(takeHandoff(storage),null,'the handoff is read once');
 console.log('PASS: 3D map module parity (sites, choose, reference, clusters, controls, dispose) and view switch/handoff');
})().catch(error=>{console.error(error);process.exitCode=1;});
