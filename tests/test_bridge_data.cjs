/** Product artifact contracts reject corruption, truncation and unsupported/bounded geometry. */
const assert=require('node:assert/strict');
(async()=>{
 const {validateIndex,validateChunk,readChecked}=await import('../app/frontend/static/js/features/map3d/bridge-data.js');
 const frame={origin:[12.5,41.9],scale:[82856.76132645206,111320],units:'metres'};
 const chunk={id:'1-2',url:'1-2-0123456789abcdef.json.gz',sha256:'a'.repeat(64),bytes:1024,gzipBytes:512,bounds:[12,41,13,42],bridges:['0123456789abcdef']};
 const index={format:1,model:'continuous-bridges-v1',dataset:'20261127T120000Z',meshRevision:'a'.repeat(64),frame,inputs:{osm:{capture:'retained',sha256:'b'.repeat(64)}},chunks:[chunk]};
 assert.equal(validateIndex(index,index.dataset),index);
 for(const invalid of [{...index,format:2},{...index,dataset:'old'},{...index,frame:{...frame,scale:[1,1]}},{...index,chunks:[chunk,chunk]},{...index,chunks:[{...chunk,url:'../secret'}]},{...index,chunks:[{...chunk,bytes:2*1024*1024+1}]}])assert.throws(()=>validateIndex(invalid,index.dataset));
 const bridge={id:chunk.bridges[0],sourceWayIds:[1],height:{method:'existing-inferred-ramp-v1',layer:1,wet:true,midspanUnderside:6},line:[[12.5,41.9],[12.5001,41.9]],profile:[[0,0],[10,0]],bounds:chunk.bounds,vertices:[0,0,0,0,1,0,0,0,1,1,0,0],indices:[0,1,2]};
 const data={format:1,model:index.model,dataset:index.dataset,frame,bridges:[bridge]};
 assert.equal(validateChunk(data,chunk,index),60);
 for(const invalid of [{...data,dataset:'old'},{...data,bridges:[]},{...data,bridges:[{...bridge,indices:[0,1,3]}]},{...data,bridges:[{...bridge,sourceWayIds:[]}]},{...data,bridges:[{...bridge,vertices:[NaN,0,0,0]}]}])assert.throws(()=>validateChunk(invalid,chunk,index));
 const body=Buffer.from(JSON.stringify({test:'valid'})),sha256=require('node:crypto').createHash('sha256').update(body).digest('hex'),entry={bytes:body.length,sha256};
 const signal=new AbortController().signal;
 assert.deepEqual((await readChecked(new globalThis.Response(body),entry,signal)).data,{test:'valid'});
 await assert.rejects(readChecked(new globalThis.Response(body),{...entry,sha256:'0'.repeat(64)},signal),/checksum/);
 await assert.rejects(readChecked(new globalThis.Response(body),{...entry,bytes:body.length-1},signal),/Oversized/);
 await assert.rejects(readChecked(new globalThis.Response(body.subarray(1)),entry,signal),/Truncated/);
 const controller=new AbortController();controller.abort();await assert.rejects(readChecked(new globalThis.Response(body),entry,controller.signal),/Aborted/);
 console.log('PASS: product bridge index/chunk compatibility, provenance, limits and decoded checksums');
})().catch(error=>{console.error(error);process.exitCode=1;});
