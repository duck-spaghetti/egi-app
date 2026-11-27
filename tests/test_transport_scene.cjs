/** Actual shared renderer interface: bounded meshes, uploads, depth-query lifecycle, isolation and recovery. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
function context(){
 const constants=new Map(),live=new Map(),state=new Map(),enabled=new Set(),calls=[];let next=1,queryReady=true;const g=new Proxy({drawingBufferWidth:1000,drawingBufferHeight:700,failShader:false,
 getParameter(key){return state.get(key)??null;},isEnabled:key=>enabled.has(key),isContextLost:()=>false,
 getShaderParameter(){return !g.failShader;},getProgramParameter:()=>true,getUniformLocation:(p,n)=>n,getQueryParameter:(q,p)=>p===g.QUERY_RESULT_AVAILABLE?queryReady:true,
 enable:key=>enabled.add(key),disable:key=>enabled.delete(key),useProgram:p=>state.set(g.CURRENT_PROGRAM,p),bindVertexArray:p=>state.set(g.VERTEX_ARRAY_BINDING,p),bindBuffer:(t,p)=>state.set(g.ARRAY_BUFFER_BINDING,p),
 activeTexture:p=>state.set(g.ACTIVE_TEXTURE,p),bindTexture:(t,p)=>state.set(g.TEXTURE_BINDING_2D,p),depthMask:p=>state.set(g.DEPTH_WRITEMASK,p),pixelStorei:(k,v)=>state.set(k,v),
 colorMask:(...v)=>state.set(g.COLOR_WRITEMASK,v),scissor:(...v)=>{state.set(g.SCISSOR_BOX,v);calls.push(['scissor',...v]);}
 },{get(target,key){if(key in target)return target[key];if(/^[A-Z_0-9]+$/.test(key)){if(!constants.has(key))constants.set(key,next++);return constants.get(key);}
  if(key.startsWith('create'))return ()=>{const p={kind:key,id:next++};live.set(p,key);return p;};
  if(key.startsWith('delete'))return p=>{if(p)live.delete(p);};return (...args)=>calls.push([key,...args]);}});
 state.set(g.ACTIVE_TEXTURE,g.TEXTURE0);state.set(g.COLOR_WRITEMASK,[true,true,true,true]);state.set(g.SCISSOR_BOX,[0,0,1000,700]);state.set(g.DEPTH_WRITEMASK,true);state.set(g.UNPACK_FLIP_Y_WEBGL,false);
 return {g,calls,live,state,ready:value=>queryReady=value};
}
function mapFixture(g){const layers=new Map(),events=new Map();let bearing=0,zoom=18;return {layers,events,
 getCenter:()=>({lng:0,lat:0}),getContainer:()=>({clientWidth:1000,clientHeight:700}),getZoom:()=>zoom,getBearing:()=>bearing,getProjection:()=>undefined,isStyleLoaded:()=>true,
 getStyle:()=>({layers:[{id:'parts-3d',type:'fill-extrusion'},{id:'labels',type:'symbol'}]}),getLayer:id=>layers.get(id),triggerRepaint(){},
 addLayer(l){assert(!layers.has(l.id));layers.set(l.id,l);l.onAdd(this,g);},removeLayer(id){const l=layers.get(id);layers.delete(id);l?.onRemove(this,g);},
 on(e,fn){if(!events.has(e))events.set(e,new Set());events.get(e).add(fn);},off(e,fn){events.get(e)?.delete(fn);},fire(e,event={}){for(const fn of [...events.get(e)||[]])fn(event);},
 render(){for(const l of layers.values())l.render(g,{defaultProjectionData:{mainMatrix:new Float64Array([.01,0,0,0,0,.01,0,0,0,.01,.001,0,0,0,0,1])}});},rotate(v){bearing=v;},zoom(v){zoom=v;}};}
(async()=>{
 const env=environment({queueMicrotask,performance:{now:()=>0}}),{createTransportScene,SCENE_ID}=await env.load('features/transport-scene/index.js');
 env.document.removeEventListener=()=>{};
 const {signMeshes,busMesh}=await env.load('features/transport-scene/geometry.js');const meshes=signMeshes();assert.equal((meshes.pole.length+meshes.board.length)/24,24);assert(busMesh().length/24<=500);assert(busMesh(true).length/24<=24);
 const gl=context(),map=mapFixture(gl.g),selected=[],jobs=new Map();let jobId=0,now=0;
 const maplibre={MercatorCoordinate:{fromLngLat:c=>({x:c.lng??c[0],y:c.lat??c[1],meterInMercatorCoordinateUnits:()=>1})}};
 const options={map,maplibre,onStopSelect:key=>selected.push(key),loadAtlas:()=>Promise.resolve({width:256,height:128}),clock:()=>now,delay:fn=>{jobs.set(++jobId,fn);return jobId;},undelay:id=>jobs.delete(id)};
 const scene=createTransportScene(options);await new Promise(setImmediate);assert(map.layers.has(SCENE_ID));
 const sign={key:'a',mode:'bus',coordinates:[0,0]},original=JSON.stringify(sign);assert.equal(scene.setSigns([{...sign,coordinates:[]},{...sign,coordinates:[0,NaN]},{...sign,coordinates:[0,90]}]),true);map.render();assert.equal(scene.setSigns([sign,sign]),true);map.render();assert.equal(JSON.stringify(sign),original);
 const uploads=gl.calls.filter(c=>c[0]==='bufferData').length;gl.calls.length=0;
 for(let i=0;i<10;i++){map.rotate(i*36);map.render();}assert.equal(gl.calls.filter(c=>c[0]==='bufferData').length,0,'camera-only paths never rebuild data/meshes');assert.equal(gl.calls.filter(c=>c[0]==='drawArraysInstanced').length,20);assert.equal(gl.state.get(gl.g.DEPTH_WRITEMASK),true);
 map.rotate(0);map.render();const click={point:{x:500,y:297}};map.fire('click',click);assert.equal(click.egiStopPicked,true);map.render();assert.equal(gl.calls.filter(c=>c[0]==='scissor'&&c[3]===1&&c[4]===1).at(-1)[2],402,'integer CSS/device Y uses the clicked row, not the adjacent row');map.render();assert.deepEqual(selected,['a']);assert.equal(jobs.size,0);assert(![...gl.live.values()].includes('createQuery'));
 // Physical picking converts top-origin CSS pixels before inverting device Y, including top row.
 gl.g.drawingBufferHeight=1400;gl.g.drawingBufferWidth=2000;map.fire('click',{point:{x:500,y:297}});map.render();assert.equal(gl.calls.filter(c=>c[0]==='scissor'&&c[3]===1&&c[4]===1).at(-1)[2],805);map.fire('movestart');
 scene.setSigns([{...sign,coordinates:[0,84.8]}]);map.render();map.fire('click',{point:{x:500,y:0}});map.render();assert.equal(gl.calls.filter(c=>c[0]==='scissor'&&c[3]===1&&c[4]===1).at(-1)[2],1399,'top CSS row is valid at DPR2');map.fire('movestart');scene.setSigns([sign]);gl.g.drawingBufferHeight=700;gl.g.drawingBufferWidth=1000;map.render();
 gl.ready(false);map.fire('click',{point:{x:500,y:297}});map.render();map.fire('movestart');gl.ready(true);map.render();assert.deepEqual(selected,['a'],'camera revision cancels pending GPU results');assert.equal(jobs.size,0);
 map.fire('click',{point:{x:500,y:297}});map.render();scene.setSigns([{...sign,key:'b'}]);map.render();assert.deepEqual(selected,['a'],'snapshot revision cancels old identity');
 map.fire('click',{point:{x:500,y:297}});map.render();now=251;map.render();assert.equal(jobs.size,0);assert.deepEqual(selected,['a'],'timeout fails closed');
 map.zoom(16);map.render();const onset={point:{x:500,y:297}};map.fire('click',onset);assert(!onset.egiStopPicked);map.zoom(18);
 scene.setVehicles([{id:'v',coordinates:[0,0],bearing:45,old:false}]);map.render();scene.setSigns([]);map.render();assert.equal(gl.calls.filter(c=>c[0]==='drawArraysInstanced').at(-1).at(-1),1,'clearing signs retains vehicles');
 // A lost context invalidates handles without calling into invalid GL; MapLibre reloads its style.
 gl.live.clear();map.fire('webglcontextlost');map.layers.clear();map.fire('webglcontextrestored');map.fire('style.load');map.render();assert.equal(map.layers.size,1);
 scene.dispose();scene.dispose();assert.equal(gl.live.size,0,'owned resources deleted after restore and disposal');assert([...map.events.values()].every(set=>set.size===0));assert.equal(jobs.size,0);
 for(let i=0;i<20;i++){const owner=createTransportScene(options);await new Promise(setImmediate);owner.setSigns([sign]);map.render();owner.dispose();assert.equal(gl.live.size,0);}
 const unsupported=context(),unsupportedMap=mapFixture(unsupported.g);const unsupportedScene=createTransportScene({...options,map:unsupportedMap});await new Promise(setImmediate);unsupportedMap.getProjection=()=>({type:'globe'});unsupportedMap.render();await new Promise(setImmediate);assert.equal(unsupportedScene.setSigns([sign]),false,'projection changes fail to native recovery');unsupportedScene.dispose();assert.equal(unsupported.live.size,0);
 const broken=context();broken.g.failShader=true;const badMap=mapFixture(broken.g);const bad=createTransportScene({...options,map:badMap});await new Promise(setImmediate);await new Promise(setImmediate);assert.equal(bad.setSigns([sign]),false);assert.equal(broken.live.size,0,'shader failure cleans partial allocations');bad.dispose();
 console.log('PASS: shared geometry, exact identity, zero camera uploads, query cancellation/timeout, independent clearing, GL recovery/failure and20 clean cycles');
})().catch(error=>{console.error(error);process.exitCode=1});
