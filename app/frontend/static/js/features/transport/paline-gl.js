import {TREE_START_ZOOM,TREE_FULL_ZOOM} from '../map3d/style.js';
/** Physical stop signs in the existing 3D scene; source coordinates and popup ownership stay upstream. */
export const PALINE_SOURCE='egi-transport-paline';
export const PALINE_LAYERS=[`${PALINE_SOURCE}-metro`,`${PALINE_SOURCE}-road`];
export const SIGN_SCALE=3.2;
const FADE_WEIGHTS=[0,.15625,.5,.84375,1];

/** Native signs appear/grow with the trees; compact symbols remain a separate permanent overlay. */
export function nativeFade(){return FADE_WEIGHTS.flatMap((weight,i)=>[TREE_START_ZOOM+i*(TREE_FULL_ZOOM-TREE_START_ZOOM)/4,weight]);}
export function nativeProgress(zoom){
 const stops=nativeFade();if(zoom<=stops[0])return 0;
 for(let i=2;i<stops.length;i+=2)if(zoom<=stops[i])return stops[i-1]+(stops[i+1]-stops[i-1])*(zoom-stops[i-2])/(stops[i]-stops[i-2]);
 return 1;
}
const nativeGrowth=property=>['interpolate',['linear'],['zoom'],...nativeFade().flatMap((value,i,stops)=>i%2?[]:[value,['*',['get',property],stops[i+1]]])];
const GLYPHS={metro:['10001','11011','10101','10001','10001'],tram:['11111','00100','00100','00100','00100'],bus:['11111','10001','11111','10001','11011']};

/** Stable source identity also used by the accessible marker and popup owner. */
export function stopKey(feature){return String(feature.id||JSON.stringify([feature.properties.transport_type,feature.properties.stop_ids||[feature.properties.stop_id]]));}
export function nativeMode(props){return Object.hasOwn(GLYPHS,props.transport_type);}

/** Build small metre-sized prisms around the unchanged source point, never snapped to a road. */
export function signGeometry(stops){
 const features=[];
 for(const stop of stops){
  const [lng,lat]=stop.coordinates,mode=stop.mode;
  const position=(x,y)=>[lng+x*SIGN_SCALE/(111320*Math.cos(lat*Math.PI/180)),lat+y*SIGN_SCALE/111320];
  const box=(x,y,width,depth,base,height,color)=>features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[[[x-width/2,y-depth/2],[x+width/2,y-depth/2],[x+width/2,y+depth/2],[x-width/2,y+depth/2],[x-width/2,y-depth/2]].map(p=>position(...p))]},properties:{key:stop.key,mode,base:base*SIGN_SCALE,height:height*SIGN_SCALE,color}});
  box(0,0,.15,.15,0,2.3,mode==='metro'?'#42494b':'#8a343a');
  box(0,0,.65,.18,2.05,2.7,mode==='metro'?'#c4161c':'#f5d66c');
  if(mode!=='metro')box(0,0,.65,.18,2.58,2.7,'#a62d35');
  // The same sparse glyph on both faces; no texture/model requests or camera-facing rebuild.
  GLYPHS[mode].forEach((row,j)=>{
   for(let i=0;i<row.length;){if(row[i]!=='1'){i++;continue;}let end=i+1;while(row[end]==='1')end++;
    for(const side of [-1,1])box(-.25+(i+end)*.05,side*.13,(end-i)*.1,.1,2.1+(4-j)*.09,2.1+(5-j)*.09,mode==='metro'?'#fff':'#35342c');
    i=end;
   }
  });
  if(stop.near)box(0,0,.4,.4,.01,.04,'#ffd23f');
 }
 return {type:'FeatureCollection',features};
}

/** Own one batched source/two depth-tested layers; camera scaling/fades are evaluated by the GPU. */
export function createPaline(map,onSelect){
 let encoded=null,disposed=false;
 function ensure(){
  if(disposed||map.getSource(PALINE_SOURCE))return;
  map.addSource(PALINE_SOURCE,{type:'geojson',maxzoom:22,tolerance:0,data:{type:'FeatureCollection',features:[]}});
  const before=map.getStyle?.().layers?.find(l=>l.type==='symbol')?.id;
  for(const [i,id] of PALINE_LAYERS.entries())map.addLayer({id,type:'fill-extrusion',source:PALINE_SOURCE,minzoom:TREE_START_ZOOM,
   filter:i===0?['==',['get','mode'],'metro']:['!=',['get','mode'],'metro'],
   paint:{'fill-extrusion-base':nativeGrowth('base'),'fill-extrusion-height':nativeGrowth('height'),'fill-extrusion-color':['get','color'],
    'fill-extrusion-opacity':['interpolate',['linear'],['zoom'],...nativeFade()],'fill-extrusion-opacity-transition':{duration:0},'fill-extrusion-vertical-gradient':false}},before);
 }
 function update(features,zoom,focused){
  if(disposed||!map.getSource(PALINE_SOURCE))return;
  // Prepare one zoom ahead of the fade, keeping distant networks out of the mesh workload.
  const stops=features.filter(f=>f.geometry.type==='Point'&&nativeMode(f.properties)&&zoom>=TREE_START_ZOOM-1).map(f=>({key:stopKey(f),mode:f.properties.transport_type,coordinates:f.geometry.coordinates,near:Boolean(focused&&(f.properties.stop_ids||[f.properties.stop_id]).some(id=>focused.stopIds.has(id)))}));
  const signature=JSON.stringify(stops);if(signature===encoded)return;
  map.getSource(PALINE_SOURCE).setData(signGeometry(stops));encoded=signature;
 }
 function click(event){
  if(disposed||event.egiReferencePicked||!event.point)return;
  const layers=(map.getStyle?.().layers||[]).filter(l=>l.type==='fill-extrusion'&&(!PALINE_LAYERS.includes(l.id)||nativeProgress(map.getZoom())>0)).map(l=>l.id);
  const p=event.point,hits=map.queryRenderedFeatures([[p.x-5,p.y-5],[p.x+5,p.y+5]],{layers});
  // MapLibre orders extrusion intersections by depth. A foreground building blocks selection too.
  const first=hits.find(f=>!PALINE_LAYERS.includes(f.layer.id)||nativeProgress(map.getZoom())>0);if(!first||!PALINE_LAYERS.includes(first.layer.id)||nativeProgress(map.getZoom())<=0)return;
  event.egiStopPicked=true;onSelect(first.properties.key);
 }
 map.on('click',click);
 return {ensure,update,dispose(){disposed=true;map.off?.('click',click);for(const id of PALINE_LAYERS)if(map.getLayer?.(id))map.removeLayer(id);if(map.getSource(PALINE_SOURCE))map.removeSource(PALINE_SOURCE);}};
}
