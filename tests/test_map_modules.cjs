/** Regression tests for page ownership and cancellation through actual ES Interfaces. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
(async()=>{
 const timers=new Set();let timerId=0;
 const env=environment({setInterval:()=>{timers.add(++timerId);return timerId;},clearInterval:id=>timers.delete(id)});
 const {Lifecycle,startPage}=await env.load('lifecycle.js');const {createHttp}=await env.load('http.js');
 const {createMapPage}=await env.load('pages/map.js');const {createI18n}=await env.load('i18n.js');
 const scope=new Lifecycle();scope.every(()=>{},10);assert.equal(timers.size,1);scope.dispose();scope.dispose();assert.equal(timers.size,0);
 const pending=deferred(),requestScope=new Lifecycle();const http=createHttp(requestScope,async()=>({ok:true,status:200,json:()=>pending.promise}));
 const response=await http.request('/catalogue');const reading=response.json();requestScope.dispose();pending.resolve({privateOldInstance:true});
 await assert.rejects(reading,{name:'AbortError'});
 const fetchPending=deferred(),fetchScope=new Lifecycle();const fetching=createHttp(fetchScope,()=>fetchPending.promise).request('/late');
 fetchScope.dispose();fetchPending.resolve({ok:true,json:async()=>[]});await assert.rejects(fetching,{name:'AbortError'});
 // Old language and old payload completions may not mount/update a replacement page.
 function fixture(languageWait,dataWait=Promise.resolve({})){
  const events=[];const map={mount:()=>events.push('mount'),update:()=>events.push('update'),dispose:()=>events.push('dispose'),attach:()=>{},center(){},contains:()=>true,invalidate(){}};
  const services={load:()=>dataWait,update:()=>events.push('services'),show(){},choose(){},refreshHours(){},describe:()=>({}),dispose(){}};
  const feature={update(){},mount(){},dispose(){},summaries(){},detail(){},origin(){},badge:()=>'',shell:()=>'',cancelOrigin(){},locate(){},search(){},choose(){},set(){}};
  const shell={bind(){},layout(){},translate(){},close(){},toggle:()=>events.push('error'),update(){},languages(){},cities(){},toast(){}};
  return {events,page:createMapPage({languageCode:'it',localLayers:false,cityName:'Test'},
   {i18n:{setLanguage:()=>languageWait,t:()=>'',translatePage(){}},http:{request(){throw Error('unexpected');}},
    factories:{map:()=>map,services:()=>services,search:()=>({select:()=>[],update(){}}),origin:()=>feature,transport:()=>feature,cycleways:()=>feature,shell:()=>shell}})};
 }
 const oldLanguage=deferred(),newLanguage=deferred();const a=fixture(oldLanguage.promise),b=fixture(newLanguage.promise);
 const oldStart=a.page.mount();a.page.dispose();const newStart=b.page.mount();oldLanguage.resolve();await oldStart;
 assert.deepEqual(a.events,[]);assert.deepEqual(b.events,[],'replacement stays pending until its own language is ready');
 newLanguage.resolve();await newStart;assert(b.events.includes('mount'));b.page.dispose();assert.equal(timers.size,0);
 const lateData=deferred();const c=fixture(Promise.resolve(),lateData.promise);const start=c.page.mount();await Promise.resolve();await Promise.resolve();
 c.page.dispose();const before=c.events.slice();lateData.resolve({pois:[]});await start;assert.deepEqual(c.events,before,'retired data/error cannot update the page');assert(!c.events.includes('error'));
 // Language-generation ordering changes both messages and direction atomically.
 const requests=new Map();const dictionaryHttp={request:async url=>({ok:true,json:()=>{if(url.endsWith('/it.json'))return Promise.resolve({title:'IT'});const wait=deferred();requests.set(url,wait);return wait.promise;}})};
 const languageScope=new Lifecycle(),translator=createI18n(languageScope,dictionaryHttp);
 const first=translator.setLanguage('fr');await new Promise(setImmediate);const second=translator.setLanguage('ar');await new Promise(setImmediate);
 requests.get('/translations/ar.json').resolve({title:'AR'});await second;
 requests.get('/translations/fr.json').resolve({title:'FR'});await first;
 assert.equal(translator.t('title'),'AR');assert.equal(env.document.documentElement.dir,'rtl');languageScope.dispose();
 const host=new EventTarget(),instances=[];
 const mounted=startPage(()=>{const life=new Lifecycle();const instance={mounts:0,scope:life,mount(){this.mounts++;},dispose(){life.dispose();}};instances.push(instance);return instance;},host);
 assert.equal(instances.length,1);host.dispatchEvent(new Event('pagehide'));assert(instances[0].scope.signal.aborted);
 const restored=new Event('pageshow');Object.defineProperty(restored,'persisted',{value:true});host.dispatchEvent(restored);
 assert.equal(instances.length,2);assert.equal(instances[1].mounts,1);assert(!instances[1].scope.signal.aborted);
 mounted.dispose();host.dispatchEvent(restored);assert.equal(instances.length,2,'final disposal also removes browser lifecycle listeners');
 console.log('PASS: real ES graph; page instances, timer cleanup, stale language/fetch/JSON/data/error isolation and latest language wins');
})().catch(error=>{console.error(error);process.exitCode=1;});
