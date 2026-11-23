/* Exercise the real ES module graph and lifecycle with Node's built-in VM. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'../app/frontend/static/js');
 const timers=new Set();let next=0;
 const element=()=>({classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},dataset:{}});
 const sandbox=vm.createContext({window:{EGI_MAP_CONTEXT:{canonical:true,languageCode:'it',profile:{timezone:'Europe/Rome'}}},
  document:{getElementById:element,querySelector:element},AbortController,DOMException,URLSearchParams,URL,
  setInterval:()=>{timers.add(++next);return next;},clearInterval:id=>timers.delete(id),console});
 const modules=new Map();
 for(const file of fs.readdirSync(root).filter(x=>x==='map.js'||x.startsWith('map-'))){
  let code=fs.readFileSync(path.join(root,file),'utf8');
  if(file==='map.js')code=code.slice(0,code.indexOf('window.addEventListener("pagehide"'));
  modules.set(path.join(root,file),new vm.SourceTextModule(code,{context:sandbox,identifier:path.join(root,file)}));
 }
 const entry=modules.get(path.join(root,'map.js'));
 await entry.link((name,parent)=>modules.get(path.resolve(path.dirname(parent.identifier),name)));await entry.evaluate();
 const get=file=>modules.get(path.join(root,file+'.js')).namespace;
 const {Lifecycle,state}=get('map-state');const scope=new Lifecycle();
 scope.every(()=>{},10);assert.equal(timers.size,1);scope.dispose();scope.dispose();assert.equal(timers.size,0);assert(scope.signal.aborted);
 const data=get('map-data'),view=get('map-view'),filters=get('map-filters'),details=get('map-details'),hours=get('map-hours');
 state.categories=[{id:1,slug:'igiene'},{id:2,slug:'vestiti'}];
 const make=(id,category)=>data.normalizePublicService({id,name:id,data_status:'approved_canonical_local',category:{id:category==='igiene'?1:2,slug:category},needs:[category],place:{id:'place-'+id,address:'Via Umberto Cagni 48',geometry:{type:'Point',coordinates:[12.3,41.73]}}});
 state.pois=[make('docce','igiene'),make('coperte','vestiti'),make('altro','vestiti')];state.filters.cats=new Set(['igiene']);
 const matches=filters.filteredPois();assert.equal(matches.length,1);const groups=view.siteGroups(matches);assert.equal(groups.length,1);assert.equal(groups[0].length,1,'marker count follows active filters');
 assert.equal(view.sameSourceGroup(matches[0]).length,3);assert(details.renderOtherServices(matches[0]).includes('fuori dai filtri attivi'));assert(state.filters.cats.has('igiene'));
 const declared={canonical_opening:{status:'closed'},verification:{checks:[]}};
 assert.equal(hours.canonicalOpeningStatus(declared).label,'Chiuso · da verificare');
 declared.verification.checks=[{scope:'field',field:'contact',outcome:'confirmed',checked_at:'2026-11-23'}];
 assert.equal(hours.canonicalOpeningStatus(declared).label,'Chiuso · da verificare');
 declared.verification.checks.push({scope:'field',field:'hours',outcome:'confirmed',checked_at:'2026-11-23',warning:null});
 assert.equal(hours.canonicalOpeningStatus(declared).label,'Chiuso');
 console.log('PASS: actual ES imports, lifecycle teardown, exact co-location, filter-preserving siblings and scoped verification');
})().catch(error=>{console.error(error);process.exitCode=1;});
