import {VectorTile} from '../../../vendor/walking/vector-tile.js';
import Pbf from '../../../vendor/walking/pbf.js';
import {walkingRoute, distance, azimuth} from './router.js';
/** Own route requests, camera overview and painting behind mount/walk/clear/dispose. */
export function createWalking({context,scope,translate:t,pmtiles,
  reduced=Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  route=walkingRoute,frame=globalThis.requestAnimationFrame?.bind(globalThis),cancel=globalThis.cancelAnimationFrame?.bind(globalThis)}) {
 let map=null, engine=null,request=null,generation=0,animation=null,disposed=false,finishOverview=null;
 const id='egi-walking';
 const status=document.createElement('div');status.className='map3d-route-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
 const archive=new pmtiles.PMTiles(new URL(`${context.map3d.base}/basemap.pmtiles`,globalThis.location?.origin||'http://localhost').href);
 const say=(key,params={})=>{status.hidden=false;status.textContent=t(`map.walk.${key}`,params);};
 const empty=()=>({type:'FeatureCollection',features:[]});
 function paint(progress){
  for(const [name,color] of [[id+'-casing','#ffffff'],[id+'-line','#1f6fd1']]){
   const p=Math.min(.9998,Math.max(.0001,progress));
   map.setPaintProperty(name,'line-gradient',progress>=1?color:['interpolate',['linear'],['line-progress'],0,color,p,color,p+.0001,'rgba(0,0,0,0)',1,'rgba(0,0,0,0)']);
  }
 }
 function ensure(){
  if(map.getSource(id))return;
  map.addSource(id,{type:'geojson',lineMetrics:true,data:empty()});
  const before=map.getStyle().layers.find(l=>l.type==='symbol')?.id;
  for(const [name,color,width] of [[id+'-casing','#ffffff',9],[id+'-line','#1f6fd1',5]])
   map.addLayer({id:name,type:'line',source:id,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':width}},before);
 }
 function clear(){
  generation++;request?.abort();request=null;cancel?.(animation);animation=null;
  finishOverview?.();finishOverview=null;map?.stop?.();map?.getSource(id)?.setData(empty());status.hidden=true;
 }
 async function walk(from,to){
  clear();const current=++generation;request=new AbortController();say('loading');
  try{
   const path=await route(archive,from,to,{VectorTile,Pbf},request.signal);
   if(disposed||current!==generation)return;
   if(!map.getStyle()?.layers?.length){say('no_route');return;}
   ensure();let metres=0;for(let i=1;i<path.length;i++)metres+=distance(path[i-1],path[i]);
   const params={distance:metres<1000?`${Math.round(metres/10)*10} m`:`${(metres/1000).toFixed(1)} km`,minutes:Math.max(1,Math.round(metres/75))};
   map.getSource(id).setData({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:path}});
   const bounds=new engine.LngLatBounds(path[0],path[0]);path.forEach(p=>bounds.extend(p));
   paint(reduced?1:0);
   const options={bearing:azimuth(from,to),pitch:0,padding:{top:90,bottom:120,left:60,right:60},maxZoom:18,animate:!reduced,duration:reduced?0:900};
   if(reduced){map.fitBounds(bounds,options);say('summary',params);return;}
   await new Promise(resolve=>{
    const done=()=>{map.off?.('moveend',done);finishOverview=null;resolve();};finishOverview=done;map.once('moveend',done);map.fitBounds(bounds,options);
   });
   if(disposed||current!==generation)return;
   say('summary',params);let start=null;const duration=Math.min(4000,Math.max(1500,metres*2));
   const step=now=>{if(disposed||current!==generation)return;start??=now;const p=Math.min(1,(now-start)/duration);paint(p);animation=p<1?frame(step):null;};
   animation=frame(step);
  }catch(error){if(disposed||current!==generation||error.name==='AbortError')return;say(error.message==='too_far'?'too_far':'no_route');}
 }
 function mount(attach){attach((m,{maplibre})=>{map=m;engine=maplibre;map.getContainer().appendChild(status);});}
 function escape(event){if(event.key==='Escape')clear();}
 document.addEventListener('keydown',escape,{signal:scope.signal});
 function dispose(){clear();disposed=true;status.remove?.();for(const name of [id+'-line',id+'-casing'])if(map?.getLayer?.(name))map.removeLayer(name);if(map?.getSource(id))map.removeSource(id);}
 return {mount,walk,clear,dispose};
}
