/** Native sign geometry, depth-aware picking and source ownership at the real module seam. */
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {environment}=require('./module_fixture.cjs');
(async()=>{
 const {signGeometry,createPaline,PALINE_SOURCE,PALINE_LAYERS,SIGN_SCALE,nativeFade,nativeProgress}=await environment().load('features/transport/paline-gl.js');
 const point=[12.510318,41.89909],stops=['bus','tram','metro'].map(mode=>({key:mode,mode,coordinates:point,near:false}));
 const geometry=signGeometry(stops);assert(geometry.features.length>9);
 assert.equal(Math.min(...geometry.features.map(f=>f.properties.base)),0);assert.equal(Math.max(...geometry.features.map(f=>f.properties.height)),2.7*SIGN_SCALE);
 for(const mode of ['bus','tram','metro']){
  const pole=geometry.features.find(f=>f.properties.key===mode&&f.properties.base===0);
  const ring=pole.geometry.coordinates[0];assert(Math.abs((ring[0][0]+ring[2][0])/2-point[0])<1e-12);assert(Math.abs((ring[0][1]+ring[2][1])/2-point[1])<1e-12);
 }
 const sources={},layers=[],listeners=new Map(),selected=[];let zoom=18.9,updates=0,hits=[];
 const map={getSource:id=>sources[id],addSource(id,s){sources[id]={...s,setData(data){this.data=data;updates++;}};},removeSource:id=>delete sources[id],
  getStyle:()=>({layers}),addLayer:l=>layers.push(l),getLayer:id=>layers.find(l=>l.id===id),removeLayer:id=>layers.splice(layers.findIndex(l=>l.id===id),1),
  on:(event,fn)=>listeners.set(event,fn),off:event=>listeners.delete(event),queryRenderedFeatures:()=>hits,getZoom:()=>zoom};
 const owner=createPaline(map,key=>selected.push(key));owner.ensure();assert.equal(layers.length,2);assert.equal(sources[PALINE_SOURCE].maxzoom,22);assert.equal(sources[PALINE_SOURCE].tolerance,0);
 const feature={id:'stop:a',type:'Feature',geometry:{type:'Point',coordinates:point},properties:{transport_type:'bus',stop_id:'a'}};
 owner.update([feature],14.9,null);assert.equal(sources[PALINE_SOURCE].data.features.length,0,'far network creates no meshes');
 owner.update([feature],17,null);assert(sources[PALINE_SOURCE].data.features.length>0,'prepare one zoom before road fade');const count=updates;owner.update([feature],18.5,null);assert.equal(updates,count,'zoom follows GPU expressions, not regenerated geometry');
 hits=[{layer:{id:PALINE_LAYERS[1]},properties:{key:'stop:a',mode:'bus'}}];listeners.get('click')({point:{x:100,y:100}});assert.equal(selected.at(-1),'stop:a');
 hits.unshift({layer:{id:'parts-3d'},properties:{}});listeners.get('click')({point:{x:100,y:100}});assert.equal(selected.length,1,'foreground building blocks native selection');
 hits.shift();listeners.get('click')({point:{x:100,y:100},egiReferencePicked:true});assert.equal(selected.length,1,'reference choice does not also open a stop');
 zoom=nativeFade()[0];listeners.get('click')({point:{x:100,y:100}});assert.equal(selected.length,1,'fully transparent onset is not picked');
 hits.push({layer:{id:PALINE_LAYERS[0]},properties:{key:'metro',mode:'metro'}});const overlapEvent={point:{x:100,y:100}};listeners.get('click')(overlapEvent);assert.equal(selected.length,1,'all sign modes are invisible at the shared tree onset');zoom=16.3;listeners.get('click')(overlapEvent);assert.equal(selected.at(-1),'stop:a');assert.equal(overlapEvent.egiStopPicked,true,'successful native pick consumes overlapping route clicks');
 owner.update([],19,null);assert.equal(sources[PALINE_SOURCE].data.features.length,0);owner.dispose();assert.equal(layers.length,0);assert(!sources[PALINE_SOURCE]);assert(!listeners.size);
 const ramp=nativeFade();assert.equal(ramp[0],16);assert.equal(ramp.at(-2),16.6);assert.equal(nativeProgress(16),0);assert(Math.abs(nativeProgress(16.3)-.5)<1e-10);assert.equal(nativeProgress(16.6),1);assert(nativeProgress(16.01)<.1,'eased onset avoids an opacity jump');
 const many=Array.from({length:100},(_,i)=>({...stops[i%3],key:String(i)}));const start=performance.now();const dense=signGeometry(many);console.log(JSON.stringify({signs:100,prisms:dense.features.length,milliseconds:performance.now()-start}));
 console.log('PASS: physical sign coordinates, dimensions, zoom preparation, source reuse, depth picking, reference and disposal');
})().catch(e=>{console.error(e);process.exitCode=1;});
