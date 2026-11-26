/** Opt-in live vehicles: bounded POST, visibility/zoom gating, interpolation and stale removal. */
const SOURCE='egi-live-buses', LAYERS=[SOURCE+'-fresh',SOURCE+'-old',SOURCE+'-labels'];
const RAD=Math.PI/180, METRES=111320;
/** A 12 × 2.6 m box oriented clockwise from north; height belongs to the layer. */
export function footprint(lon,lat,bearing=0){
 const angle=bearing*RAD,cos=Math.cos(lat*RAD);
 const corners=[[-1.3,-6],[1.3,-6],[1.3,6],[-1.3,6],[-1.3,-6]].map(([x,y])=>[
  lon+(x*Math.cos(angle)+y*Math.sin(angle))/(METRES*cos),lat+(-x*Math.sin(angle)+y*Math.cos(angle))/METRES]);
 return {type:'Polygon',coordinates:[corners]};
}
export function createBuses({scope,http,translate:t,
 reduced=Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
 frame=globalThis.requestAnimationFrame?.bind(globalThis),cancel=globalThis.cancelAnimationFrame?.bind(globalThis),
 clock=()=>Date.now(),host=document,delay=setTimeout,undelay=clearTimeout}){
 let map=null,visible=false,disposed=false,request=null,timer=null,tick=null,animation=null,lines=[],snapshot=null,received=0,generation=0;
 let shown=new Map(),transition=null,statusKey='';const cleanup=[];
 const panel=document.createElement('div');panel.className='map3d-buses';
 const button=document.createElement('button');button.type='button';button.className='btn';
 const input=document.createElement('input');input.type='text';input.maxLength=2000;
 const label=document.createElement('label'),labelText=document.createElement('span');label.appendChild(labelText);label.appendChild(input);
 const status=document.createElement('div');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const credit=document.createElement('div');credit.textContent='Roma Mobilità · CC BY-SA';credit.hidden=true;
 panel.appendChild(button);panel.appendChild(label);panel.appendChild(status);panel.appendChild(credit);
 input.setAttribute('aria-label',t('map.buses.lines'));input.placeholder=t('map.buses.all');
 const active=()=>visible&&!disposed&&!host.hidden&&map?.getZoom()>=15;
 const empty=()=>({type:'FeatureCollection',features:[]});
 const say=key=>{statusKey=key;const text=key?t(`map.buses.${key}`):'';if(status.textContent!==text)status.textContent=text;};
 function refreshLabels(){button.textContent=t('map.buses.toggle');labelText.textContent=t('map.buses.lines');input.setAttribute('aria-label',t('map.buses.lines'));input.placeholder=t('map.buses.all');say(statusKey);}
 function own(event,fn){map.on(event,fn);cleanup.push(()=>map.off?.(event,fn));}
 function ensure(){
  if(disposed||map.isStyleLoaded?.()===false||map.getSource(SOURCE))return;
  map.addSource(SOURCE,{type:'geojson',data:empty()});
  for(const [id,old,opacity] of [[LAYERS[0],false,.9],[LAYERS[1],true,.3]])map.addLayer({id,minzoom:15,type:'fill-extrusion',source:SOURCE,filter:['==',['get','old'],old],paint:{'fill-extrusion-color':'#f5c400','fill-extrusion-height':3.2,'fill-extrusion-opacity':opacity}});
  map.addLayer({id:LAYERS[2],type:'symbol',source:SOURCE,minzoom:16,layout:{'text-field':['get','code'],'text-font':['Noto Sans Regular'],'text-size':13,'text-allow-overlap':false},paint:{'text-color':'#302800','text-halo-color':'#fff','text-halo-width':1.5,'text-opacity':['case',['get','old'],.3,1]}});
 }
 function stop(){request?.abort();request=null;undelay(timer);timer=null;cancel?.(animation);animation=null;transition=null;}
 function render(progress=1){
  if(!map)return;ensure();
  const elapsed=(clock()-received)/1000;
  const stale=!snapshot||snapshot.stale||snapshot.availability!=='available'||snapshot.now-snapshot.feed_timestamp+elapsed>180;
  if(!active()||stale){map.getSource(SOURCE)?.setData(empty());shown.clear();if(visible)say(!active()?(map.getZoom()<15?'zoom':''):!snapshot?'loading':snapshot.availability==='unavailable'?'unavailable':'stale');return;}
  const features=[],next=new Map();
  for(const vehicle of snapshot.vehicles){
   const previous=transition?.get(vehicle.id);const p=previous&&progress<1?progress:1;
   const lon=previous?previous.lon+(vehicle.lon-previous.lon)*p:vehicle.lon;
   const lat=previous?previous.lat+(vehicle.lat-previous.lat)*p:vehicle.lat;
   const bearing=vehicle.bearing??(previous&&(previous.lon!==vehicle.lon||previous.lat!==vehicle.lat)?(Math.atan2((vehicle.lon-previous.lon)*Math.cos(lat*RAD),vehicle.lat-previous.lat)/RAD+360)%360:previous?.bearing??0);
   next.set(vehicle.id,{lon,lat,bearing});
   features.push({type:'Feature',geometry:footprint(lon,lat,bearing),properties:{code:vehicle.code||'',old:vehicle.age===null||vehicle.age+elapsed>120}});
  }
  shown=next;map.getSource(SOURCE)?.setData({type:'FeatureCollection',features});say(features.length?'live':'empty');
 }
 async function load(){
  undelay(timer);timer=null;request?.abort();
  if(!active()){render();return;}
  const bounds=map.getBounds(),body={west:bounds.getWest(),south:bounds.getSouth(),east:bounds.getEast(),north:bounds.getNorth(),lines};
  if(body.east-body.west>.15||body.north-body.south>.15){snapshot=null;render();say('zoom');return;}
  const current=request=new AbortController();const token=++generation;
  try{
   const response=await http.request('/api/preview/transit/vehicles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:current.signal});
   if(!response.ok)throw Error('unavailable');const data=await response.json();
   if(disposed||current.signal.aborted||token!==generation||!active())return;
   transition=new Map(shown);snapshot=data;received=clock();cancel?.(animation);
   // A short transition joins observed snapshots without extrapolating unobserved travel.
   if(!reduced&&frame&&!data.stale){let start=null;const step=now=>{if(!active())return;start??=now;const p=Math.min(1,(now-start)/1000);render(p);animation=p<1?frame(step):null;};animation=frame(step);}else render();
  }catch(error){if(current.signal.aborted||disposed)return;snapshot={availability:'unavailable',stale:true};render();}
  finally{if(active()&&!current.signal.aborted)timer=delay(load,20000);}
 }
 function schedule(){stop();snapshot=null;render();if(active())timer=delay(load,180);}
 function setVisible(value){visible=Boolean(value);button.setAttribute('aria-pressed',String(visible));refreshLabels();credit.hidden=!visible;label.hidden=!visible;status.hidden=!visible;schedule();}
 function setLines(values){lines=[...new Set(values.map(s=>s.trim()).filter(Boolean))].slice(0,80);schedule();}
 button.addEventListener('click',()=>setVisible(!visible),{signal:scope.signal});
 input.addEventListener('input',()=>setLines(input.value.split(',')),{signal:scope.signal});
 host.addEventListener('visibilitychange',schedule,{signal:scope.signal});
 function mount(attach){attach(m=>{map=m;map.getContainer().appendChild(panel);own('moveend',schedule);own('zoom',()=>{if(!active()){stop();snapshot=null;render();}});own('load',()=>{ensure();render();});ensure();setVisible(false);
  const age=()=>{if(disposed)return;if(active()&&snapshot&&!animation)render();tick=delay(age,1000);};tick=delay(age,1000);});}
 function dispose(){disposed=true;visible=false;stop();undelay(tick);for(const fn of cleanup)fn();panel.remove?.();for(const id of [...LAYERS].reverse())if(map?.getLayer?.(id))map.removeLayer(id);if(map?.getSource(SOURCE))map.removeSource(SOURCE);}
 return {mount,setVisible,setLines,refreshLabels,reload:load,dispose};
}
