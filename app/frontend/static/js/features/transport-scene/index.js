import {ATLAS_URL,SIGN_SCALE,signMeshes,busMesh} from './geometry.js';
import {signCandidates} from './picking.js';
import {nativeProgress} from '../transport/paline-gl.js';
/** One map-owned WebGL2 scene for physical signs and observed buses; data/popup ownership stays upstream. */
export const SCENE_ID='egi-transport-scene',SCENE_STATUS='egi:transport-scene';
const VERTEX=`#version 300 es
precision highp float;
layout(location=0) in vec3 position;layout(location=1) in vec3 color;layout(location=2) in vec2 uv;
layout(location=3) in vec4 anchor;layout(location=4) in vec4 info;
uniform mat4 matrix;uniform float bearing;uniform float progress;uniform int kind;
out vec3 tint;out vec2 panel;out float opacity;
void main(){bool sign=kind<2;float angle=sign?(kind==1?bearing:0.):info.x;
 float scale=anchor.w*(sign?${SIGN_SCALE.toFixed(1)}*progress:1.);vec3 p=position*scale;
 p.xy=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*p.xy;p+=anchor.xyz;
 gl_Position=matrix*vec4(p,1.);tint=color;panel=vec2(.75,.75);opacity=info.z*(sign?progress:1.);
 if(sign){vec3 pole=info.y<.5?vec3(.96,.81,.21):info.y<1.5?vec3(.125,.36,.267):vec3(.26,.29,.30);
  if(kind==0)tint=mix(pole,vec3(1.,.83,.25),info.w*.5);
  else {bool front=uv.x<=1.&&uv.y<=1.;if(!front)tint=pole;if(front)panel=vec2((uv.x+ (info.y>.5&&info.y<1.5?1.:0.))*.5,(uv.y+(info.y>1.5?1.:0.))*.5);}
 }
}`;
const FRAGMENT=`#version 300 es
precision highp float;in vec3 tint;in vec2 panel;in float opacity;uniform sampler2D atlas;uniform float weight;out vec4 frag;
void main(){float a=opacity*weight;if(a<=0.)discard;vec3 c=tint*texture(atlas,panel).rgb;frag=vec4(c*a,a);}`;

/** Read the SVG once per scene; no fonts, model loader or external asset acquisition. */
function atlasImage(){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('transport atlas unavailable'));image.src=ATLAS_URL;});}
/** Capture/restore only the GL state this module changes; never clear/resize the shared map framebuffer. */
function stateOf(g,{upload=false,picking=false}={}){
 const active=g.getParameter(g.ACTIVE_TEXTURE);g.activeTexture(g.TEXTURE0);const texture=g.getParameter(g.TEXTURE_BINDING_2D);g.activeTexture(active);
 const state={program:g.getParameter(g.CURRENT_PROGRAM),vao:g.getParameter(g.VERTEX_ARRAY_BINDING),buffer:g.getParameter(g.ARRAY_BUFFER_BINDING),active,texture,cull:g.isEnabled(g.CULL_FACE),write:g.getParameter(g.DEPTH_WRITEMASK)};
 if(upload)state.flip=g.getParameter(g.UNPACK_FLIP_Y_WEBGL);
 if(picking){state.scissor=g.isEnabled(g.SCISSOR_TEST);state.box=g.getParameter(g.SCISSOR_BOX);state.mask=g.getParameter(g.COLOR_WRITEMASK);}
 return state;
}
function restore(g,s){g.useProgram(s.program);g.bindVertexArray(s.vao);g.bindBuffer(g.ARRAY_BUFFER,s.buffer);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,s.texture);g.activeTexture(s.active);
 s.cull?g.enable(g.CULL_FACE):g.disable(g.CULL_FACE);g.depthMask(s.write);
 if(s.flip!==undefined)g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,s.flip);
 if(s.mask){s.scissor?g.enable(g.SCISSOR_TEST):g.disable(g.SCISSOR_TEST);g.scissor(...s.box);g.colorMask(...s.mask);}
}
/** Shared scene interface: replacement snapshots, independent owner clearing and idempotent full disposal. */
export function createTransportScene({map,maplibre,onStopSelect=()=>{},loadAtlas=atlasImage,clock=()=>performance.now(),delay=setTimeout,undelay=clearTimeout}){
 let disposed=false,failed=false,ready=false,image=null,gpu=null,lost=false,matrix=null,pending=null,revision=0;
 let signs=[],vehicles=[],signKey='',vehicleKey='',signDirty=true,vehicleDirty=true;
 const origin=maplibre.MercatorCoordinate.fromLngLat(map.getCenter()),unit=origin.meterInMercatorCoordinateUnits();
 const geometry=signMeshes(),meshes=[geometry.pole,geometry.board,busMesh(),busMesh(true)],cleanup=[];
 const notify=()=>map.fire?.(SCENE_STATUS,{available:ready&&!failed&&!disposed});
 const own=(name,fn)=>{map.on(name,fn);cleanup.push(()=>map.off(name,fn));};
 function cancelPick(){revision++;if(!pending)return;undelay(pending.timer);if(gpu)for(const q of pending.queries||[])gpu.g.deleteQuery(q.query);pending=null;}
 function release(){if(!gpu)return;const {g,program,texture,instance,pick,batches}=gpu;
  for(const b of batches){g.deleteBuffer(b.buffer);g.deleteVertexArray(b.vao);}g.deleteBuffer(instance[0]);g.deleteBuffer(instance[1]);g.deleteBuffer(pick);g.deleteTexture(texture);g.deleteProgram(program);gpu=null;
 }
 function fail(){if(disposed||failed)return;failed=true;ready=false;cancelPick();release();if(map.getLayer?.(SCENE_ID))map.removeLayer(SCENE_ID);notify();}
 function local(record){const c=maplibre.MercatorCoordinate.fromLngLat(record.coordinates);return {...record,x:(c.x-origin.x)/unit,y:(c.y-origin.y)/unit,z:0,scale:c.meterInMercatorCoordinateUnits()/unit};}
 function replace(records,type){
  if(disposed)return false;const keyed=new Map();for(const r of records){const key=String(type==='sign'?r.key:r.id);if(!Array.isArray(r.coordinates)||!r.coordinates.every(Number.isFinite))continue;keyed.set(key,{...r,key});}
  const values=[...keyed.values()],encoded=JSON.stringify(values);
  if(type==='sign'){if(encoded!==signKey){signKey=encoded;signs=values.map(local);signDirty=true;cancelPick();map.triggerRepaint?.();}}
  else if(encoded!==vehicleKey){vehicleKey=encoded;vehicles=values.map(local);vehicleDirty=true;cancelPick();map.triggerRepaint?.();}
  return ready&&!failed;
 }
 function compile(g,type,source){const shader=g.createShader(type);g.shaderSource(shader,source);g.compileShader(shader);if(!g.getShaderParameter(shader,g.COMPILE_STATUS)){g.deleteShader(shader);throw Error('transport shader');}return shader;}
 function initialize(g){
  if(gpu||disposed||failed||!image||g.isContextLost())return;
  if(!g.createQuery||(map.getProjection?.()?.type||'mercator')!=='mercator')throw Error('unsupported transport context/projection');
  const saved=stateOf(g,{upload:true}),created=[];let vs=null,fs=null;
  try{vs=compile(g,g.VERTEX_SHADER,VERTEX);fs=compile(g,g.FRAGMENT_SHADER,FRAGMENT);const program=g.createProgram();created.push(()=>g.deleteProgram(program));
   g.attachShader(program,vs);g.attachShader(program,fs);g.linkProgram(program);if(!g.getProgramParameter(program,g.LINK_STATUS))throw Error('transport program');
   const instance=[g.createBuffer(),g.createBuffer()],pick=g.createBuffer();for(const b of [...instance,pick])created.push(()=>g.deleteBuffer(b));
   const batches=meshes.map(mesh=>{const buffer=g.createBuffer(),vao=g.createVertexArray();created.push(()=>{g.deleteBuffer(buffer);g.deleteVertexArray(vao);});g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,buffer);g.bufferData(g.ARRAY_BUFFER,mesh,g.STATIC_DRAW);
    for(const [index,size,offset] of [[0,3,0],[1,3,12],[2,2,24]]){g.enableVertexAttribArray(index);g.vertexAttribPointer(index,size,g.FLOAT,false,32,offset);}return {buffer,vao,count:mesh.length/8};});
   const texture=g.createTexture();created.push(()=>g.deleteTexture(texture));g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,texture);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,false);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,image);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR_MIPMAP_LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.generateMipmap(g.TEXTURE_2D);
   gpu={g,program,texture,instance,pick,batches,uniforms:Object.fromEntries(['matrix','bearing','progress','kind','weight','atlas'].map(n=>[n,g.getUniformLocation(program,n)])),counts:[0,0]};signDirty=vehicleDirty=true;ready=true;lost=false;notify();
  }catch(error){for(const dispose of created.reverse())dispose();throw error;}finally{if(vs)g.deleteShader(vs);if(fs)g.deleteShader(fs);restore(g,saved);}
 }
 function packed(records){const data=new Float32Array(records.length*8);records.forEach((r,i)=>data.set([r.x,r.y,r.z,r.scale,(r.bearing||0)*Math.PI/180,{bus:0,tram:1,metro:2}[r.mode]??3,r.old ? .3 : 1,r.focused?1:0],i*8));return data;}
 function bindInstance(g,buffer){g.bindBuffer(g.ARRAY_BUFFER,buffer);for(const [index,offset] of [[3,0],[4,16]]){g.enableVertexAttribArray(index);g.vertexAttribPointer(index,4,g.FLOAT,false,32,offset);g.vertexAttribDivisor(index,1);}}
 function draw(g,kind,buffer,count,weight=1){if(!count||weight<=0)return;const b=gpu.batches[kind];g.bindVertexArray(b.vao);bindInstance(g,buffer);g.uniform1i(gpu.uniforms.kind,kind);g.uniform1f(gpu.uniforms.weight,weight);g.drawArraysInstanced(g.TRIANGLES,0,b.count,count);}
 function pickFrame(g){
  if(!pending)return;const p=pending;if(clock()>p.deadline||++p.frames>8){cancelPick();return;}
  if(p.queries){if(!p.queries.every(q=>g.getQueryParameter(q.query,g.QUERY_RESULT_AVAILABLE))){map.triggerRepaint();return;}
   const winner=p.queries.find(q=>g.getQueryParameter(q.query,g.QUERY_RESULT));const key=winner?.record.key;cancelPick();if(key)onStopSelect(key);return;
  }
  const c=map.getContainer(),x=Math.floor(p.point.x*g.drawingBufferWidth/c.clientWidth),y=Math.floor((c.clientHeight-p.point.y)*g.drawingBufferHeight/c.clientHeight);
  if(x<0||y<0||x>=g.drawingBufferWidth||y>=g.drawingBufferHeight){cancelPick();return;}
  g.enable(g.SCISSOR_TEST);g.scissor(x,y,1,1);g.colorMask(false,false,false,false);g.depthMask(false);p.queries=[];
  for(const {record} of p.candidates){const query=g.createQuery();g.bindBuffer(g.ARRAY_BUFFER,gpu.pick);g.bufferData(g.ARRAY_BUFFER,packed([record]),g.STREAM_DRAW);g.beginQuery(g.ANY_SAMPLES_PASSED,query);draw(g,0,gpu.pick,1);draw(g,1,gpu.pick,1);g.endQuery(g.ANY_SAMPLES_PASSED);p.queries.push({query,record});}
  g.disable(g.SCISSOR_TEST);g.colorMask(true,true,true,true);map.triggerRepaint();
 }
 const layer={id:SCENE_ID,type:'custom',renderingMode:'3d',onAdd(m,g){try{initialize(g);}catch(error){queueMicrotask(fail);}},
  render(g,args){if(disposed||failed||lost)return;try{initialize(g);if(!gpu)return;const saved=stateOf(g,{picking:Boolean(pending&&!pending.queries)});
   try{const m=args.defaultProjectionData.mainMatrix;matrix=new Float64Array(m);for(let r=0;r<4;r++){matrix[12+r]=m[12+r]+m[r]*origin.x+m[4+r]*origin.y;matrix[r]*=unit;matrix[4+r]*=unit;matrix[8+r]*=unit;}
    g.useProgram(gpu.program);g.uniformMatrix4fv(gpu.uniforms.matrix,false,new Float32Array(matrix));g.uniform1f(gpu.uniforms.bearing,map.getBearing()*Math.PI/180);g.uniform1f(gpu.uniforms.progress,nativeProgress(map.getZoom()));
    g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,gpu.texture);g.uniform1i(gpu.uniforms.atlas,0);// MapLibre's public 3D custom-layer contract supplies depth/blending. Only touched state is restored.
    g.disable(g.CULL_FACE);g.depthMask(false);
    for(const [i,dirty,records] of [[0,signDirty,signs],[1,vehicleDirty,vehicles]])if(dirty){g.bindBuffer(g.ARRAY_BUFFER,gpu.instance[i]);g.bufferData(g.ARRAY_BUFFER,packed(records),g.DYNAMIC_DRAW);gpu.counts[i]=records.length;}signDirty=vehicleDirty=false;
    pickFrame(g);g.depthMask(true);draw(g,0,gpu.instance[0],gpu.counts[0]);draw(g,1,gpu.instance[0],gpu.counts[0]);const near=Math.max(0,Math.min(1,(map.getZoom()-15.5)*2));draw(g,2,gpu.instance[1],gpu.counts[1],near);draw(g,3,gpu.instance[1],gpu.counts[1],1-near);
   }finally{restore(g,saved);}
  }catch(error){queueMicrotask(fail);}},onRemove(){ready=false;cancelPick();release();}};
 function ensure(){if(disposed||failed||lost||!image||map.isStyleLoaded?.()===false||map.getLayer?.(SCENE_ID))return;
  try{map.addLayer(layer,map.getStyle().layers.find(l=>l.type==='symbol')?.id);}catch(error){fail();}}
 function click(event){if(!ready||disposed||event.egiReferencePicked||event.egiStopPicked||!event.point||!matrix)return;cancelPick();const c=map.getContainer(),candidates=signCandidates(signs,meshes.slice(0,2),matrix,map.getBearing(),nativeProgress(map.getZoom()),event.point,c.clientWidth,c.clientHeight);if(!candidates.length)return;
  event.egiStopPicked=true;const token=revision;pending={candidates,point:event.point,frames:0,deadline:clock()+250,timer:delay(()=>{if(revision===token)cancelPick();},250)};map.triggerRepaint();}
 own('click',click);for(const event of ['movestart','resize','styledata'])own(event,cancelPick);own('style.load',()=>{cancelPick();ensure();});own('idle',ensure);own('load',ensure);
 own('webglcontextlost',()=>{cancelPick();gpu=null;ready=false;lost=true;notify();});own('webglcontextrestored',()=>{lost=false;ensure();});
 const visibility=()=>{if(globalThis.document?.hidden)cancelPick();};globalThis.document?.addEventListener('visibilitychange',visibility);cleanup.push(()=>globalThis.document?.removeEventListener('visibilitychange',visibility));
 Promise.resolve().then(loadAtlas).then(value=>{if(disposed)return;image=value;ensure();}).catch(fail);
 return {setSigns:records=>replace(records,'sign'),setVehicles:records=>replace(records,'vehicle'),dispose(){if(disposed)return;disposed=true;ready=false;cancelPick();for(const clean of cleanup.splice(0))clean();if(map.getLayer?.(SCENE_ID))map.removeLayer(SCENE_ID);release();signs=[];vehicles=[];image=null;}};
}
