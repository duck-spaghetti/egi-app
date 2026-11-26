import {siteMarkers,USER_DOT_HTML,USER_DOT_LABEL} from "../map/pins.js";
import {egiStyle,liftBridgeLabels} from "./style.js";
/** createMap3d: the 3D mode's map module, on MapLibre GL JS, with the current map's interface.
 *
 * mount, update(snapshot, list), attach(factory), center, contains, invalidate,
 * servicesVisible and dispose behave as in features/map/index.js. Services are upright,
 * keyboard-focusable HTML markers from the shared pin markup and site grouping; at
 * zoom < CLUSTER_MAX_ZOOM sites closer than CLUSTER_PX on screen form one cluster button.
 * Rotation by buttons, compass reset and keyboard; tilt only by its own control;
 * reduced motion respected. maplibre is the vendored module, pmtiles the reader
 * (both injected, so tests can pass fakes).
 */
const PROTOCOLS = new WeakSet(); // MapLibre instances with the pmtiles protocol registered
export const CLUSTER_PX = 48, CLUSTER_MAX_ZOOM = 15, TILT = 55, ROTATE_STEP = 30;

export function createMap3d({context,sites,describe,emit,maplibre,pmtiles,translate=(key,params,fallback)=>fallback||key,
  reduceMotion=Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  devicePixelRatio=globalThis.devicePixelRatio||1,origin=globalThis.location?.origin||""}) {
 let state={},list=[],visible=true,disposed=false;
 const runtime={map:null,markers:new Map(),user:null,bounds:null,cleanups:[]};
 const t=(key,fallback)=>translate(key,{},fallback);
 const bounds=()=>[[Number(context.boundsWest),Number(context.boundsSouth)],[Number(context.boundsEast),Number(context.boundsNorth)]];
 const move=options=>reduceMotion?runtime.map.jumpTo(options):runtime.map.easeTo({duration:500,...options});

 function mount() {
  if(runtime.map||disposed)return;
  const base=new URL(context.map3d.base,origin||"http://localhost").href;
  if(pmtiles&&!PROTOCOLS.has(maplibre)){maplibre.addProtocol("pmtiles",new pmtiles.Protocol().tile);PROTOCOLS.add(maplibre);}
  runtime.bounds=bounds();
  const map=runtime.map=new maplibre.Map({
   container:"map",style:egiStyle(base),
   center:[Number(context.longitude),Number(context.latitude)],zoom:Math.max(Number(context.zoom)||12,11),
   pitch:0,maxPitch:60,touchPitch:false,pitchWithRotate:false,
   // Attributions (CTRN Regione Lazio, OpenStreetMap, Protomaps) always shown in full.
   attributionControl:{compact:false},fadeDuration:reduceMotion?0:300,
   // Pixel ratio capped at 2 (3x screens would draw 2.25 times the pixels for no visible
   // gain), antialiasing only below 2x, a bounded tile cache, the city's bounds, no world copies.
   pixelRatio:Math.min(devicePixelRatio,2),canvasContextAttributes:{antialias:devicePixelRatio<2},
   maxTileCacheSize:120,renderWorldCopies:false,maxBounds:runtime.bounds,minZoom:10,maxZoom:19,
  });
  map.addControl(new maplibre.NavigationControl({visualizePitch:true,showCompass:true,showZoom:true}),"top-right");
  map.addControl(controls(),"top-right");
  map.on("click",event=>{
   if(!state.choosingReference)return;
   emit("pickedReference",{lat:event.lngLat.lat,lng:event.lngLat.lng,label:"Punto scelto sulla mappa"});
  });
  map.on("moveend",render);
  map.on("load",()=>{if(map.getStyle)runtime.cleanups.push(liftBridgeLabels(map));render();});
  // The drawing itself is decorative: services, controls and attributions are separate HTML.
  const canvas=map.getCanvas?.();canvas?.setAttribute("aria-hidden","true");canvas?.removeAttribute?.("role");
 }

 /** Rotate left/right and tilt: explicit buttons, labelled, keyboard reachable. */
 function controls() {
  let box=null;
  const button=(key,fallback,glyph,action)=>{
   const b=document.createElement("button");b.type="button";b.className=`map3d-ctrl ${key}`;
   const label=t(`map.map3d.${key}`,fallback);b.title=label;b.setAttribute("aria-label",label);b.textContent=glyph;
   b.addEventListener("click",action);return b;
  };
  const rotate=by=>{const bearing=runtime.map.getBearing()+by;reduceMotion?runtime.map.setBearing(bearing):runtime.map.rotateTo(bearing,{duration:300});};
  return {onAdd(){
   box=document.createElement("div");box.className="maplibregl-ctrl maplibregl-ctrl-group map3d-controls";
   const tilt=button("tilt","Inclina la vista","⛰",()=>{
    const flat=runtime.map.getPitch()<1;move({pitch:flat?TILT:0});tilt.setAttribute("aria-pressed",String(flat));
   });
   tilt.setAttribute("aria-pressed","false");
   runtime.map.on("pitchend",()=>tilt.setAttribute("aria-pressed",String(runtime.map.getPitch()>=1)));
   for(const b of [button("rotate_left","Ruota a sinistra","⟲",()=>rotate(-ROTATE_STEP)),button("rotate_right","Ruota a destra","⟳",()=>rotate(ROTATE_STEP)),tilt])box.append(b);
   return box;
  },onRemove(){box?.remove();}};
 }

 /** Clusters of sites closer than CLUSTER_PX on screen (none from CLUSTER_MAX_ZOOM). */
 function cluster(entries) {
  const map=runtime.map;
  if(map.getZoom()>=CLUSTER_MAX_ZOOM)return entries.map(site=>({site,members:[site]}));
  const cells=new Map();
  for(const site of entries){
   const p=map.project([site.lng,site.lat]);
   const key=`${Math.floor(p.x/CLUSTER_PX)}:${Math.floor(p.y/CLUSTER_PX)}`;
   if(!cells.has(key))cells.set(key,[]);cells.get(key).push(site);
  }
  return [...cells.values()].map(members=>({site:members[0],members}));
 }

 function wrap(el){const box=document.createElement("div");box.className="map3d-marker";box.append(el);return box;}

 function render() {
  const map=runtime.map;
  if(!map||disposed)return;
  const next=new Map();
  if(visible){
   for(const {site,members} of cluster(siteMarkers(list,{sites,describe}))){
    const count=members.length;
    const lngLat=count>1?[members.reduce((a,m)=>a+m.lng,0)/count,members.reduce((a,m)=>a+m.lat,0)/count]:[site.lng,site.lat];
    const key=`${lngLat[0].toFixed(6)},${lngLat[1].toFixed(6)},${count}`;
    let entry=runtime.markers.get(key);
    if(!entry){
     entry={data:null};
     const el=document.createElement("button");el.type="button";
     if(count>1){
      el.className="map3d-cluster";el.textContent=String(count);
      el.setAttribute("aria-label",translate("map.map3d.cluster",{count},`${count} luoghi in quest'area: avvicina`));
      el.addEventListener("click",()=>move({center:entry.data.lngLat,zoom:Math.min(map.getZoom()+2,CLUSTER_MAX_ZOOM)}));
     }else{
      el.className="map3d-pin";
      el.addEventListener("click",()=>emit("choose",entry.data.site.choose()));
     }
     entry.el=el;
     entry.marker=new maplibre.Marker({element:wrap(el),anchor:count>1?"center":"bottom",
      pitchAlignment:"viewport",rotationAlignment:"viewport"}).setLngLat(lngLat).addTo(map);
    }
    entry.data={site,lngLat};
    if(count===1&&entry.el.dataset.html!==site.html+site.label){
     entry.el.innerHTML=site.html;entry.el.setAttribute("aria-label",site.label);entry.el.title=site.label;entry.el.dataset.html=site.html+site.label;
    }
    next.set(key,entry);
   }
  }
  for(const [key,entry] of runtime.markers)if(!next.has(key))entry.marker.remove();
  runtime.markers=next;
  runtime.user?.remove();runtime.user=null;
  if(state.userLoc){
   const dot=document.createElement("div");dot.innerHTML=USER_DOT_HTML;dot.setAttribute("role","img");dot.setAttribute("aria-label",USER_DOT_LABEL);
   runtime.user=new maplibre.Marker({element:dot,anchor:"center"}).setLngLat([state.userLoc.lng,state.userLoc.lat]).addTo(map);
  }
 }

 function contains(lat,lng){
  const [[w,s],[e,n]]=runtime.bounds||bounds();
  return lat>=s&&lat<=n&&lng>=w&&lng<=e;
 }
 function update(snapshot,rows){state=snapshot;list=rows;render();}
 /** Layer factories receive the MapLibre map and the engine (so they pick their MapLibre version). */
 function attach(factory){return factory(runtime.map,{maplibre});}
 function center(lat,lng){if(runtime.map&&contains(lat,lng))move({center:[lng,lat],zoom:Math.max(runtime.map.getZoom(),15)});}
 /** Fly to a service's building: z17.5, tilted (a jump when motion is reduced). */
 function lookAt(lat,lng){if(runtime.map&&contains(lat,lng))move({center:[lng,lat],zoom:17.5,pitch:TILT,duration:reduceMotion?0:1600});}
 function servicesVisible(value){visible=Boolean(value);render();}
 function dispose(){
  disposed=true;
  for(const clean of runtime.cleanups.splice(0))clean();
  for(const entry of runtime.markers.values())entry.marker.remove();
  runtime.markers.clear();runtime.user?.remove();runtime.user=null;
  runtime.map?.remove();runtime.map=null;
 }
 return {mount,update,attach,center,contains,lookAt,invalidate:()=>runtime.map?.resize(),servicesVisible,dispose,
  markerCount:()=>runtime.markers.size};
}
