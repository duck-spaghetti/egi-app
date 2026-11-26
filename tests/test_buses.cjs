/** Opt-in bus layer through the page's actual mount seam with a fake HTTP reader and MapLibre. */
const assert=require('node:assert/strict');const {environment,element}=require('./module_fixture.cjs');
(async()=>{
 const env=environment();const {createBuses,footprint}=await env.load('features/buses/index.js');
 const jobs=new Map();let next=0;const delay=(fn,ms)=>{jobs.set(++next,{fn,ms});return next;};const undelay=id=>jobs.delete(id);
 const requests=[];let now=1000000,response={availability:'available',stale:false,now:1000,feed_timestamp:1000,vehicles:[{id:'v',lat:41.9,lon:12.5,bearing:null,code:'64',age:121}]};
 const host={hidden:false,addEventListener(n,fn){this.changed=fn;}};const box=element();
 const handlers={};const map={zoom:14,sources:{},layers:[],getContainer:()=>box,getZoom(){return this.zoom;},isStyleLoaded:()=>true,
 getBounds:()=>({getWest:()=>12.49,getEast:()=>12.52,getSouth:()=>41.89,getNorth:()=>41.92}),
 getSource(id){return this.sources[id];},addSource(id,s){this.sources[id]={...s,setData(d){this.data=d;}};},removeSource(id){delete this.sources[id];},addLayer(l){this.layers.push(l);},getLayer(id){return this.layers.find(l=>l.id===id);},removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id);},on(n,fn){handlers[n]=fn;},off(){}};
 let frames=0;
 let language='it';
 const layer=createBuses({scope:{signal:new AbortController().signal},http:{request:async(url,o)=>{requests.push({url,body:JSON.parse(o.body)});return {ok:true,json:async()=>response};}},translate:k=>language+':'+k,reduced:true,host,clock:()=>now,delay,undelay,frame:()=>frames++});
 layer.mount(fn=>fn(map,{}));await layer.reload();assert.equal(requests.length,0,'off by default');
 layer.setVisible(true);await layer.reload();assert.equal(requests.length,0,'below z15');assert.match(box.children[0].children[2].textContent,/zoom/);
 map.zoom=15;await layer.reload();assert.equal(requests.length,1);assert.equal(frames,0,'reduced motion');
 let source=map.sources['egi-live-buses'];
 const status=box.children[0].children[2];let text=status.textContent,mutations=0;Object.defineProperty(status,'textContent',{get:()=>text,set:v=>{text=v;mutations++;}});
 await layer.reload();assert.equal(mutations,0,'unchanged live status is not announced again');
 assert(map.layers.filter(l=>l.type==='fill-extrusion').every(l=>l.minzoom===15));
 assert.equal(source.data.features.length,1);assert.equal(source.data.features[0].properties.old,true);
 map.zoom=14.9;handlers.zoom();assert.equal(source.data.features.length,0,'zoom gate clears immediately');map.zoom=15;
 language='fr';layer.refreshLabels();assert.match(box.children[0].children[0].textContent,/^fr:/);assert.match(box.children[0].children[1].children[0].textContent,/^fr:/);assert.match(box.children[0].children[1].children.at(-1).placeholder,/^fr:/);
 assert.equal(map.layers.find(l=>l.id==='egi-live-buses-labels').minzoom,16);assert.equal(box.children[0].children[3].hidden,false);
 const input=box.children[0].children[1].children.at(-1);input.value='64,64';input.dispatch('input',{});await layer.reload();assert.equal(JSON.stringify(requests.at(-1).body.lines),'["64"]');assert(!requests.at(-1).url.includes('?'));
 host.hidden=true;host.changed();await layer.reload();assert.equal(requests.length,3);assert.equal(source.data.features.length,0,'hidden clears');
 host.hidden=false;host.changed();response={...response,stale:true};await layer.reload();assert.equal(source.data.features.length,0);assert.match(box.children[0].children[2].textContent,/stale/);
 response={...response,stale:false};await layer.reload();now+=181000;
 const [tickId,tick]=[...jobs].find(([id,j])=>j.ms===1000);jobs.delete(tickId);tick.fn();assert.equal(source.data.features.length,0,'feed expires even before a new response');
 layer.setVisible(false);const before=requests.length;await layer.reload();assert.equal(requests.length,before);
 const polygon=footprint(12.5,41.9,0).coordinates[0];const width=(polygon[1][0]-polygon[0][0])*111320*Math.cos(41.9*Math.PI/180);const length=(polygon[2][1]-polygon[1][1])*111320;
 assert(Math.abs(width-2.6)<.001);assert(Math.abs(length-12)<.001);
 layer.dispose();assert.equal(map.layers.length,0);assert.equal(jobs.size,0);
 console.log('PASS: bus off/zoom/visibility gates, POST line filter, old positions, stale feed, timed expiry, reduced motion, disposal and dimensions');
})().catch(e=>{console.error(e);process.exitCode=1;});
