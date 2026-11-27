/** Immutable bridge artifact validation and bounded decoded response handling. */
export const MODEL='continuous-bridges-v1', MAX_CHUNKS=8, MAX_GPU=8*1024*1024;
export const MAX_DECODED=2*1024*1024, MAX_COMPRESSED=256*1024;
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const bounds=value=>Array.isArray(value)&&value.length===4&&value.every(finite)&&value[0]<=value[2]&&value[1]<=value[3]&&value[0]>=-180&&value[2]<=180&&value[1]>=-85&&value[3]<=85;
const positive=value=>Number.isSafeInteger(value)&&value>0;
export function requireValid(condition,message){if(!condition)throw Error(message);}
export function validateIndex(value,version){
 requireValid(value?.format===1&&value.model===MODEL&&value.dataset===version&&hash(value.meshRevision),'Unsupported bridge index');
 const frame=value.frame;
 requireValid(frame?.units==='metres'&&JSON.stringify(frame.origin)==='[12.5,41.9]'&&Array.isArray(frame.scale)&&frame.scale.length===2&&Math.abs(frame.scale[0]-82856.76132645206)<1e-8&&frame.scale[1]===111320,'Unsupported bridge frame');
 requireValid(value.inputs&&Object.keys(value.inputs).length&&Array.isArray(value.chunks)&&value.chunks.length<=4096,'Invalid bridge provenance/chunks');
 for(const input of Object.values(value.inputs))requireValid(typeof input?.capture==='string'&&hash(input.sha256),'Invalid bridge capture hash');
 const ids=new Set(),bridges=new Set();
 for(const chunk of value.chunks){
  requireValid(typeof chunk.id==='string'&&!ids.has(chunk.id)&&/^\d+-\d+-[0-9a-f]{16}\.json\.gz$/.test(chunk.url)&&hash(chunk.sha256)&&bounds(chunk.bounds),'Invalid bridge chunk');
  requireValid(positive(chunk.bytes)&&chunk.bytes<=MAX_DECODED&&positive(chunk.gzipBytes)&&chunk.gzipBytes<=MAX_COMPRESSED&&Array.isArray(chunk.bridges)&&chunk.bridges.length>0,'Oversized/empty bridge chunk');
  ids.add(chunk.id);
  for(const id of chunk.bridges){requireValid(typeof id==='string'&&/^[0-9a-f]{16}$/.test(id)&&!bridges.has(id),'Duplicate bridge');bridges.add(id);}
 }
 return value;
}
export function validateChunk(value,chunk,index){
 requireValid(value?.format===index.format&&value.model===index.model&&value.dataset===index.dataset&&JSON.stringify(value.frame)===JSON.stringify(index.frame),'Mixed bridge version/frame');
 requireValid(Array.isArray(value.bridges)&&JSON.stringify(value.bridges.map(b=>b.id))===JSON.stringify(chunk.bridges),'Incomplete bridge coverage');
 let bytes=0;
 for(const bridge of value.bridges){
  const {vertices,indices}=bridge;
  requireValid(Array.isArray(vertices)&&vertices.length>0&&vertices.length%4===0&&vertices.every(finite)&&Array.isArray(indices)&&indices.length>0&&indices.length%3===0,'Invalid bridge buffers');
  requireValid(bounds(bridge.bounds)&&bridge.bounds[0]>=chunk.bounds[0]&&bridge.bounds[1]>=chunk.bounds[1]&&bridge.bounds[2]<=chunk.bounds[2]&&bridge.bounds[3]<=chunk.bounds[3],'Clipped bridge bounds');
  requireValid(Array.isArray(bridge.sourceWayIds)&&bridge.sourceWayIds.length>0&&bridge.sourceWayIds.every(positive)&&bridge.height?.method==='existing-inferred-ramp-v1'&&positive(bridge.height.layer)&&typeof bridge.height.wet==='boolean'&&finite(bridge.height.midspanUnderside),'Invalid bridge provenance');
  requireValid(Array.isArray(bridge.line)&&bridge.line.length>=2&&bridge.line.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite))&&Array.isArray(bridge.profile)&&bridge.profile.length>=2&&bridge.profile.every(p=>p.length===2&&p.every(finite)),'Invalid bridge centerline/profile');
  const [lon,lat]=index.frame.origin,[kx,ky]=index.frame.scale;
  for(let i=0;i<vertices.length;i+=4){
   const x=lon+vertices[i]/kx,y=lat+vertices[i+1]/ky;
   requireValid([0,1,2].includes(vertices[i+3])&&x>=bridge.bounds[0]-1e-10&&x<=bridge.bounds[2]+1e-10&&y>=bridge.bounds[1]-1e-10&&y<=bridge.bounds[3]+1e-10,'Invalid bridge coordinate/material');
  }
  requireValid(indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<vertices.length/4),'Invalid bridge triangle index');
  bytes+=vertices.length*4+indices.length*4;
 }
 requireValid(bytes<=MAX_GPU,'Oversized bridge GPU buffers');
 return bytes;
}
export async function readChecked(response,entry,signal){
 requireValid(response.ok,'Bridge asset unavailable');
 requireValid(positive(entry.bytes)&&entry.bytes<=MAX_DECODED,'Oversized decoded bridge asset');
 const reader=response.body.getReader(),pieces=[];let length=0;
 try{
  while(true){
   if(signal.aborted)throw new DOMException('Aborted','AbortError');
   const {done,value}=await reader.read();if(done)break;
   length+=value.byteLength;requireValid(length<=entry.bytes,'Oversized bridge response');pieces.push(value);
  }
 }catch(error){await reader.cancel();throw error;}
 requireValid(length===entry.bytes,'Truncated bridge response');
 const body=new Uint8Array(length);let offset=0;for(const part of pieces){body.set(part,offset);offset+=part.length;}
 const start=performance.now(),digest=await crypto.subtle.digest('SHA-256',body);
 const sha=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
 requireValid(sha===entry.sha256,'Bridge checksum mismatch');
 return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)),start};
}
