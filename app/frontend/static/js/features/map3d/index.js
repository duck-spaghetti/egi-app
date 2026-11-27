import {createTransportScene} from '../transport-scene/index.js';
import {siteMarkers,USER_DOT_HTML,USER_DOT_LABEL} from "../map/pins.js";
import {clusterSites,clusterAppearance,siteLabel,placeSiteHeads,siteHeadBox,CLUSTER_DISTANCE,STEM_ZOOM,NAME_ZOOM,DETAIL_ZOOM} from "./sites.js";
import {egiStyle,liftBridgeLabels} from "./style.js";
/** createMap3d: the 3D mode's map module, on MapLibre GL JS, with the current map's interface.
 *
 * mount, update(snapshot, list), attach(factory), center, contains, invalidate,
 * servicesVisible and dispose behave as in features/map/index.js. Services are upright,
 * keyboard-focusable HTML markers from the shared pin markup and site grouping; at
 * zoom < CLUSTER_MAX_ZOOM sites closer than CLUSTER_PX on screen form one cluster button.
 * Initial pitch 45°; rotation by buttons, compass reset and keyboard; explicit tilt control;
 * reduced motion respected. maplibre is the vendored module, pmtiles the reader
 * (both injected, so tests can pass fakes).
 */
const PROTOCOLS = new WeakSet(); // MapLibre instances with the pmtiles protocol registered
export const CLUSTER_PX = CLUSTER_DISTANCE, CLUSTER_MAX_ZOOM = 15, TILT = 55, ROTATE_STEP = 30;
// Budget (spec, Performance): at least 30 fps while moving, JS memory under 150 MB.
export const MIN_FPS = 30, MAX_HEAP_MB = 150, BUDGET_SAMPLES = 3;

/** Median of the fps samples and the heap (MB, where the browser reports it): over budget or not. */
export function overBudget(samples, heapMb) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : Infinity;
  return {fps: Math.round(median), heapMb, over: median < MIN_FPS || (heapMb !== null && heapMb > MAX_HEAP_MB)};
}

export function createMap3d({context,sites,describe,emit,maplibre,pmtiles,translate=(key,params,fallback)=>fallback||key,
  reduceMotion=Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  devicePixelRatio=globalThis.devicePixelRatio||1,origin=globalThis.location?.origin||"",
  frame=globalThis.requestAnimationFrame?.bind(globalThis),cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis),
  clock=()=>globalThis.performance?.now?.()??Date.now(),heap=()=>globalThis.performance?.memory?.usedJSHeapSize??null}) {
 let state={},entries=[],visible=true,disposed=false,headsDirty=false,transportScene=null;
 const runtime={map:null,markers:new Map(),user:null,bounds:null,cleanups:[],layout:[],screen:null};
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
   pitch:45,maxPitch:60,touchPitch:false,pitchWithRotate:false,
   // Attributions (CTRN Regione Lazio, OpenStreetMap, Protomaps) always shown in full.
   attributionControl:{compact:false},fadeDuration:reduceMotion?0:300,
   // Pixel ratio capped at 2 (3x screens would draw 2.25 times the pixels for no visible
   // gain), antialiasing only below 2x, a bounded tile cache, the city's bounds, no world copies.
   pixelRatio:Math.min(devicePixelRatio,2),canvasContextAttributes:{antialias:devicePixelRatio<2},
   maxTileCacheSize:120,renderWorldCopies:false,maxBounds:runtime.bounds,minZoom:10,maxZoom:19,
  });
  map.addControl(new maplibre.NavigationControl({visualizePitch:true,showCompass:true,showZoom:true}),"top-left");
  map.addControl(controls(),"top-left");
  map.on("click",event=>{
   if(!state.choosingReference)return;
   event.egiReferencePicked=true;
   emit("pickedReference",{lat:event.lngLat.lat,lng:event.lngLat.lng,label:"Punto scelto sulla mappa"});
  });
  map.on("moveend",render);
  map.on("move",queueHeadLayout);
  map.on("render",flushHeadLayout);
  runtime.cleanups.push(()=>{map.off("move",queueHeadLayout);map.off("render",flushHeadLayout);cancelHeadLayout();});
  if(maplibre.MercatorCoordinate)transportScene=createTransportScene({map,maplibre,onStopSelect:key=>map.fire("egi:stopselect",{key})});
  watchBudget(map);
  map.on("load",()=>{if(map.getStyle)runtime.cleanups.push(liftBridgeLabels(map));render();});
  // The drawing itself is decorative: services, controls and attributions are separate HTML.
  const canvas=map.getCanvas?.();canvas?.setAttribute("aria-hidden","true");canvas?.removeAttribute?.("role");
 }

 /** Measure fps while the map moves; after BUDGET_SAMPLES moves, report once if below budget. */
 function watchBudget(map) {
  if(!frame)return;
  const samples=[];let frames=0,start=0,id=null,done=false;
  const loop=()=>{frames++;id=frame(loop);};
  map.on("movestart",()=>{if(done)return;frames=0;start=clock();cancelFrame?.(id);id=frame(loop);});
  map.on("moveend",()=>{
   if(done||id===null)return;
   cancelFrame?.(id);id=null;
   const seconds=(clock()-start)/1000;
   if(seconds>=0.5&&map.getZoom()>=14)samples.push(frames/seconds);
   if(samples.length<BUDGET_SAMPLES)return;
   done=true;
   const bytes=heap();const result=overBudget(samples,bytes===null?null:Math.round(bytes/1048576));
   if(result.over)emit("map3dBudget",result);
  });
  runtime.cleanups.push(()=>{done=true;cancelFrame?.(id);});
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
   tilt.setAttribute("aria-pressed",String(runtime.map.getPitch()>=1));
   runtime.map.on("pitchend",()=>tilt.setAttribute("aria-pressed",String(runtime.map.getPitch()>=1)));
   for(const b of [button("rotate_left","Ruota a sinistra","⟲",()=>rotate(-ROTATE_STEP)),button("rotate_right","Ruota a destra","⟳",()=>rotate(ROTATE_STEP)),tilt])box.append(b);
   return box;
  },onRemove(){box?.remove();}};
 }

 /** Keep a selected site reachable while grouping other nearby sites. */
 function cluster(entries) {
  const selected=entries.filter(site=>site.serviceIds.includes(String(state.selectedId)));
  const rest=entries.filter(site=>!selected.includes(site));
  return [...selected.map(site=>({site,members:[site]})),...clusterSites(rest,p=>runtime.map.project(p),runtime.map.getZoom(),CLUSTER_MAX_ZOOM)];
 }

 function wrap(el){const box=document.createElement("div");box.className="map3d-marker";box.append(el);return box;}

 /** Cancel the pending gesture write before settled layout or teardown takes ownership. */
 function cancelHeadLayout(){headsDirty=false;}

 /** Move the existing head and its SVG endpoint together, without replacing content or the anchor. */
 function positionHead(entry,dx,dy){
  if(entry.dx===dx&&entry.dy===dy)return;
  entry.el.style.setProperty?.('--site-head-x',`${dx}px`);entry.el.style.setProperty?.('--site-head-y',`${dy}px`);
  entry.leader?.setAttribute('d',`M0 0 L${dx} ${dy-21}`);
  entry.dx=dx;entry.dy=dy;
 }

 /** Coalesce camera events; update collision placement without rebuilding service content. */
 function queueHeadLayout(){if(!disposed&&visible)headsDirty=true;}
 /** Flush after MapLibre positions its markers, in the same rendered frame rather than a later RAF. */
 function flushHeadLayout(){if(headsDirty){headsDirty=false;layoutHeads();}}
 function layoutHeads(){
  if(disposed||!runtime.map)return;
  const zoom=runtime.map.getZoom(),layout=runtime.layout;
  for(const group of layout)group.point=runtime.map.project(group.lngLat);
  const heads=placeSiteHeads(layout,{...runtime.screen,zoom,selectedId:state.selectedId});
  for(const group of layout){
   const offset=heads.get(group)||{dx:0,dy:0};group.headPoint.x=group.point.x+offset.dx;group.headPoint.y=group.point.y+offset.dy;
   group.previous=offset;
   const entry=runtime.markers.get(group.key);if(!entry?.head)continue;
   entry.head=offset;positionHead(entry,offset.dx,offset.dy);
   const anchored=String(zoom>=STEM_ZOOM);if(entry.el.dataset.anchored!==anchored)entry.el.dataset.anchored=anchored;
  }
  // Retain readable content/accessibility; suppress only labels that now cover a head or another label.
  const labels=[],intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  for(const group of layout)if(group.label){
   const {headPoint:p,label:l}=group,box={left:p.x+l.left,right:p.x+l.right,top:p.y+l.top,bottom:p.y+l.bottom};
   const blocked=box.left<0||box.right>runtime.screen.width||box.top<0||box.bottom>runtime.screen.height||
    labels.some(other=>intersects(box,other))||
    layout.some(other=>other!==group&&intersects(box,siteHeadBox(other.headPoint)));
   const entry=runtime.markers.get(group.key),hidden=String(blocked);if(entry.el.dataset.labelColliding!==hidden)entry.el.dataset.labelColliding=hidden;
   if(!blocked)labels.push(box);
  }
 }

 function render() {
  cancelHeadLayout();
  const map=runtime.map;
  if(!map||disposed)return;
  const next=new Map(),labels=[];
  runtime.layout=[];
  if(visible){
   const viewport=map.getContainer?.(),screenWidth=viewport?.clientWidth||Infinity,screenHeight=viewport?.clientHeight||Infinity;
   runtime.screen={width:screenWidth,height:screenHeight};
   const onscreen=screenWidth===Infinity?entries:entries.filter(site=>{const p=map.project([site.lng,site.lat]);return p.x>=-120&&p.x<=screenWidth+120&&p.y>=-120&&p.y<=screenHeight+120;});
   const layout=cluster(onscreen).map(group=>{
    const {site,members}=group,count=members.length;
    const lngLat=count>1?[members.reduce((a,m)=>a+m.lng,0)/count,members.reduce((a,m)=>a+m.lat,0)/count]:[site.lng,site.lat];
    const key=count===1?`site:${site.serviceIds.slice().sort().join(',')}`:`${lngLat[0].toFixed(6)},${lngLat[1].toFixed(6)},${count}`;
    return {...group,key,lngLat,point:map.project(lngLat),previous:runtime.markers.get(key)?.head};
   });
   const heads=placeSiteHeads(layout,{zoom:map.getZoom(),selectedId:state.selectedId});
   runtime.layout=layout;
   for(const group of layout){const head=heads.get(group);group.headPoint=head?{x:group.point.x+head.dx,y:group.point.y+head.dy}:group.point;}
   for(const group of layout){
    const {site,members,lngLat,point,key}=group,count=members.length;
    let entry=runtime.markers.get(key);
    if(!entry){
     entry={data:null};
     const el=document.createElement("button");el.type="button";
     if(count>1){
      el.className="map3d-cluster";el.textContent=String(count);
      const appearance=clusterAppearance(count);el.style.width=`${appearance.size}px`;el.style.height=`${appearance.size}px`;
      el.style.background=appearance.background;el.style.color=appearance.ink;
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
    if(entry.data&&(entry.data.lngLat[0]!==lngLat[0]||entry.data.lngLat[1]!==lngLat[1]))entry.marker.setLngLat(lngLat);
    entry.data={site,lngLat};
    if(count===1){
     const offset=heads.get(group)||{dx:0,dy:0},headPoint=group.headPoint;
     entry.head=group.previous=offset;
     const selected=site.serviceIds.includes(String(state.selectedId));
     const anchored=map.getZoom()>=STEM_ZOOM,detail=selected||map.getZoom()>=DETAIL_ZOOM;
     const maxWidth=Math.min(detail?260:200,Math.max(130,(screenWidth-50)/2-30));
     const statusLength=Math.max(0,...(site.statuses||[]).map(s=>s?.label?.length||0),(site.statuses||[]).length>1?48:0);
     const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
     let placement=null;
     // Try a narrower integrated head before dropping information in a dense view.
     for(const width of new Set([maxWidth,Math.max(130,Math.floor(maxWidth*.7)),130])){
      const columns=Math.max(1,Math.floor((width-20)/23));
      const statusLines=Math.max(1,Math.ceil((statusLength*6+12)/(width-20)));
      const categoryCount=(site.allCategories||site.categories||[]).length;
      const secondaryHeight=categoryCount>1?23*Math.ceil(categoryCount/columns):site.kinds?.length?20:0;
      const labelHeight=detail?33+secondaryHeight+14*statusLines:44;
      const preferred=entry.el.dataset.labelSide?entry.el.dataset.labelSide==='left':headPoint.x+30+width>screenWidth;
      for(const leftSide of [preferred,!preferred]){
       const left=leftSide?headPoint.x-30-width:headPoint.x-24,right=leftSide?headPoint.x+24:headPoint.x+30+width;
       const height=Math.max(44,labelHeight),box={left,right,top:headPoint.y-46-height/2,bottom:headPoint.y-46+height/2};
       const inFrame=box.left>=0&&box.right<=screenWidth&&box.top>=0&&box.bottom<=screenHeight;
       const hitsPin=layout.some(other=>other!==group&&intersects(box,siteHeadBox(other.headPoint)));
       if(inFrame&&!hitsPin&&!labels.some(b=>intersects(box,b))){placement={width,leftSide,box,height};break;}
      }
      if(placement)break;
     }
     entry.el.style.setProperty?.('--site-label-width',`${(placement?.width||maxWidth)-20}px`);
     entry.el.style.setProperty?.('--site-head-height',`${placement?.height||44}px`);
     const labelled=(selected||map.getZoom()>=NAME_ZOOM)&&Boolean(placement);
     if(labelled)labels.push(placement.box);
     group.label=labelled?{left:placement.box.left-headPoint.x,right:placement.box.right-headPoint.x,top:placement.box.top-headPoint.y,bottom:placement.box.bottom-headPoint.y}:null;
     entry.el.dataset.labelColliding='false';
     entry.el.dataset.labelSide=placement?.leftSide?'left':'right';
     const html=`<span class="map3d-pin-body">${site.html}${labelled?siteLabel(site,detail,translate):''}</span><span class="map3d-stem" aria-hidden="true"></span><span class="map3d-ground" aria-hidden="true"></span><svg class="map3d-leader" width="1" height="1" aria-hidden="true"><path d="M0 0 L0 -21"></path></svg>`;
     entry.el.dataset.anchored=String(anchored);entry.el.dataset.labelled=String(labelled);entry.el.dataset.selected=String(selected);
     const accessible=[selected?`${site.name} · ${site.label}`:site.label,...(site.allCategories||[]).filter(c=>c.matched===false).map(c=>c.label||c.slug),...detail?(site.statuses||[]).map(s=>s?.label):[]].filter(Boolean).join(" · ");
     if(entry.el.dataset.html!==html+accessible){
      entry.el.innerHTML=html;entry.el.setAttribute("aria-label",accessible);entry.el.title=selected?accessible:site.label;entry.el.dataset.html=html+accessible;
      entry.leader=entry.el.querySelector('.map3d-leader path');entry.dx=entry.dy=null;
     }
     positionHead(entry,offset.dx,offset.dy);
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
 function update(snapshot,rows){
  state=snapshot;
  entries=siteMarkers(rows,{sites,describe}).map(site=>{
   if(!site.serviceIds.includes(String(state.selectedId)))return site;
   const selected=site.choose().items.find(p=>String(p.id)===String(state.selectedId));
   if(!selected)return site;const view=describe(selected);
   return {...site,name:view.title||site.name,kinds:[view.kind].filter(Boolean),statuses:[view.status]};
  });
  render();
 }
 /** Layer factories receive the MapLibre map and the engine (so they pick their MapLibre version). */
 function attach(factory){return factory(runtime.map,{maplibre,transportScene});}
 function center(lat,lng){if(runtime.map&&contains(lat,lng))move({center:[lng,lat],zoom:Math.max(runtime.map.getZoom(),15)});}
 /** Centre an opened service at z17.5, tilted; reduced motion jumps immediately. */
 function focusService(lat,lng){if(runtime.map&&contains(lat,lng))move({center:[lng,lat],zoom:17.5,pitch:TILT,duration:reduceMotion?0:650});}
 function servicesVisible(value){visible=Boolean(value);render();}
 function dispose(){
  disposed=true;
  for(const clean of runtime.cleanups.splice(0))clean();
  for(const entry of runtime.markers.values())entry.marker.remove();
  runtime.markers.clear();runtime.user?.remove();runtime.user=null;
  runtime.layout=[];runtime.screen=null;
  transportScene?.dispose();transportScene=null;
  runtime.map?.remove();runtime.map=null;
 }
 return {mount,update,attach,center,contains,focusService,invalidate:()=>runtime.map?.resize(),servicesVisible,dispose,
  markerCount:()=>runtime.markers.size};
}
