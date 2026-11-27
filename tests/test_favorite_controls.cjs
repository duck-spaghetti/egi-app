/** Verify shared bookmark state, in-flight deduplication, failures and retired-page isolation. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
const id='00000000-0000-0000-0000-000000000001';
const wait=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
function control(position){
  const attributes=new Map();
  return {id:`favorite-${position}-${id}`,dataset:{favoriteId:id,favoriteTitle:'Public <service>'},
    disabled:false,isConnected:true,closest:()=>null,
    setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key),
    focus(){root.activeElement=this;}};
}
let root;
(async()=>{
  const env=environment();const {Lifecycle}=await env.load('lifecycle.js');
  const {createFavoriteControls}=await env.load('features/favorites/controls.js');
  const scope=new Lifecycle(),notifications=[],changes=[],listeners={};
  const list=control('list'),detail=control('detail'),buttons=[list,detail];
  root={body:{},documentElement:{lang:'fr'},activeElement:null,
    querySelectorAll:()=>buttons,querySelector:()=>list,getElementById:key=>buttons.find(button=>button.id===key),
    addEventListener:(event,handler)=>{listeners[event]=handler;}};
  let entries=[],saving=deferred(),fail=false,saves=0,removes=0,language;
  const favorites={list:async()=>entries,
    save:async(_id,code)=>{saves++;language=code;await saving.promise;if(fail)throw Error('quota');entries=[{id}];},
    remove:async()=>{removes++;entries=[];}};
  const controls=createFavoriteControls({favorites,scope,root,translate:key=>key,
    notify:message=>notifications.push(message),changed:ids=>changes.push(ids)});
  await controls.load();
  assert.equal(list.getAttribute('aria-pressed'),'false');
  assert(controls.button(id,'<unsafe>','list').includes('&lt;unsafe&gt;'));
  assert(!controls.button(id,'<unsafe>','list').includes('><unsafe>'));
  const event=button=>({target:{closest:()=>button},stopPropagation(){}});
  root.activeElement=list;listeners.click(event(list));listeners.click(event(detail));
  assert.equal(saves,1,'same service cannot be toggled twice while pending');
  assert(list.disabled && detail.disabled);assert.equal(list.getAttribute('aria-pressed'),'false');
  saving.resolve();await wait();
  assert.equal(language,'fr');assert.equal(list.getAttribute('aria-pressed'),'true');
  assert.equal(detail.getAttribute('aria-pressed'),'true');assert(!list.disabled && !detail.disabled);
  listeners.click(event(detail));await wait();assert.equal(removes,1);
  assert.equal(list.getAttribute('aria-pressed'),'false');assert.equal(detail.getAttribute('aria-pressed'),'false');
  saving=deferred();fail=true;listeners.click(event(list));saving.resolve();await wait();
  assert.equal(list.getAttribute('aria-pressed'),'false','failed persistence must not color the bookmark');
  assert.equal(notifications.at(-1),'favorites.saveError');
  fail=false;saving=deferred();const before=changes.length;
  listeners.click(event(list));scope.dispose();saving.resolve();await wait();
  assert.equal(changes.length,before,'late persistence cannot update a disposed page');
  const pickerScope=new Lifecycle();let chosen=0;
  const pickerControls=createFavoriteControls({favorites:{list:async()=>[]},scope:pickerScope,root,
    listSaved:async()=>[id],chooseList:async()=>{chosen++;},translate:key=>key,notify(){},changed(){}});
  await pickerControls.load();
  assert.equal(list.getAttribute('aria-pressed'),'true','bookmark is selected for a named-list membership');
  assert(!pickerControls.button(id,'Title','list').includes('data-collection-service'),'one bookmark action only');
  listeners.click(event(list));assert.equal(chosen,1,'bookmark opens destination picker instead of toggling favorites');
  pickerScope.dispose();
  // Real page composition routes reconnects to favorites and scrubs an already open withdrawn sheet.
  const browserEvents={};const pageEnv=environment({addEventListener:(name,fn)=>{browserEvents[name]=fn;}});
  const {createMapPage}=await pageEnv.load('pages/map.js');
  let dispatch,refreshes=0,cleared=0,opened=0,lastView,withdrawn=false;
  const feature={mount(){},update(){},dispose(){},summaries(){},detail(){},origin(){},badge:()=>'',shell:()=>'',
    cancelOrigin(){},locate(){},search(){},choose(){},set(){}};
  const page=createMapPage({languageCode:'it',localLayers:false,cityName:'Test'}, {
    i18n:{setLanguage:async()=>{},t:key=>key,translatePage(){}},http:{request(){throw Error('unexpected');}},
    factories:{
      services:({emit})=>{dispatch=emit;return {load:async()=>({pois:[{id}]}),update:view=>{lastView=view;},
        openSaved(){opened++;},show(){},choose(){},refreshHours(){},describe:()=>({}),dispose(){},
        savedServices:view=>withdrawn?[{id,favoriteUnavailable:true}]:view.pois,
        reloadFavorites:async()=>{refreshes++;},clearDetail:()=>{cleared++;}};},
      map:()=>({mount(){},update(){},dispose(){},attach(){},center(){},contains:()=>true,invalidate(){}}),
      search:()=>({select:view=>view.pois,update(){}}),origin:()=>feature,transport:()=>feature,cycleways:()=>feature,
      shell:()=>({bind(){},layout(){},translate(){},close(){},toggle(){},update(){},languages(){},cities(){},toast(){}}),
    },
  });
  try {
    await page.mount();dispatch('showFavorites');assert.equal(opened,1,'menu opens the saved-place panel');dispatch('savedMap',{id:'favorites',name:'Preferiti',entries:[]});browserEvents.online();assert.equal(refreshes,1);
    browserEvents.online();assert.equal(refreshes,2,'reconnection refreshes the active favorites view');
    dispatch('select',{id});pageEnv.get('sheet-detail').classList.add('shown');withdrawn=true;
    dispatch('favoritesChanged',{unavailable:[id]});
    assert.equal(cleared,1,'authoritative withdrawal clears existing detail DOM');
    assert.equal(lastView.pois[0].favoriteUnavailable,true,'the list retains only an unavailable marker');
    dispatch('allServices');assert.equal(lastView.pois.length,0,'withdrawn live card cannot be reopened from stale catalog data');
    browserEvents.online();assert.equal(refreshes,2,'reconnect does not refresh an inactive favorites view');
  } finally {page.dispose();}
  // The exit must remain available in the menu even when the empty list is hidden by map view.
  const shellEnv=environment();const {createShell}=await shellEnv.load('pages/shell.js');
  const shellState={filters:{favoritesOnly:true},view:'map',city:'Test',lang:'it'};
  const shellEvents=[];const navigation=createShell({state:shellState,scope,
    i18n:{t:key=>key},actions:{},emit:event=>shellEvents.push(event)});
  navigation.bind();navigation.update();
  assert.equal(shellEnv.get('favorites-menu-all').hidden,false,'map favorites have a menu exit');
  shellEnv.get('favorites-menu-all').click();assert.equal(shellEvents.at(-1),'allServices');
  assert.equal(shellEnv.get('saved-map-nav').hidden,false);
  shellEnv.get('saved-map-back').click();assert.equal(shellEvents.at(-1),'showFavorites','map has a direct return to saved lists');
  shellEnv.get('saved-list-back').click();assert.equal(shellEvents.at(-1),'showFavorites','list view has the same return');
  shellState.view='list';navigation.update();
  assert.equal(shellEnv.get('favorites-menu-all').hidden,false,'empty list retains the same menu exit');
  shellState.filters.favoritesOnly=false;navigation.update();
  assert.equal(shellEnv.get('favorites-menu-all').hidden,true,'catalog hides the redundant exit');
  assert.equal(shellEnv.get('saved-map-nav').hidden,true);assert.equal(shellEnv.get('saved-list-back').hidden,true);
  console.log('PASS: shared list/detail bookmarks, escaped labels, pending deduplication, storage failures and lifecycle isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
