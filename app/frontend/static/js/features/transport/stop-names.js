/** Progressive station names shared by Leaflet and MapLibre; symbols and popup ownership stay in their layers. */
export const STATION_NAME_ZOOM=16; // Leaflet-equivalent zooms.
const GAP=6, HEIGHT=24;
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const station=p=>p.kind==='station'||p.transport_type==='metro'||p.transport_type==='rail';

/** Place names beside real symbol boxes, preserving all symbols and preferring focused/station names. */
export function placeStopNames(stops,viewport,reserved,zoom){
 const result=new Map(),occupied=[...reserved];
 const eligible=stops.filter(s=>s.name&&station(s.props)&&(s.near||zoom>=STATION_NAME_ZOOM))
  .sort((a,b)=>Number(b.near)-Number(a.near)||Number(station(b.props))-Number(station(a.props))||a.key.localeCompare(b.key));
 for(const stop of eligible){
  const b=stop.box,cx=(b.left+b.right)/2,cy=(b.top+b.bottom)/2;
  const maxWidth=Math.min(190,Math.max(72,Array.from(stop.name).length*7+16));
  for(const width of new Set([maxWidth,Math.min(maxWidth,110)])){
   const candidates=[{left:b.right+GAP,top:cy-HEIGHT/2},{left:b.left-GAP-width,top:cy-HEIGHT/2},
    {left:cx-width/2,top:b.top-GAP-HEIGHT},{left:cx-width/2,top:b.bottom+GAP}];
   const box=candidates.map(p=>({...p,right:p.left+width,bottom:p.top+HEIGHT,width}))
    .find(p=>p.left>=viewport.left+4&&p.right<=viewport.right-4&&p.top>=viewport.top+4&&p.bottom<=viewport.bottom-4
     &&!occupied.some(o=>intersects(p,o))&&!stops.some(other=>other!==stop&&intersects(p,other.box)));
   if(box){result.set(stop,box);occupied.push(box);break;}
  }
 }
 return result;
}

/** Refresh only name spans after a settled camera/data change; batch geometry reads before label writes. */
export function createStopNames(root){
 let entries=[],pending=null,generation=0,disposed=false;
 const frame=globalThis.requestAnimationFrame?.bind(globalThis),cancel=globalThis.cancelAnimationFrame?.bind(globalThis);
 function rect(node){const box=node?.getBoundingClientRect?.();return box?.width>0&&box?.height>0?box:null;}
 function layout(zoom){
  if(!entries.length)return;
  const viewport=rect(root);
  if(!viewport){for(const entry of entries)if(entry.label)entry.label.hidden=true;return;}
  // Include service heads, map controls and open popups; never inspect the raster basemap.
  const scene=root.parentElement||root;
  const reserved=[...scene.querySelectorAll('.map3d-pin-body,.site-pin,.map3d-cluster,.marker-cluster,.map-mode-tools,.map-brand,.map-city-tag,.floating-actions .nav-btn,.maplibregl-ctrl,.leaflet-control,.map3d-route-status:not([hidden]),.maplibregl-popup,.leaflet-popup,.tl-line-label,.tl-focus-chip:not([hidden])')].map(rect).filter(Boolean);
  const stops=[];
  for(const entry of entries){
   const symbol=rect(entry.element?.querySelector('.tl-anchored>.tl-station,.tl-anchored>.tl-stop'))||rect(entry.element?.querySelector('.tl-station,.tl-stop')),ground=rect(entry.element?.querySelector('.tl-ground'));
   const origin=entry.element?.getBoundingClientRect?.();
   if(!symbol||!origin)continue;
   const compact=rect(entry.element?.querySelector('.tl-compact .tl-station,.tl-compact .tl-stop'));
   const footprint=[symbol,compact,ground].filter(Boolean);
   const box={left:Math.min(...footprint.map(b=>b.left)),right:Math.max(...footprint.map(b=>b.right)),top:Math.min(...footprint.map(b=>b.top)),bottom:Math.max(...footprint.map(b=>b.bottom))};
   stops.push({...entry,box,origin,key:JSON.stringify([entry.props.transport_type,entry.props.stop_ids||entry.props.stop_id,entry.props.name]),name:String(entry.props.name||'').trim()});
  }
  const placements=placeStopNames(stops,viewport,reserved,zoom);
  for(const entry of entries)if(entry.label)entry.label.hidden=true;
  for(const [stop,box] of placements){
   const label=stop.label;label.hidden=false;label.style.left=`${box.left-stop.origin.left}px`;label.style.top=`${box.top-stop.origin.top}px`;label.style.width=`${box.width}px`;
  }
 }
 function refresh(zoom){
  if(disposed)return;
  const current=++generation;cancel?.(pending);
  if(!frame){layout(zoom);return;}
  pending=frame(()=>{pending=null;if(current===generation)layout(zoom);});
 }
 function update(next,zoom){
  if(disposed)return;
  entries=next.filter(e=>e.element);
  for(const entry of entries){
   const label=document.createElement('span');label.className='tl-stop-name';label.hidden=true;label.setAttribute('aria-hidden','true');label.textContent=String(entry.props.name||'');
   entry.element.appendChild(label);entry.label=label;
  }
  refresh(zoom);
 }
 function clear(){generation++;cancel?.(pending);pending=null;for(const entry of entries)entry.label?.remove?.();entries=[];}
 return {update,refresh,clear,dispose(){disposed=true;clear();}};
}
