/** Map-owned continuous bridges: bounded atomic admission, native fallback and recovery. */
import {layers3d,NATIVE_BRIDGES} from './style.js';
import {MAX_CHUNKS,MAX_GPU,validateIndex,validateChunk,readChecked,requireValid} from './bridge-data.js';
const ID='egi-continuous-bridges';
const V=`#version 300 es
precision highp float;layout(location=0)in vec3 position;layout(location=1)in float material;
uniform mat4 matrix;uniform float grow;uniform float parapets;out vec3 world;flat out int mat;
void main(){mat=int(material);vec3 p=position;p.z*=mat==1?parapets:grow;gl_Position=matrix*vec4(p,1.);world=p;mat=int(material);if(mat==1&&parapets<.001)gl_Position=vec4(2,2,2,1);}`;
const F=`#version 300 es
precision highp float;in vec3 world;flat in int mat;out vec4 frag;
void main(){vec3 n=normalize(cross(dFdx(world),dFdy(world)));vec3 c=mat==0?vec3(.945,.925,.886):mat==1?vec3(.839,.788,.682):vec3(.796,.749,.651);float light=.6+.4*abs(dot(n,normalize(vec3(.3,-.4,.85))));frag=vec4(c*light,1.);}`;

export function createBridgeScene({map,maplibre,base,version,descriptor,onVersionConflict=()=>{},fetcher=globalThis.fetch.bind(globalThis)}){
 let index=null,gl=null,program=null,uniforms=null,ready=false,disposed=false,generation=0,controller=null,error=null,conflict=false,gpuBytes=0;
 let admitted=[],pendingUploads=null,signature='',restoring=false,versionController=null;
 const cpu=[],loads=[];
 const origin=maplibre.MercatorCoordinate.fromLngLat([12.5,41.9]),unit=origin.meterInMercatorCoordinateUnits();
 const now=()=>performance.now();
 function release(entry){
  if(!entry.gpu)return;
  if(gl&&!gl.isContextLost()){gl.deleteBuffer(entry.gpu.v);gl.deleteBuffer(entry.gpu.i);gl.deleteVertexArray(entry.gpu.vao);}
  gpuBytes-=entry.gpu.bytes;entry.gpu=null;
 }
 function clear(){for(const entry of admitted)release(entry);admitted=[];}
 function plan(show){if(map.getLayer('bridge-plan'))map.setPaintProperty('bridge-plan','fill-opacity',show?1:['interpolate',['linear'],['zoom'],13,1,14,0]);}
 function native(show){
  for(const id of NATIVE_BRIDGES)if(map.getLayer(id)&&map.getLayoutProperty(id,'visibility')!==(show?'visible':'none'))map.setLayoutProperty(id,'visibility',show?'visible':'none');
 }
 function fallback(){
  ready=false;
  if(!map.isStyleLoaded()||disposed)return;
  if(!map.getSource('bridge-native')){
   const extra=layers3d(base);
   map.addSource('bridge-native',extra.sources.bridges);
   const before=map.getStyle().layers.find(l=>l.type==='symbol')?.id;
   for(const layer of extra.layers.filter(l=>NATIVE_BRIDGES.includes(l.id)))map.addLayer({...layer,source:'bridge-native'},before);
  }
  native(true);
 }
 function shader(type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(message);}
  return shader;
 }
 function initialize(){
  const shaders=[];
  try{
   shaders.push(shader(gl.VERTEX_SHADER,V));shaders.push(shader(gl.FRAGMENT_SHADER,F));
   program=gl.createProgram();for(const shader of shaders)gl.attachShader(program,shader);gl.linkProgram(program);
   requireValid(gl.getProgramParameter(program,gl.LINK_STATUS),'Bridge shader link failed');
   uniforms=Object.fromEntries(['matrix','grow','parapets'].map(key=>[key,gl.getUniformLocation(program,key)]));
  }catch(cause){if(program)gl.deleteProgram(program);program=null;throw cause;}
  finally{for(const shader of shaders)gl.deleteShader(shader);}
 }
 function upload(entry){
  const start=now(),data=entry.data,values=[],indices=[];
  for(const bridge of data.bridges){
   const offset=values.length/4,a=bridge.vertices;
   for(let j=0;j<a.length;j+=4){
    const ll=[data.frame.origin[0]+a[j]/data.frame.scale[0],data.frame.origin[1]+a[j+1]/data.frame.scale[1]];
    const c=maplibre.MercatorCoordinate.fromLngLat(ll,a[j+2]);
    values.push((c.x-origin.x)/unit,(c.y-origin.y)/unit,c.z/unit,a[j+3]);
   }
   for(const value of bridge.indices)indices.push(offset+value);
  }
  const v=gl.createBuffer(),i=gl.createBuffer(),vao=gl.createVertexArray();
  entry.gpu={v,i,vao,count:indices.length,bytes:values.length*4+indices.length*4};gpuBytes+=entry.gpu.bytes;
  requireValid(v&&i&&vao,'Bridge GPU allocation failed');
  gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,1,gl.FLOAT,false,16,12);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,i);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(indices),gl.STATIC_DRAW);
  requireValid(gl.getBufferParameter(gl.ARRAY_BUFFER,gl.BUFFER_SIZE)===values.length*4&&gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER,gl.BUFFER_SIZE)===indices.length*4,'Bridge GPU upload failed');
  entry.uploadMs=now()-start;if(loads.length<600)loads.push({id:entry.id,admissionMs:entry.parseMs+entry.uploadMs,uploadMs:entry.uploadMs});
 }
 async function recoverVersion(){
  if(conflict||disposed)return;
  conflict=true;versionController=new AbortController();
  try{
   const response=await fetcher('/map3d/active',{cache:'no-store',signal:versionController.signal});
   const current=await response.json();
   if(!disposed&&current.availability==='available'&&current.version!==version){generation++;controller.abort();onVersionConflict(current);}
  }catch{/* Complete same-version fallback remains available. */}
  finally{conflict=false;}
 }
 function visible(){
  const b=map.getBounds();
  return index.chunks.filter(c=>c.bounds[2]>=b.getWest()&&c.bounds[0]<=b.getEast()&&c.bounds[3]>=b.getSouth()&&c.bounds[1]<=b.getNorth());
 }
 async function sync(force=false){
  if(disposed||!index||gl?.isContextLost()||!map.getStyle()?.layers)return;
  const wanted=map.getZoom()>=14?visible():[],key=wanted.map(c=>c.id).join(',');
  if(!force&&key===signature)return;
  signature=key;const token=++generation;controller?.abort();controller=new AbortController();
  pendingUploads=null;ready=false;native(true);plan(true);
  const keys=new Set(wanted.map(c=>c.id));
  for(const entry of admitted)if(!keys.has(entry.id))release(entry);
  admitted=admitted.filter(entry=>keys.has(entry.id));
  if(!wanted.length){clear();return;}
  if(wanted.length>MAX_CHUNKS){clear();error='Visible bridge chunk budget exceeded';fallback();return;}
  const signal=controller.signal;
  try{
   const candidates=await Promise.all(wanted.map(async chunk=>{
    const cached=admitted.find(entry=>entry.id===chunk.id);if(cached)return cached;
    const response=await fetcher(`${base}/bridge-mesh/${chunk.url}`,{signal});
    const {data,start}=await readChecked(response,chunk,signal);
    const bytes=validateChunk(data,chunk,index);
    return {id:chunk.id,data,bytes,gpu:null,parseMs:now()-start};
   }));
   if(disposed||generation!==token)return;
   requireValid(candidates.reduce((n,e)=>n+e.bytes,0)<=MAX_GPU,'Visible bridge GPU budget exceeded');
   clear();admitted=candidates.map(entry=>({...entry,gpu:null}));pendingUploads=token;error=null;map.triggerRepaint();
  }catch(cause){
   if(disposed||generation!==token||cause.name==='AbortError')return;
   error=String(cause);controller.abort();clear();fallback();void recoverVersion();
  }
 }
 const layer={id:ID,type:'custom',renderingMode:'3d',
  onAdd(m,g){gl=g;},
  render(g,args){
   if(disposed||g.isContextLost()||!index||(!ready&&pendingUploads===null&&(!restoring||!admitted.length)))return;
   const start=now(),saved={program:g.getParameter(g.CURRENT_PROGRAM),vao:g.getParameter(g.VERTEX_ARRAY_BINDING),buffer:g.getParameter(g.ARRAY_BUFFER_BINDING),cull:g.isEnabled(g.CULL_FACE)};
   try{
    if(!program)initialize();
    if(pendingUploads!==null||restoring){
     for(const entry of admitted)if(!entry.gpu)upload(entry);
     if(pendingUploads!==null&&pendingUploads!==generation)return;
     pendingUploads=null;restoring=false;ready=true;native(false);plan(false);
    }
    if(!ready||map.getZoom()<14)return;
    g.useProgram(program);g.disable(g.CULL_FACE);
    const world=args.defaultProjectionData.mainMatrix,matrix=new Float32Array(world);
    for(let row=0;row<4;row++){
     matrix[row]=world[row]*unit;matrix[4+row]=world[4+row]*unit;matrix[8+row]=world[8+row]*unit;
     matrix[12+row]=world[row]*origin.x+world[4+row]*origin.y+world[8+row]*origin.z+world[12+row];
    }
    g.uniformMatrix4fv(uniforms.matrix,false,matrix);g.uniform1f(uniforms.grow,Math.max(0,Math.min(1,(map.getZoom()-14)/1.5)));
    g.uniform1f(uniforms.parapets,Math.max(0,Math.min(1,(map.getZoom()-16)/.5)));
    for(const entry of admitted){g.bindVertexArray(entry.gpu.vao);g.drawElements(g.TRIANGLES,entry.gpu.count,g.UNSIGNED_INT,0);}
   }catch(cause){error=String(cause);pendingUploads=null;restoring=false;clear();fallback();}
   finally{
    g.useProgram(saved.program);g.bindVertexArray(saved.vao);g.bindBuffer(g.ARRAY_BUFFER,saved.buffer);
    saved.cull?g.enable(g.CULL_FACE):g.disable(g.CULL_FACE);
    if(pendingUploads===null&&ready&&cpu.length<600)cpu.push(now()-start);
   }
  },
  onRemove(){clear();ready=false;pendingUploads=null;signature='';restoring=!disposed;if(program&&!gl.isContextLost())gl.deleteProgram(program);program=null;}
 };
 function attach(){
  if(disposed||!map.isStyleLoaded()||gl?.isContextLost())return;
  if(!map.getLayer(ID))map.addLayer(layer,map.getStyle().layers.find(l=>l.type==='symbol')?.id);
 }
 function moved(){void sync();}
 function lost(){
  generation++;controller?.abort();pendingUploads=null;ready=false;program=null;restoring=true;signature='';
  for(const entry of admitted)entry.gpu=null;gpuBytes=0;
 }
 function restored(){attach();if(admitted.length){restoring=true;map.triggerRepaint();}else {restoring=false;void sync(true);}}
 function styleReady(){if(!map.isStyleLoaded())return;attach();if(error)fallback();else if(restoring)restored();else void sync();}
 map.on('move',moved);map.on('moveend',moved);map.on('style.load',styleReady);map.on('idle',styleReady);
 map.getCanvas().addEventListener('webglcontextlost',lost);map.getCanvas().addEventListener('webglcontextrestored',restored);
 const initialized=(async()=>{
  controller=new AbortController();
  try{
   requireValid(descriptor.gzipBytes<=64*1024,'Oversized bridge index');
   const response=await fetcher(`${base}/${descriptor.url}`,{signal:controller.signal});
   const {data}=await readChecked(response,descriptor,controller.signal);
   if(disposed)return;
   index=validateIndex(data,version);attach();await sync(true);
  }catch(cause){if(disposed||cause.name==='AbortError')return;error=String(cause);fallback();void recoverVersion();}
 })();
 return {
  initialized,retry:()=>sync(true),
  stats:()=>({ready,error,chunks:admitted.length,gpuBytes,draws:ready?admitted.length:0,cpu:[...cpu],loads:[...loads],revision:index?.meshRevision}),
  dispose(){
   disposed=true;generation++;controller?.abort();versionController?.abort();pendingUploads=null;
   map.off('move',moved);map.off('moveend',moved);map.off('style.load',styleReady);map.off('idle',styleReady);
   map.getCanvas().removeEventListener('webglcontextlost',lost);map.getCanvas().removeEventListener('webglcontextrestored',restored);
   if(map.getLayer(ID))map.removeLayer(ID);else clear();
  }
 };
}
