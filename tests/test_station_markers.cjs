/** Metro summaries, source identity and departures across overview/detail projection boundaries. */
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {environment}=require('./module_fixture.cjs');
(async()=>{
 const {stationMarkers}=await environment().load('features/transport/station-markers.js');
 const stop=(id,name,code,lng=12.5095)=>({type:'Feature',id:`stop:${id}`,geometry:{type:'Point',coordinates:[lng,41.8855]},properties:{transport_type:'metro',name,stop_id:id,routes:[{route_id:code,display_code:code,mode:'metro'}]}});
 const points=[stop('AD15','S. Giovanni','A'),stop('AP13','S. Giovanni','A',12.50965),stop('CD22','San Giovanni','C',12.50978),stop('CP22','San Giovanni','C',12.50976),stop('AD16','Re Di Roma','A',12.514),stop('AP12','Re Di Roma','A',12.5142)];
 const original=JSON.stringify(points),markers=stationMarkers(points);assert.equal(markers.length,2);
 const interchange=markers.find(f=>f.properties.name==='San Giovanni');assert.equal(interchange.properties.stop_ids.length,4);assert.equal(interchange.properties.routes.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(interchange.properties.stop_ids)),['AD15','AP13','CD22','CP22']);
 assert.equal(JSON.stringify(points),original,'native input points remain untouched');
 const distant=stop('far','San Giovanni','A',12.55);assert.equal(stationMarkers([...points,distant]).length,3,'distant namesakes never merge');
 const bus={...stop('bus','San Giovanni','bus'),properties:{transport_type:'bus',name:'San Giovanni',stop_id:'bus'}};assert(stationMarkers([...points,bus]).includes(bus),'bus markers remain independent');
 const low=[{...points[0],properties:{...points[0].properties,stop_id:undefined,stop_ids:['AD15','AP13']}},{...points[2],properties:{...points[2].properties,stop_id:undefined,stop_ids:['CD22','CP22']}}];
 assert.equal(stationMarkers(low).length,1);assert.equal(stationMarkers(low)[0].id,interchange.id,'overview and detail share a stable station key');
 const romaOverview={...markers.find(f=>f.properties.name==='Re Di Roma'),id:'station:AD16'};assert.equal(stationMarkers([romaOverview])[0].id,stationMarkers(points.slice(4))[0].id,'single-line station key survives overview/detail split');
 const start=performance.now();for(let i=0;i<1000;i++)stationMarkers(points);console.log(JSON.stringify({projections:1000,points:6,milliseconds:performance.now()-start}));
 console.log('PASS: Re di Roma 2→1, San Giovanni 4→1 with A/C, stable overview identity, source preservation and distant namesakes');
})().catch(e=>{console.error(e);process.exitCode=1;});
