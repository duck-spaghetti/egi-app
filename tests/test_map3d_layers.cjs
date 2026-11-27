/** Transit and cycleways in 3D mode: same requests as the current map's layers, lines and stops drawn. */
const assert=require('node:assert/strict');const {environment,element}=require('./module_fixture.cjs');
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m||`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const calls=[];const responses={};
 const fetch=async(url,options={})=>{calls.push({url,body:options.body?JSON.parse(options.body):null});
  const key=Object.keys(responses).find(k=>url.startsWith(k));return {ok:true,json:async()=>responses[key]};};
 const frames=new Map();let frameId=0;const env=environment({fetch,requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
 const {TransportLayerGL}=await env.load('features/transport/layer-gl.js');
 const {TransportLayer}=await env.load('features/transport/layer.js');
 const {CycleLayerGL}=await env.load('features/cycleways/layer-gl.js');
 const {CycleLayer}=await env.load('features/cycleways/layer.js');
 const created={markers:[],popups:[]};
 class Marker{constructor(o){this.options=o;this.removed=false;created.markers.push(this);} setLngLat(l){this.lngLat=l;return this;} addTo(){return this;} remove(){this.removed=true;}}
 class Popup{constructor(o){this.options=o;created.popups.push(this);} setLngLat(l){this.lngLat=l;return this;} setHTML(h){this.html=h;return this;} addTo(){return this;} on(name,fn){(this.handlers||={})[name]=fn;} remove(){if(this.removed)return;this.removed=true;this.handlers?.close?.();}}
 const maplibre={Marker,Popup};
 function fakeMap(){
  const container=element();container.style.setProperty=function(k,v){this[k]=String(v);};container.clientWidth=800;container.clientHeight=600;
  const bounds={getWest:()=>12.45,getSouth:()=>41.88,getEast:()=>12.52,getNorth:()=>41.92};
  return {container,sources:{},layers:[],handlers:[],zoom:14.4,
   getContainer(){return container;},getBounds(){return bounds;},getZoom(){return this.zoom;},isStyleLoaded:()=>true,
   getStyle(){return {layers:[{id:'background',type:'background'},{id:'water-label',type:'symbol'}]};},
   addSource(id,s){this.sources[id]={...s,setData(d){this.data=d;}};},getSource(id){return this.sources[id];},removeSource(id){delete this.sources[id];},
   addLayer(l,before){this.layers.push({...l,before});},getLayer(id){return this.layers.find(l=>l.id===id);},removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id);},
   on(...args){this.handlers.push(args);},once(){},off(){},fitBounds(b){this.fitted=b;}};
 }
 // Transit: same viewport query as the current map, at the Leaflet-equivalent zoom.
 assert.equal(TransportLayerGL.leafletZoom({getZoom:()=>19}),19,'maximum camera zoom stays within API bounds');
 assert.equal(TransportLayer.pointDetail({transport_type:'metro'},18),true);assert.equal(TransportLayer.pointDetail({transport_type:'bus'},18),false);assert.equal(TransportLayer.pointDetail({transport_type:'tram'},18),false);assert.equal(TransportLayer.pointDetail({transport_type:'bus'},19),true);
 const map=fakeMap();const toggle=element();const status=element();
 const line={type:'Feature',geometry:{type:'LineString',coordinates:[[12.46,41.89],[12.5,41.9]]},properties:{transport_type:'metro',color:'#e27439',route_id:'MA',code:'A',name:'Metro A'}};
 const rail={type:'Feature',geometry:{type:'LineString',coordinates:[[12.46,41.89],[12.5,41.9]]},properties:{transport_type:'rail',route_id:'FL1',code:'FL1'}};
 const stop={type:'Feature',geometry:{type:'Point',coordinates:[12.49,41.9]},properties:{kind:'station',transport_type:'metro',name:'Termini',stop_ids:['s1'],routes:[{route_id:'MA',display_code:'A',mode:'metro',color:'#e27439'}]}};
 responses['/api/preview/transport']={availability:'available',features:[line,rail,stop],service_date:'2026-11-26',refresh:{},manifest:{}};
 responses['/api/preview/transit/departures']={availability:'available',departures:[{code:'A',mode:'metro',color:'#e27439',route_id:'MA',headsign:'Battistini',times:[{time:'15:00',in_min:3}]}],alerts:[],now:'14:57'};
 const transit=TransportLayerGL.create(map,{toggle,status},maplibre);
 assert.equal(map.layers.length,2);assert(map.layers.every(l=>l.before==='water-label'),'lines under the labels');
 toggle.click();await wait(250);
 const request=calls.find(c=>c.url==='/api/preview/transport');
 const expected=TransportLayer.viewportQuery({x:800,y:600},map.getBounds(),15,new Set(['metro','rail','tram','bus']));
 same(request.body,{...Object.fromEntries(expected),west:12.45,south:41.88,east:12.52,north:41.92,zoom:15});
 const drawn=map.sources['egi-transport-lines'].data.features;
 assert.equal(drawn.length,2);assert.equal(drawn[0].properties._color,'#e27439');assert.equal(drawn[1].properties._dashed,true);
 const stops=created.markers.filter(m=>!m.removed);assert.equal(stops.length,1);
 assert.equal(stops[0].options.element.innerHTML,TransportLayer.stopIconHtml(stop.properties,false));
 same(stops[0].lngLat,[12.49,41.9]);assert.match(status.textContent,/Rete programmata per 2026-11-26/);
 // A stop opens a popup with the same content, then its departures.
 stops[0].options.element.click();await wait(20);
 const popup=created.popups.at(-1);assert.match(popup.html,/Battistini/);
 assert(calls.some(c=>c.url.startsWith('/api/preview/transit/departures?stops=s1')));
 // Focus on lines: chip, fit, label marker; dispose removes layers, source and markers.
 await transit.reload(); // Hold a fresh response behind the open popup.
 transit.focus({routeIds:['MA'],label:'Linea A',points:[[41.9,12.49],[41.91,12.5]]});
 assert.equal(transit.focusedRoutes()[0],'MA');assert(map.fitted);
 transit.dispose();assert.equal(frames.size,0,"popup teardown with held data must not queue name work");assert.equal(map.layers.length,0);assert.equal(map.sources['egi-transport-lines'],undefined);
 assert.equal(created.markers.filter(m=>!m.removed).length,0);
 const individual={...stop,id:'stop:platform-a',geometry:{type:'Point',coordinates:[12.4902,41.9001]},properties:{...stop.properties,kind:'stop',stop_id:'platform-a',stop_ids:undefined}};responses['/api/preview/transport']={...responses['/api/preview/transport'],features:[line,individual]};
 const highMap=fakeMap();highMap.zoom=17.4;const second=TransportLayerGL.create(highMap,{},maplibre);second.setVisible(true);await second.reload();
 const highStop=created.markers.filter(m=>!m.removed).at(-1);
 const count=created.markers.length,requests=calls.length;highMap.zoom=17.75;highMap.handlers.find(h=>h[0]==='zoom')[1]();assert.equal(highMap.container.style['--tl-metro-progress'],'0.75');assert.equal(created.markers.length,count,'continuous zoom does not rebuild markers');assert.equal(calls.length,requests,'continuous zoom does not fetch');
 assert(highStop.options.element.innerHTML.includes('tl-ground'));assert(highStop.options.element.innerHTML.includes('tl-palina-metro')); assert(highStop.options.element.className.includes('tl-point-detail'));same(highStop.lngLat,individual.geometry.coordinates,'ground anchor keeps source coordinates');
 created.markers.filter(m=>!m.removed).at(-1).options.element.click();await wait(20);assert(calls.filter(c=>c.url.startsWith('/api/preview/transit/departures?')).at(-1).url.includes('stops=platform-a'),'individual platform requests its own departures');second.dispose();assert.equal(frames.size,0,'popup teardown without held data must not queue name work');
 // Cycleways: same body as the current map's layer, features drawn, same status text.
 const cmap=fakeMap();cmap.zoom=13.2;const ctoggle=element(),cstatus=element();
 const way={type:'Feature',geometry:{type:'LineString',coordinates:[[12.46,41.89],[12.5,41.9]]},properties:{kind:'track',label:'Pista su carreggiata',name:'Tevere'}};
 responses['/api/preview/cycleways']={availability:'available',min_zoom:12,features:[way],osm_base:'2026-11-08T00:00:00Z'};
 const cycle=CycleLayerGL.create(cmap,{toggle:ctoggle,status:cstatus},maplibre);
 assert.equal(cmap.layers.length,5);same(cmap.layers.find(l=>l.id==='egi-cycleways-track').paint['line-dasharray'],[8/3.5,4/3.5]);
 ctoggle.click();await wait(260);
 same(calls.filter(c=>c.url==='/api/preview/cycleways').at(-1).body,{west:12.45,south:41.88,east:12.52,north:41.92,zoom:14});
 same(cmap.sources['egi-cycleways'].data.features,[way]);
 assert.equal(cstatus.textContent,CycleLayer.statusText(responses['/api/preview/cycleways'],14));
 cycle.dispose();assert.equal(cmap.layers.length,0);
 console.log('PASS: transit and cycleways on MapLibre: same requests, lines, stops, popups, departures, focus, dispose');
})().catch(error=>{console.error(error);process.exitCode=1;});
