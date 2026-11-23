/** Exercise the reviewed clipboard and reference/transport journeys through real ES Modules. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(setImmediate);

(async()=>{
 for(const retired of [false,true])for(const failed of [false,true]){
  const clipboard=deferred();let selections=0;
  const leafletMap={setView(){},remove(){}};
  const env=environment({navigator:{clipboard:{writeText:()=>clipboard.promise}},
   L:{map:()=>leafletMap,tileLayer:()=>({addTo(){}}),layerGroup:()=>({addTo(){return {};}})}});
  const {Lifecycle}=await env.load('lifecycle.js');
  const {mountOverlapReview}=await env.load('features/preview/overlaps.js');
  const scope=new Lifecycle();
  mountOverlapReview({scope,http:{request:()=>new Promise(()=>{})}});
  env.get('export').value='old decisions';env.get('copy').click();
  if(retired){scope.dispose();env.elements.delete('export');env.elements.delete('copied');}
  env.get('export').select=()=>selections++;env.get('copied').textContent='current page';
  if(failed)clipboard.reject(Error('denied'));else clipboard.resolve();
  await settle();
  assert.equal(env.get('copied').textContent,retired?'current page':failed?'Seleziona e copia a mano.':'Copiato.');
  assert.equal(selections,!retired&&failed?1:0);
  scope.dispose();
 }

 const env=environment();const {createMapPage}=await env.load('pages/map.js');
 const calls=[];let emit;
 const page=createMapPage({canonical:true,languageCode:'it',localLayers:false,cityName:'Roma'},
  {i18n:{setLanguage:async()=>{},t:()=>''},http:{post:(url,body,signal)=>{
    const wait=deferred();calls.push({url,body,signal,wait});return wait.promise;},request(){throw Error('unexpected request');}},
   factories:{map:options=>{emit=options.emit;return {mount(){},dispose(){},update(){},contains:()=>true,center(){},invalidate(){}};},
    services:()=>({load:async()=>({}),update(){},dispose(){},refreshHours(){},describe(){}}),
    search:()=>({select:()=>[],update(){}}),cycleways:()=>({dispose(){}}),
    shell:()=>({bind(){},layout(){},translate(){},update(){},languages(){},cities(){},close(){}})}});
 await page.mount();
 emit('pickedReference',{lat:41.9,lng:12.5,label:'First'});
 assert.equal(calls.length,0,'a closed panel does not load transport');
 assert.match(env.get('origin-transit-body').textContent,/Apri per caricare/);
 env.get('origin-transit').open=true;
 emit('pickedReference',{lat:41.91,lng:12.51,label:'Second'});
 assert.equal(calls.length,1);assert.equal(calls[0].body.lat,41.91);
 emit('pickedReference',{lat:41.92,lng:12.52,label:'Third'});
 assert.equal(calls.length,2);assert(calls[0].signal.aborted,'the previous reference request is cancelled');
 calls[1].wait.resolve({ok:true,json:async()=>({stops:[],now:'12:00'})});await settle();
 const current=env.get('origin-transit-body').innerHTML;assert.match(current,/Third/);
 calls[0].wait.resolve({ok:true,json:async()=>({stops:[],now:'11:59'})});await settle();
 assert.equal(env.get('origin-transit-body').innerHTML,current,'old transport results cannot replace the current reference');
 page.dispose();
 console.log('PASS: active/retired clipboard success/failure and real reference/transport cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
