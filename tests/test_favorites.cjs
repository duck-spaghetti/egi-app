/** Exercise actual favorite rules, refresh races, quota failure and worker cache isolation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {environment} = require('./module_fixture.cjs');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const card = n => ({id:id(n),data_status:'approved_canonical_local',name:`Public ${n}`,
  description:'Saved details',contacts:[{type:'phone',value:'061234',is_active:true}],
  hours_display:{canonical_opening:{status:'open'},days:[]}, canonical_opening:{status:'open'},
  place:{address:'Public address',geometry:{coordinates:[12,41]}},secret:'must not persist'});
function memory() {
  const data=new Map();
  return {data,all:async()=>structuredClone([...data.values()]),mutate:async(key,update)=>{
    const next=update(structuredClone(data.get(key)));
    if(next===null)data.delete(key);else if(next!==undefined)data.set(key,structuredClone(next));
    return next;
  }};
}
const canonicalHeaders={get:()=> 'approved-canonical-local'};
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
(async()=>{
  const env=environment({crypto:require('node:crypto').webcrypto});
  const {createFavorites,publicCard}=await env.load('features/favorites/store.js');
  const store=memory();let mode='ok',calls=0,active=0,peak=0;
  const favorites=createFavorites({territory:'roma',store,prepare:async()=>{},request:async url=>{
    calls++; active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;
    if(mode==='network')throw Error('offline');
    if(mode==='bad')return {headers:canonicalHeaders,ok:true,json:async()=>({...card(1),id:id(99)})};
    const n=Number(url.match(/([0-9]+)\?/)[1]);
    return {headers:{get:()=>mode==='preview'?'unreviewed-source-preview':'approved-canonical-local'},ok:mode==='ok',status:['withdraw','preview'].includes(mode)?404:mode==='server'?503:200,
      json:async()=>({...card(n),description:'Fresh public detail'})};
  }});
  await favorites.save(id(1),'it');await favorites.save(id(1),'it');
  assert.equal((await favorites.list()).length,1,'duplicate additions stay one entry');
  const saved=(await favorites.list())[0];
  assert(!JSON.stringify(saved).includes('secret'));
  assert(!JSON.stringify(saved).includes('canonical_opening'));
  assert(!JSON.stringify(saved).includes('coordinates'));
  const protectedCard=publicCard({...card(1),place:{address:'Hidden',is_protected_address:true}});
  assert.equal(protectedCard.place.address,undefined);
  mode='network';assert.equal((await favorites.refresh()).failures,1);
  assert.equal((await favorites.list())[0].updatedAt,saved.updatedAt);
  mode='server';assert.equal((await favorites.refresh()).failures,1);
  assert.equal((await favorites.list())[0].card.description,saved.card.description);
  mode='bad';assert.equal((await favorites.refresh()).failures,1);
  mode='preview';assert.equal((await favorites.refresh()).failures,1);
  assert.equal((await favorites.list())[0].status,'saved','preview route 404 is not a withdrawal');
  mode='withdraw';await favorites.refresh();
  const withdrawn=(await favorites.list())[0];
  assert.equal(withdrawn.status,'unavailable');assert.equal(withdrawn.card,undefined);
  assert(!JSON.stringify(withdrawn).includes('Public address'));
  mode='ok';await favorites.refresh();assert.equal((await favorites.list())[0].status,'saved');
  for(let n=2;n<=8;n++)await favorites.save(id(n),'it');
  calls=0;await Promise.all([favorites.refresh(),favorites.refresh()]);
  assert.equal(calls,8,'concurrent refreshes are coalesced');assert(peak<=3,'at most three refresh requests');
  const gate=deferred();
  const racing=createFavorites({territory:'roma',store,request:()=>gate.promise});
  const refresh=racing.refresh();await new Promise(setImmediate);await favorites.remove(id(1));
  gate.resolve({headers:canonicalHeaders,ok:false,status:404});await refresh;
  assert(!(await favorites.list()).some(row=>row.id===id(1)),'late refresh cannot revive removed favorite');
  const newerGate=deferred();
  const stale=createFavorites({territory:'roma',store,request:()=>newerGate.promise});
  const staleRefresh=stale.refresh();await new Promise(setImmediate);
  const newer=(await favorites.list())[0];
  await store.mutate(newer.key,current=>({...current,token:'new-mutation'}));
  newerGate.resolve({headers:canonicalHeaders,ok:false,status:404});await staleRefresh;
  assert.equal((await favorites.list()).find(row=>row.key===newer.key).token,'new-mutation');
  const elsewhere=createFavorites({territory:'other',store});assert.equal((await elsewhere.list()).length,0);
  const before=store.data.size;
  const noShell=createFavorites({territory:'roma',store,prepare:async()=>{throw Error('quota');}});
  await assert.rejects(noShell.save(id(9)));assert.equal(store.data.size,before);
  const noSpace=createFavorites({territory:'roma',store:{all:store.all,mutate:async()=>{throw Error('quota');}},request:async()=>({headers:canonicalHeaders,ok:true,json:async()=>card(9)})});
  await assert.rejects(noSpace.save(id(9)));assert.equal(store.data.size,before);
  await assert.rejects(favorites.save('bad-id'));
  store.data.set('corrupt',{key:JSON.stringify(['roma','canonical'])+':'+id(20),id:id(20),schema:99});
  await assert.rejects(favorites.list());store.data.delete('corrupt');

  // The worker only handles exact public shell URLs, even when another path asks it to cache.
  const events={},cached=new Map();let intercepted=0;
  const cache={match:async key=>cached.get(key),addAll:async requests=>{
    for(const request of requests)cached.set(request.url,{headers:{get:()=> 'approved-canonical-local'}});
  }};
  const context=vm.createContext({URL,Request:class{constructor(url){this.url=url;}},Set,Error,
    caches:{open:async()=>cache,keys:async()=>[],delete:async()=>{}},fetch:async()=>({}),
    self:{location:{origin:'http://localhost'},addEventListener:(name,fn)=>{events[name]=fn;},skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
  vm.runInContext(fs.readFileSync('app/frontend/static/js/features/favorites/worker.js','utf8'),context);
  let installation;events.install({waitUntil:p=>{installation=p;}});await installation;
  assert(cached.has('/preferiti'));assert([...cached.keys()].every(path=>!path.startsWith('/api/')));
  for(const path of ['/api/public/services/'+id(1),'/moderation','/contribuisci','/map','/preferiti/sw.js','https://other.test/preferiti']) {
    events.fetch({request:{url:new URL(path,'http://localhost').href,method:'GET',mode:'navigate'},respondWith:()=>intercepted++});
  }
  assert.equal(intercepted,0);
  events.fetch({request:{url:'http://localhost/preferiti?lang=ar',method:'GET',mode:'navigate'},respondWith:()=>intercepted++});
  assert.equal(intercepted,1);
  events.fetch({request:{url:'http://localhost/static/assets/icons/default/shopping%20bag.svg',method:'GET',mode:'cors'},respondWith:()=>intercepted++});
  assert.equal(intercepted,2,'encoded allowlisted asset is intercepted offline');
  cache.addAll=async()=>{throw Error('quota');};cached.clear();
  events.install({waitUntil:p=>{installation=p;}});await assert.rejects(installation);

  let ready=false,updated=0,oldWorkerUsed=false;
  class Channel {
    constructor(){this.port1={close(){}};this.port2={receiver:this.port1};}
  }
  const newWorker={state:'activated',postMessage:(_,ports)=>ports[0].receiver.onmessage({data:{ready}})};
  const registration={active:{state:'activated',postMessage:()=>{oldWorkerUsed=true;}},
    update:async()=>{updated++;registration.installing=newWorker;}};
  const offlineEnv=environment({isSecureContext:true,caches:{},MessageChannel:Channel,
    navigator:{serviceWorker:{register:async()=>registration}}});
  const {prepareOffline}=await offlineEnv.load('features/favorites/offline.js');
  await assert.rejects(prepareOffline());ready=true;await prepareOffline();
  assert.equal(oldWorkerUsed,false,'readiness uses the newest worker after explicit update');
  assert.equal(updated,2,'failed preparation can be retried');
  const offlineWorker={state:'activated',postMessage:(_,ports)=>ports[0].receiver.onmessage({data:{ready:true}})};
  const cachedEnv=environment({isSecureContext:true,caches:{match:async()=>({})},MessageChannel:Channel,
    navigator:{serviceWorker:{register:async()=>({active:offlineWorker,update:async()=>{throw Error('offline');}})}}});
  await (await cachedEnv.load('features/favorites/offline.js')).prepareOffline();
  console.log('PASS: favorites snapshots, deduplication, refresh errors/withdrawal/republication, concurrency, removal races, territory isolation, quota and worker allowlist');
})().catch(error=>{console.error(error);process.exitCode=1;});
