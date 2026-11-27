/** Directions share the reference flow; detail focus respects List mode and a 2D walk switches into 3D. */
const assert=require('node:assert/strict');const {environment,element}=require('./module_fixture.cjs');
(async()=>{
 const intervals=[];const env=environment({setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){}});const {createMapPage}=await env.load('pages/map.js');
 async function fixture(mode,located=true,handoff=null){
  let emit,chosen=0,walks=[],mounted=0,labels=0,selected,focused=[],pageState,redirect,updates=0,routeGeneration=0,routeViews=0;const completions=[];
  const bar=env.get('detail-bar'),button=element();bar.children=[];bar.querySelector=()=>button;
  const poi={id:'service',latitude:located?41.91:null,longitude:located?12.51:null};
  const feature={update(){},mount(){},dispose(){},summaries(){},detail(){},origin(){},referenceChanged(){},choose(){chosen++;},set(){}};
  const services={savedServices:()=>[poi],load:async()=>({pois:[poi]}),update(){},show(){},choose(){},refreshHours(){},describe:()=>({}),dispose(){}};
  const shell={bind(){},layout(){},translate(){},close(){},toggle(){pageState.view=pageState.view==='list'?'map':'list';},update(){},languages(){},cities(){},toast(){}};
  const map={mount(){},update(view){updates++;selected=view.selectedId;},dispose(){},attach(){},center(){},contains:()=>true,invalidate(){},focusService:(...p)=>focused.push(p)};
  const saved=new Map();if(handoff)saved.set('egi.map.handoff',JSON.stringify(handoff));const session={setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k),removeItem:k=>saved.delete(k)};
  const page=createMapPage({languageCode:'it',localLayers:true,view:{mode,available:true}},
   {i18n:{setLanguage:async()=>{},prepareLanguage:async()=>({t:(k,p,f)=>f||k,commit:()=>true}),t:(k,p,f)=>f||k},http:{},browser:{session,location:{pathname:'/map',search:'',assign:url=>redirect=url}},
    factories:{map:()=>map,services:args=>{emit=args.emit;return services;},search:()=>({select:()=>[],update(){}}),origin:()=>feature,transport:()=>feature,cycleways:()=>feature,shell:({state})=>{pageState=state;return shell;},
    buses:()=>({mount(){},dispose(){},refreshLabels(){labels++;}}),
    walking:()=>({mount(){mounted++;},clear(){routeGeneration++;},dispose(){},walk:(a,b)=>{walks.push([a,b]);const token=routeGeneration;return new Promise(resolve=>completions.push(()=>{if(token===routeGeneration)routeViews++;resolve();}));}})}});
  await page.mount();emit('detailReady',{poi});
  return {page,state:pageState,emit,bar,button,poi,walks,focused,session,tick:intervals.at(-1),finish(){completions.splice(0).forEach(fn=>fn());},get routeViews(){return routeViews;},get updates(){return updates;},setList(){pageState.view='list';},get redirect(){return redirect;},get selected(){return selected;},get chosen(){return chosen;},get mounted(){return mounted;},get labels(){return labels;}};
 }
 const three=await fixture('3d');assert.equal(three.mounted,1);three.emit('select',{id:'selected-site'});assert.equal(three.selected,'selected-site');
 assert.deepEqual(three.focused,[[41.91,12.51]],'opening a map detail focuses its point');assert(!three.bar.children.length,'no separate building or walking buttons');
 three.button.click();assert.equal(three.chosen,1);assert.equal(three.walks.length,0);
 three.emit('reference',{lat:41.9,lng:12.5});assert.equal(JSON.stringify(three.walks),JSON.stringify([[[12.5,41.9],[12.51,41.91]]]),'pending directions resume after choosing a reference');
 three.setList();three.emit('detailReady',{poi:three.poi});assert.equal(three.focused.length,1,'List detail leaves camera alone');
 three.emit('language',{language:'fr'});await new Promise(setImmediate);assert.equal(three.labels,1);const before=three.updates;three.tick();assert(three.updates>before,'timed refresh invalidates cached legacy opening status');three.page.dispose();
 const abandoned=await fixture('3d');abandoned.button.click();abandoned.emit('select',{id:'another-service'});abandoned.emit('reference',{lat:41.9,lng:12.5});assert.equal(abandoned.walks.length,0,'changing service cancels a pending reference intent');abandoned.page.dispose();
 const cancelled=await fixture('3d');cancelled.button.click();cancelled.emit('cancelReference');cancelled.emit('reference',{lat:41.9,lng:12.5});assert.equal(cancelled.walks.length,0,'explicit cancellation discards pending route intent');cancelled.page.dispose();
 const deferred=await fixture('3d');deferred.emit('reference',{lat:41.9,lng:12.5});deferred.button.click();deferred.emit('select',{id:'another-service'});deferred.finish();assert.equal(deferred.routeViews,0,'late route completion cannot override the new selected service');deferred.page.dispose();
 const unlocated=await fixture('3d',false);unlocated.button.click();assert.equal(unlocated.chosen,0,'address-only service must not start reference selection');assert.equal(unlocated.walks.length,0);unlocated.page.dispose();
 const two=await fixture('2d');assert.equal(two.mounted,0);two.button.click();assert(two.redirect.includes('vista=3d'));assert(!two.redirect.includes('41.9'),'reference coordinates never enter URL');
 assert.equal(JSON.parse(two.session.getItem('egi.map.handoff')).walkTo,'service');two.page.dispose();
 const named=await fixture('2d');named.emit('savedMap',{id:'operators',entries:[],name:'Operatori'});env.get('view3d-toggle').click();
 assert(!named.redirect.includes('operators'),'list identity stays out of the URL');const transferred=JSON.parse(named.session.getItem('egi.map.handoff'));named.page.dispose();
 const restored=await fixture('3d',true,transferred);assert.equal(restored.state.filters.savedCollection,'operators','view switch keeps the named collection instead of quick favorites');assert.equal(restored.state.savedListName,'Operatori');restored.page.dispose();
 const versioned=await fixture('3d');versioned.emit('savedMap',{id:'operators',entries:[],name:'Operatori'});versioned.emit('select',{id:'service'});versioned.emit('map3dVersionConflict',{});
 assert(versioned.redirect.includes('vista=3d'));assert(versioned.redirect.includes('service'),'version recovery preserves selection');
 const recovered=JSON.parse(versioned.session.getItem('egi.map.handoff'));assert.equal(recovered.filters.savedCollection,'operators');assert.equal(recovered.savedListName,'Operatori');versioned.page.dispose();
 console.log('PASS: integrated directions, reference continuation, automatic focus/List exception and 2D-to-3D handoff');
})().catch(e=>{console.error(e);process.exitCode=1;});
