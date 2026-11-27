/** Entrance association, exact source geometry, shared lines and unavailable/ambiguous evidence. */
const assert=require('node:assert/strict'),fs=require('node:fs');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const {entranceSigns}=await environment().load('features/transport/metro-entrances.js');
 const station=(name,coords=[12.5,41.9])=>({geometry:{type:'Point',coordinates:coords},properties:{transport_type:'metro',name,stop_ids:['A1','A2','B1'],routes:[{route_id:'MEA',display_code:'A'},{route_id:'MEB',display_code:'B'}]}});
 const entrance={id:'osm:1',geometry:{type:'Point',coordinates:[12.5001,41.9001]},properties:{osm_id:1,areas:[{name:'Termini A'},{name:'Termini B'}]}};
 const snapshot={format:'egi-metro-entrances/1',features:[entrance]};const result=entranceSigns([station('Termini')],snapshot);
 assert.equal(result.length,1);assert.equal(result[0].geometry,entrance.geometry);assert.equal(result[0].properties.routes.length,2);assert.equal(result[0].properties.stop_ids.length,3);
 assert.equal(entranceSigns([station('Termini'),station('Termini',[12.5002,41.9002])],snapshot).length,0,'ambiguous station identity is never guessed');
 assert.equal(entranceSigns([station('Termini',[12.6,41.9])],snapshot).length,0,'distant namesakes cannot inherit an entrance');
 assert.equal(entranceSigns([station('Other')],snapshot).length,0);assert.equal(entranceSigns([station('Termini')],null).length,0);
 const real=JSON.parse(fs.readFileSync('app/frontend/static/data/metro-entrances.geojson'));
 const republic=entranceSigns([station('Repubblica',[12.4957,41.9024])],real);assert.equal(republic.length,4,'all four real Repubblica entrances start together');assert(republic.every(f=>f.id.startsWith('osm:entrance:')));
 const termini=entranceSigns([station('Termini',[12.5003,41.901])],real);assert(termini.length>=3);assert(termini.every(f=>f.geometry.coordinates[0]!==12.5003),'no platform coordinate masquerades as an entrance');
 console.log('PASS: exact OSM entrance geometry, shared A/B station IDs, unique bounded matching, unavailable fallback and real Repubblica/Termini snapshot');
})().catch(e=>{console.error(e);process.exitCode=1;});
