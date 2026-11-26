/** Real graph and vendored vector-tile decoding; layer cancellation and reduced motion. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {environment,element}=require('./module_fixture.cjs');
const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));
(async()=>{
 const env=environment();const router=await env.load('features/walking/router.js');
 const {VectorTile}=await env.load('../vendor/walking/vector-tile.js');const {default:Pbf}=await env.load('../vendor/walking/pbf.js');
 const {buildGraph,shortest,loadRoads,walkingRoute}=router;
 const a=[12.5,41.9],b=[12.501,41.9],c=[12.501,41.901],d=[12.499,41.901];
 const g=buildGraph([{part:[a,b,c],kind:'minor_road'},{part:[a,d,c],kind:'minor_road'},{part:[b,[12.51,41.91]],kind:'highway'}]);
 const keys=[...g.nodes.keys()];assert.equal(keys.length,4,'motorway is excluded');
 const key=p=>keys.find(k=>JSON.stringify(g.nodes.get(k))===JSON.stringify(p));
 same(shortest(g,key(a),key(c)),[a,b,c]);
 const tee=buildGraph([{part:[a,[12.502,41.9]]},{part:[[12.501,41.9],[12.501,41.901]]}]);
 assert(shortest(tee,[...tee.nodes.keys()][0],[...tee.nodes.keys()].at(-1)),'T-junction repaired');
 const split=buildGraph([{part:[a,b]},{part:[[12.51,41.91],[12.511,41.91]]}]);
 assert.equal(shortest(split,[...split.nodes.keys()][0],[...split.nodes.keys()].at(-1)),null);
 // Encode a tiny real MVT road layer with the approved pbf reader/writer.
 function feature(obj,pbf){pbf.writeVarintField(3,2);pbf.writePackedVarint(2,[0,obj.kind]);pbf.writePackedVarint(4,[9,0,0,10,100,0]);}
 function layer(_,pbf){pbf.writeVarintField(15,2);pbf.writeStringField(1,'roads');pbf.writeStringField(3,'kind');
  for(const kind of ['minor_road','highway','rail'])pbf.writeMessage(4,(v,p)=>p.writeStringField(1,v),kind);
  for(let kind=0;kind<3;kind++)pbf.writeMessage(2,feature,{kind});pbf.writeVarintField(5,4096);}
 const writer=new Pbf();writer.writeMessage(3,layer,{});const bytes=writer.finish();
 let calls=0;const roads=await loadRoads({getZxy:async()=>calls++===0?{data:bytes}:null},a,b,{VectorTile,Pbf});
 assert.equal(roads.length,1);assert.equal(roads[0].kind,'minor_road');
 await assert.rejects(()=>walkingRoute({},a,[13,42],{}),/too_far/);
 await assert.rejects(()=>walkingRoute({getZxy:async()=>null},a,b,{VectorTile,Pbf}),/no_route/);
 // Same layer interface as the page: no animation when reduced, and late routes ignored.
 const {createWalking}=await env.load('features/walking/index.js');
 const container=element();let fitted=null,frames=0;
 const map={sources:{},layers:[],getContainer:()=>container,getSource(id){return this.sources[id];},
 addSource(id,s){this.sources[id]={...s,setData(d){this.data=d;}};},getStyle:()=>({layers:[{id:'background'}]}),addLayer(l){this.layers.push(l);},
 setPaintProperty(){},fitBounds(b,o){fitted=o;},stop(){},getLayer(id){return this.layers.find(l=>l.id===id);},removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id);},removeSource(id){delete this.sources[id];}};
 const scope={signal:new AbortController().signal};
 class Bounds{extend(){return this;}}
 class PMTiles{}
 const layerRoute=createWalking({context:{map3d:{base:'/map3d/v'}},scope,translate:(k,p)=>k+JSON.stringify(p||{}),pmtiles:{PMTiles},reduced:true,route:async()=>[a,b],frame:()=>{frames++;}});
 layerRoute.mount(fn=>fn(map,{maplibre:{LngLatBounds:Bounds}}));await layerRoute.walk(a,b);
 assert.equal(fitted.animate,false);assert.equal(frames,0);assert.equal(map.sources['egi-walking'].data.geometry.type,'LineString');
 assert.match(container.children[0].textContent,/summary/);layerRoute.dispose();assert.equal(map.layers.length,0);
 let resolve;const pending=createWalking({context:{map3d:{base:'/map3d/v'}},scope,translate:k=>k,pmtiles:{PMTiles},reduced:true,route:()=>new Promise(r=>{resolve=r;})});
 pending.mount(fn=>fn(map,{maplibre:{LngLatBounds:Bounds}}));const loading=pending.walk(a,b);pending.clear();resolve([a,b]);await loading;assert.equal(map.sources['egi-walking'],undefined);pending.dispose();
 console.log('PASS: walking graph, actual tile decode/exclusions, shortest/unreachable/T-junction, reduced motion, cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
