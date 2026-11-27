/** Atomic GPU admission, bounded residency, failure/retry and automatic context recovery. */
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const sha=body=>createHash('sha256').update(body).digest('hex');
function artifacts(count=1){
 const frame={origin:[12.5,41.9],scale:[82856.76132645206,111320],units:'metres'},files=new Map(),chunks=[];
 for(let n=0;n<count;n++){
  const id=n.toString(16).padStart(16,'0'),bridge={id,sourceWayIds:[n+1],height:{method:'existing-inferred-ramp-v1',layer:1,wet:false,midspanUnderside:6.5},line:[[12.5,41.9],[12.5001,41.9]],profile:[[0,0],[10,0]],bounds:[12.49,41.89,12.51,41.91],vertices:[0,0,0,0,1,0,0,0,1,1,0,0],indices:[0,1,2]};
  const body=Buffer.from(JSON.stringify({format:1,model:'continuous-bridges-v1',dataset:'20261127T120000Z',frame,bridges:[bridge]}));
  const chunk={id:`${n}-2`,url:`${n}-2-${id}.json.gz`,sha256:sha(body),bytes:body.length,gzipBytes:body.length,bounds:bridge.bounds,bridges:[id]};
  chunks.push(chunk);files.set(chunk.url,body);
 }
 const index={format:1,model:'continuous-bridges-v1',dataset:'20261127T120000Z',meshRevision:'a'.repeat(64),frame,inputs:{osm:{capture:'retained',sha256:'b'.repeat(64)}},chunks};
 const body=Buffer.from(JSON.stringify(index));files.set('index.json.gz',body);
 return {files,index,descriptor:{url:'bridge-mesh/index.json.gz',sha256:sha(body),bytes:body.length,gzipBytes:body.length}};
}
function fixture(){
 const constants=new Map(),live=new Set(),bindings=new Map(),sizes=new Map(),canvas=new EventTarget(),events=new Map(),layers=new Map(),sources=new Map();let next=1,lost=false,box=[12.49,41.89,12.51,41.91],draws=0;
 const gl=new Proxy({
  isContextLost:()=>lost,getParameter:()=>null,isEnabled:()=>false,getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:()=>null,
  bindBuffer:(target,buffer)=>bindings.set(target,buffer),bufferData:(target,data)=>sizes.set(bindings.get(target),data.byteLength),getBufferParameter:target=>sizes.get(bindings.get(target)),drawElements(){draws++;}
 },{get(target,key){if(key in target)return target[key];if(/^[A-Z_0-9]+$/.test(key)){if(!constants.has(key))constants.set(key,next++);return constants.get(key);}if(key.startsWith('create'))return ()=>{const value={id:next++};live.add(value);return value;};if(key.startsWith('delete'))return value=>live.delete(value);return ()=>{};}});
 const map={isStyleLoaded:()=>true,getZoom:()=>17.5,getBounds:()=>({getWest:()=>box[0],getSouth:()=>box[1],getEast:()=>box[2],getNorth:()=>box[3]}),getCanvas:()=>canvas,
  getStyle:()=>({layers:[...layers.values()]}),getLayer:id=>layers.get(id),getSource:id=>sources.get(id),addSource:(id,value)=>sources.set(id,value),
  addLayer(layer){layers.set(layer.id,layer);layer.onAdd?.(map,gl);},removeLayer(id){const layer=layers.get(id);layers.delete(id);layer?.onRemove?.();},
  setLayoutProperty(id,key,value){layers.get(id).layout={...layers.get(id).layout,[key]:value};},getLayoutProperty:(id,key)=>layers.get(id)?.layout?.[key],setPaintProperty(){},triggerRepaint(){},
  on(event,fn){if(!events.has(event))events.set(event,new Set());events.get(event).add(fn);},off(event,fn){events.get(event)?.delete(fn);},fire(event){for(const fn of [...events.get(event)||[]])fn();},
  render(){for(const layer of [...layers.values()])layer.render?.(gl,{defaultProjectionData:{mainMatrix:new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])}});}
 };
 const maplibre={MercatorCoordinate:{fromLngLat:(coordinates,z=0)=>({x:coordinates[0],y:coordinates[1],z,meterInMercatorCoordinateUnits:()=>1})}};
 return {map,maplibre,gl,live,events,layers,sources,canvas,draws:()=>draws,moveOutside(){box=[13,42,14,43];map.fire('move');},lose(){lost=true;canvas.dispatchEvent(new Event('webglcontextlost'));},restore(){lost=false;canvas.dispatchEvent(new Event('webglcontextrestored'));}};
}
(async()=>{
 const {createBridgeScene}=await import('../app/frontend/static/js/features/map3d/bridge-scene.js');
 const make=(f,a,fetcher,onVersionConflict)=>createBridgeScene({...f,base:'/map3d/'+a.index.dataset,version:a.index.dataset,descriptor:a.descriptor,fetcher,onVersionConflict});
 const response=body=>new globalThis.Response(body);
 const a=artifacts(),f=fixture();let failed=false;
 const fetcher=async url=>url==='/map3d/active'?response(JSON.stringify({availability:'available',version:a.index.dataset})):failed&&!url.endsWith('/index.json.gz')?new globalThis.Response('',{status:404}):response(a.files.get(url.split('/').at(-1)));
 const scene=make(f,a,fetcher);await scene.initialized;
 assert.equal(scene.stats().ready,false,'not ready until every candidate has been uploaded');assert.equal(f.draws(),0);
 f.map.render();assert.equal(scene.stats().ready,true);assert.equal(scene.stats().chunks,1);assert.equal(scene.stats().gpuBytes,60);assert.equal(f.draws(),1);
 f.lose();assert.equal(scene.stats().ready,false);assert.equal(scene.stats().gpuBytes,0);f.restore();f.map.render();assert.equal(scene.stats().ready,true,'existing custom layer recreates its GPU state automatically');
 f.lose();f.map.removeLayer('egi-continuous-bridges');f.restore();await new Promise(setImmediate);await new Promise(setImmediate);f.map.render();assert.equal(scene.stats().ready,true,'removed custom layers automatically refetch and reattach');
 scene.dispose();assert.equal(scene.stats().gpuBytes,0);assert.equal([...f.events.values()].reduce((n,set)=>n+set.size,0),0);
 const bad=fixture();failed=true;const missing=make(bad,a,fetcher);await missing.initialized;
 assert.match(missing.stats().error,/unavailable/);assert(['decks-3d','parapets-3d','piers-3d'].every(id=>bad.layers.has(id)),'complete native fallback');
 failed=false;await missing.retry();bad.map.render();assert.equal(missing.stats().ready,true);assert.equal(bad.map.getLayoutProperty('decks-3d','visibility'),'none');missing.dispose();
 const many=artifacts(9),budget=fixture();let requests=0;
 const over=make(budget,many,async url=>{requests++;return response(many.files.get(url.split('/').at(-1)));});await over.initialized;
 assert.match(over.stats().error,/budget/);assert.equal(requests,1,'over-budget views do not fetch partial mesh coverage');assert.equal(over.stats().gpuBytes,0);over.dispose();
 const stale=fixture();let finish;
 const delayed=make(stale,a,async url=>url.endsWith('/index.json.gz')?response(a.files.get('index.json.gz')):new Promise(resolve=>{finish=()=>resolve(response(a.files.get(url.split('/').at(-1))));}));
 while(!finish)await new Promise(setImmediate);
 stale.moveOutside();finish();await delayed.initialized;stale.map.render();assert.equal(delayed.stats().ready,false);assert.equal(delayed.stats().chunks,0);delayed.dispose();
 const conflict=fixture();let changed=0;
 const changing=make(conflict,a,async url=>url==='/map3d/active'?response(JSON.stringify({availability:'available',version:'20261128T000000Z'})):url.endsWith('/index.json.gz')?response(a.files.get('index.json.gz')):new globalThis.Response('',{status:404}),()=>changed++);
 await changing.initialized;await new Promise(setImmediate);assert.equal(changed,1);assert.equal(changing.stats().ready,false);changing.dispose();
 console.log('PASS: atomic upload admission, failure/retry, chunk budget, stale movement, version conflict, context restoration and disposal');
})().catch(error=>{console.error(error);process.exitCode=1;});
