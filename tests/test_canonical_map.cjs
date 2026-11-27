/** Canonical detail and exact co-location behavior through actual Modules. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const env=environment();const {Lifecycle}=await env.load('lifecycle.js');const scope=new Lifecycle();
 const {createServices}=await env.load('features/services/index.js'),{createSites}=await env.load('features/map/sites.js');
 const context={canonical:true,cityId:1,languageCode:'it',profile:{timezone:'Europe/Rome'}};
 let snapshot={pois:[],categories:[{id:1,slug:'igiene'},{id:2,slug:'vestiti'}],lang:'it',matchedIds:new Set(['a']),filters:{cats:new Set(['igiene']),offersOff:new Set()},taxonomy:{course_levels:[]},transitByPlace:{}};
 const sites=createSites({context,snapshot:()=>snapshot});const events=[];
 const rows=['a','b','c'].map((id,i)=>({id,name:id,data_status:'approved_canonical_local',category:snapshot.categories[i?1:0],place:{id:'place-'+id,address:'Cagni 48',geometry:{type:'Point',coordinates:[12.3,41.73]}},
  hours_display:{canonical_opening:{status:'closed'},verification:{checks:[]},days:[{label:'Lunedì',state:'closed',intervals:[]},{label:'Martedì',state:'unknown',intervals:[]}]},
  conditions:[{text:'approved condition',source_name:'Secondary',state:'known'}],contacts:[{type:'phone',value:i?'06 45460314':'06 45460313'}],linked_sources:[]}));
 const module=createServices({context,scope,loader:{load:async()=>({rows,categories:snapshot.categories,languages:[],areas:[],categoryTranslations:[],taxonomy:snapshot.taxonomy})},sites,transit:{badge:()=>'',shell:()=>''},translate:(_k,_p,f)=>f||'',emit:(...e)=>events.push(e)});
 Object.assign(snapshot,await module.load('it'));module.update(snapshot,snapshot.pois.slice(0,1));
 assert.equal(sites.groups(snapshot.pois.slice(0,1))[0].length,1);assert.equal(sites.siblings(snapshot.pois[0]).length,3);
 await module.show('a');let html=env.get('detail-body').innerHTML;
 assert(html.includes('Altri servizi qui'));assert.equal((html.match(/fuori dai filtri attivi/g)||[]).length,2);assert(snapshot.filters.cats.has('igiene'));
 assert(html.includes('Chiuso · da verificare'));assert(html.includes('Da verificare'));assert(html.includes('approved condition'));assert(!html.includes('Dati originali'));
 assert(env.get('detail-bar').innerHTML.includes('tel:0645460313'));
 snapshot.pois[0].raw.hours_display.verification.checks=[{scope:'field',field:'contact',outcome:'confirmed',checked_at:'2026-11-23'}];
 assert.equal(module.describe(snapshot.pois[0]).status.label,'Chiuso');
 snapshot.pois[0].raw.hours_display.verification.checks.push({scope:'field',field:'hours',outcome:'confirmed',checked_at:'2026-11-23',warning:null});
 assert.equal(module.describe(snapshot.pois[0]).status.label,'Chiuso');
 snapshot.pois[0].raw.hours_display.canonical_opening={status:'open',next_transition_at:'2000-01-01T00:00:00Z'};
 assert.equal(module.describe(snapshot.pois[0]).status.kind,'unknown','expired availability is not freshly open');
 await module.choose(snapshot.pois,new Set(['a']));assert(env.get('detail-body').innerHTML.includes('3 servizi'));assert(snapshot.filters.cats.has('igiene'));
 scope.dispose();console.log('PASS: canonical statuses, scoped verification, supplements rendering, exact co-location and out-of-filter siblings');
})().catch(error=>{console.error(error);process.exitCode=1;});
