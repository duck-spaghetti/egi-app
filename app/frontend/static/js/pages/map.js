import {normalizeLang} from "../format.js";
/** Compose one map page; this Module alone owns shared application state. */
import {Lifecycle,startPage} from '../lifecycle.js';
import {createHttp} from '../http.js';
import {createI18n} from '../i18n.js';
import {createLoader} from '../features/services/loader.js';
import {createServices} from '../features/services/index.js';
import {createSites} from '../features/map/sites.js';
import {createMap} from '../features/map/index.js';
import {createSearch} from '../features/search/index.js';
import {createOrigin} from '../features/origin/index.js';
import {createTransport} from '../features/transport/index.js';
import {createCycleways} from '../features/cycleways/index.js';
import {createShell} from './shell.js';
import {saveHandoff,takeHandoff,applyHandoff,switchUrl} from '../features/map/view.js';

export function createMapPage(context, dependencies={}) {
 const scope=dependencies.scope||new Lifecycle();
 const http=dependencies.http||createHttp(scope);
 const i18n=dependencies.i18n||createI18n(scope,http);
 const state={
  categories: [],
  categoryTranslations: [],
  languages: [],
  pois: [],
  transitByPlace: {},
  focusSiteKey: null,
  transitAvailability: "loading",
  cityOptions: [],
  filters: {
    cats: new Set(), offersOff: new Set(),
    q: "", source: "", issue: "", access: "", audience: "", meal: "", level: "", section: "all", order: "name", openNow: false, favoritesOnly: false, savedCollection: null,
  },
  taxonomy: {needs: [], offers: [], audiences: [], access: [], meal_times: [], paths: [], course_levels: []},
  view: "map",
  userLoc: null,
  city: context.cityName || "Territorio",
  lang: normalizeLang(context.languageCode || "it"),
};
 state.matchedIds=new Set();state.selectedId=null;
 const debug=dependencies.debug??new URLSearchParams(globalThis.location?.search||'').has('debug');
 const sites=createSites({context,snapshot:()=>state});
 const factories={map:createMap,services:createServices,search:createSearch,origin:createOrigin,transport:createTransport,cycleways:createCycleways,shell:createShell,...dependencies.factories};
 const loader=createLoader({context,http,scope,debug});
 const transit=factories.transport({scope,http,sites,emit});
 const services=factories.services({context,scope,loader,sites,transit,translate:i18n.t,emit});
 const map=factories.map({context,sites,describe:services.describe,emit,leaflet:dependencies.leaflet||globalThis.L,translate:i18n.t});
 const browser=dependencies.browser||{location:globalThis.location,local:storage('localStorage'),session:storage('sessionStorage')};
 const search=factories.search({scope,describe:services.describe,emit,debug,translate:i18n.t});
 const origin=factories.origin({context,scope,http,contains:map.contains,translate:i18n.t,emit});
 const cycle=factories.cycleways();
 const walking=context.view?.mode==='3d'&&factories.walking?factories.walking({context,scope,translate:i18n.t}):null;
 const buses=context.view?.mode==='3d'&&context.localLayers!==false&&factories.buses?factories.buses({scope,http,translate:i18n.t,container:document.getElementById("live-buses-controls")}):null;
 let mounted=false, loading=null, languageGeneration=0, rendering=false, refreshAgain=false;
 const openingRequests=new Map();scope.own(()=>openingRequests.clear());
 const shell=factories.shell({state,scope,i18n,emit,actions:{refresh,
  renderFilters,resetFilters,
  chooseReferencePoint:origin.choose,geocodeAddress:origin.search,locateUser:origin.locate,loadOriginTransit:transit.origin}});

 function snapshot(){return structuredClone(state);}
 function discoverySnapshot(){
  const view=snapshot();
  if(view.filters.favoritesOnly){view.catalogPois=view.pois;view.pois=services.savedServices(view);}
  return view;
 }
 function storage(name){try{return globalThis[name]||null;}catch{return null;}}
 /** The 3D/current-map control: switch by reloading, carrying state in this tab only. */
 function bindView(){
  const button=document.getElementById('view3d-toggle');if(!button)return;
  const view=context.view||{mode:'2d',available:false,reason:'data'};
  const other=view.mode==='3d'?'2d':'3d';
  button.dataset.view=view.mode;button.setAttribute('aria-pressed',String(view.mode==='3d'));
  const unavailable=other==='3d'&&!view.available;
  const reason=i18n.t(`map.map3d.unavailable_${view.reason||'data'}`,{},'Vista 3D non disponibile.');
  button.setAttribute('aria-disabled',String(unavailable));
  button.title=unavailable?reason:i18n.t(other==='3d'?'map.map3d.open':'map.map3d.close',{},other==='3d'?'Apri la vista 3D':'Torna alla mappa piana');
  button.addEventListener('click',()=>{
   if(unavailable)return shell.toast(reason);
   saveHandoff(browser,other,state);
   browser.location.assign(switchUrl(browser.location,{view:other,lang:state.lang,service:state.selectedId}));
  },{signal:scope.signal});
 }
 /** One directions choice reuses the reference flow and the existing 3D walking owner. */
 function cancelReference(){
  if(!state.pendingWalkId&&!state.choosingReference)return;
  state.pendingWalkId=null;state.choosingReference=false;refresh();
 }
 function walkTo(poi){
  if(!Number.isFinite(poi?.latitude)||!Number.isFinite(poi?.longitude))return;
  if(!walking){
   if(!context.view?.available)return;
   state.pendingWalkId=String(poi.id);saveHandoff(browser,'3d',state);
   browser.location.assign(switchUrl(browser.location,{view:'3d',lang:state.lang,service:poi.id}));return;
  }
  if(!state.userLoc){state.pendingWalkId=String(poi.id);shell.toast(i18n.t('map.walk.reference',{},'Scegli prima un punto di riferimento.'));origin.choose();return;}
  state.pendingWalkId=null;shell.close();if(state.view!=='map')shell.toggle();
  void walking.walk([state.userLoc.lng,state.userLoc.lat],[poi.longitude,poi.latitude]);
 }
 function detailReady(poi){
  const button=document.getElementById('detail-bar')?.querySelector('[data-walk-in-app]');
  button?.addEventListener('click',()=>walkTo(poi),{signal:scope.signal});
  if(state.view==='map'&&Number.isFinite(poi?.latitude)&&Number.isFinite(poi?.longitude)){
   if(map.focusService)map.focusService(poi.latitude,poi.longitude);else map.center(poi.latitude,poi.longitude);
  }
  void transit.detail(poi);
 }
 /** Filters, search text and reference point from the previous view; selected service from the URL. */
 function restore(){
  const data=takeHandoff(browser.session);
  if(data){
   applyHandoff(state,data);
   document.getElementById('service-query').value=state.filters.q||'';
   document.getElementById('open-now-filter').checked=Boolean(state.filters.openNow);
   document.getElementById('section-filter').value=state.filters.section||'all';
  }
  return new URLSearchParams(browser.location?.search||'').get('servizio');
 }
 /** Commit one snapshot/clock to every consumer; reentrant filter repair gets a fresh pass. */
 function refresh(){
  if(scope.signal.aborted)return;
  if(rendering){refreshAgain=true;return;}
  rendering=true;
  try{do{
   refreshAgain=false;
   const now=new Date();sites.reset();const view=discoverySnapshot();
   if(services.beginRefresh)services.beginRefresh(view,now);else services.update(view);
   const list=search.select(view,now);state.matchedIds=new Set(list.map(row=>row.id));view.matchedIds=state.matchedIds;
   transit.update(view);origin.update(view);services.update(view,list);search.update(view,now);
   map.update(view,state.focusSiteKey?view.pois.filter(row=>sites.key(row)===state.focusSiteKey):list);
   shell.update();
  }while(refreshAgain&&!scope.signal.aborted);}finally{rendering=false;}
 }
 function renderFilters(){shell.languages();shell.cities();}
 function resetFilters(){
  Object.assign(state.filters,{cats:new Set(),offersOff:new Set(),q:'',issue:'',access:'',audience:'',meal:'',level:'',section:'all',openNow:false,favoritesOnly:false,savedCollection:null});
  state.savedEntries=null;state.savedListName=null;
  document.getElementById('service-query').value='';document.getElementById('open-now-filter').checked=false;
  document.getElementById('section-filter').value='all';refresh();
 }
 function select(id){
  if(scope.signal.aborted)return;
  if(String(state.selectedId)!==String(id)){
   walking?.clear();
   if(state.pendingWalkId!==String(id))cancelReference();
  }
  state.selectedId=id;refresh();void services.show(id);
 }
 async function language(code){
  const generation=++languageGeneration;
  try{
   const dictionary=await i18n.prepareLanguage(code);scope.check();if(generation!==languageGeneration)return;
   const data=await services.load(code,dictionary.t);scope.check();if(generation!==languageGeneration)return;
   if(!dictionary.commit())return;
   const chosen=new Set(state.filters.cats);Object.assign(state,data);state.lang=code;
   state.filters.cats=new Set(state.categories.map(row=>row.slug).filter(slug=>chosen.has(slug)));
   refresh();renderFilters();shell.translate();walking?.clear();buses?.refreshLabels();shell.close();
   if(state.selectedId)select(state.selectedId);
  }catch(error){if(!scope.signal.aborted && generation===languageGeneration)shell.toast('Catalogo temporaneamente non disponibile. Riprova.');}
 }
 /** Share only the current language-generation request; never retain a settled response. */
 function refreshOpening(){
  if(!context.canonical||scope.signal.aborted)return;
  const generation=languageGeneration,code=state.lang,key=`${generation}:${code}`;
  if(openingRequests.has(key))return openingRequests.get(key);
  const request=(async()=>{
   try{if(state.filters.favoritesOnly)await services.reloadFavorites();const data=await services.load(code);scope.check();if(generation!==languageGeneration||code!==state.lang)return;Object.assign(state,data);refresh();services.refreshHours();}
   catch(error){if(!scope.signal.aborted&&generation===languageGeneration)services.refreshHours();}
   finally{if(openingRequests.get(key)===request)openingRequests.delete(key);}
  })();openingRequests.set(key,request);return request;
 }
 function emit(type,payload={}){
  if(scope.signal.aborted)return;
  switch(type){
   case 'favoritesChanged':{
    const unavailable=new Set(payload.unavailable || []);
    const closeSelected=unavailable.has(String(state.selectedId));
    if(unavailable.size)state.pois=state.pois.filter(poi=>!unavailable.has(String(poi.id)));
    if(mounted && (state.filters.favoritesOnly || unavailable.size))refresh();
    if(closeSelected){
      const shown=document.getElementById('sheet-detail').classList.contains('shown');
      if(shown)shell.close();services.clearDetail();state.selectedId=null;
      if(shown)document.getElementById('list-title')?.focus();
    }
    break;}

   case 'showFavorites':void services.openSaved?.();break;
   case 'savedMap':resetFilters();state.filters.favoritesOnly=true;state.filters.savedCollection=payload.id;
    state.savedEntries=payload.entries;state.savedListName=payload.name;state.focusSiteKey=null;
    shell.close();if(state.view!=='map')shell.toggle();refresh();
    if(payload.selectId)select(payload.selectId);break;
   case 'allServices':shell.close();resetFilters();
    document.getElementById(state.view==='list' ? 'list-title' : 'view-toggle')?.focus();break;
   case 'filter':state.filters[payload.key]=payload.value;refresh();break;
   case 'toggleNeed':{
    const slug=payload.slug;
    if(state.filters.cats.has(slug)){
     state.filters.cats.delete(slug);(state.taxonomy.offers||[]).filter(row=>row.need===slug).forEach(row=>state.filters.offersOff.delete(row.code));
     if(slug==='mangiare')state.filters.meal='';if(slug==='istruzione')state.filters.level='';
    }else state.filters.cats.add(slug);
    refresh();break;}
   case 'toggleOffer':if(state.filters.offersOff.has(payload.code))state.filters.offersOff.delete(payload.code);else state.filters.offersOff.add(payload.code);refresh();break;
   case 'select':select(payload.id);break;
   case 'choose':services.choose(payload.items,payload.matched);break;
   case 'map3dVersionConflict':
    saveHandoff(browser,'3d',state);
    browser.location.assign(switchUrl(browser.location,{view:'3d',lang:state.lang,service:state.selectedId}));break;
   case 'map3dBudget':{
    const button=document.getElementById('view3d-toggle');
    const text=i18n.t('map.map3d.slow',{},'La vista 3D è lenta su questo dispositivo: puoi tornare alla mappa piana.');
    if(button){button.dataset.warning='true';button.title=text;}
    shell.toast(text);break;}
   case 'detailReady':detailReady(payload.poi);break;
   case 'openSheet':shell.open(payload.id);break;
   case 'closeSheets':cancelReference();shell.close();break;
   case 'cancelReference':cancelReference();break;
   case 'showMap':shell.close();if(state.view!=='map')shell.toggle();break;
   case 'toast':shell.toast(payload.message);break;
   case 'invalidateMap':map.invalidate();break;
   case 'center':map.center(payload.lat,payload.lng);break;
   case 'pickedReference':origin.set(payload.lat,payload.lng,payload.label);break;
   case 'previewVisibility':map.servicesVisible(payload.visible);break;
   case 'reference':walking?.clear();state.choosingReference=false;state.userLoc=payload;state.filters.order='distance';refresh();transit.referenceChanged();map.center(payload.lat,payload.lng);{const poi=state.pendingWalkId&&state.pois.find(p=>String(p.id)===state.pendingWalkId);if(poi)walkTo(poi);}break;
   case 'chooseReference':state.choosingReference=true;refresh();shell.close();if(state.view!=='map')shell.toggle();break;
   case 'referenceCleared':walking?.clear();cancelReference();refresh();break;
   case 'originTransit':void transit.origin();break;
   case 'transit':state.transitByPlace=payload.places;state.transitAvailability=payload.availability;refresh();break;
   case 'focus':state.focusSiteKey=payload.key;refresh();break;
   case 'language':void language(payload.language);break;
   case 'refresh':refresh();break;
  }
 }
 async function mount(){
  if(loading)return loading;if(mounted||scope.signal.aborted)return;
  const generation=++languageGeneration;
  loading=(async()=>{
   try{
    await i18n.setLanguage(state.lang);scope.check();
    map.mount();mounted=true;scope.own(map.dispose);scope.own(sites.dispose);
    scope.own(search.dispose||(()=>{}));scope.own(services.dispose);scope.own(origin.dispose);scope.own(transit.dispose);scope.own(cycle.dispose);
    shell.bind();shell.layout();shell.translate();bindView();
    if(walking){walking.mount(map.attach);scope.own(walking.dispose);}
    if(buses){buses.mount(map.attach);scope.own(buses.dispose);}
    if(context.localLayers!==false){transit.mount(map.attach);cycle.mount(map.attach);}
    if(!context.canonical && debug && context.view?.mode!=='3d'){
     const {DebugSources}=await import('../features/preview/debug.js');scope.check();
     const debugPanel=map.attach(leafletMap=>DebugSources.create(leafletMap,{scope,http,setServicesVisible:visible=>emit('previewVisibility',{visible}),openDetail:id=>select(id)}));
     scope.own(debugPanel.dispose);
    }
    const data=await services.load(state.lang);scope.check();if(generation!==languageGeneration)return;Object.assign(state,data);
    const chosen=restore();
    refresh();renderFilters();
    if(state.userLoc)transit.referenceChanged();
    const service=chosen&&state.pois.find(row=>String(row.id)===chosen);
    if(service){select(service.id);if(state.pendingWalkId===String(service.id))walkTo(service);}
    if(context.localLayers!==false){void transit.summaries();scope.every(transit.summaries,300000);}
    scope.every(()=>{refresh();services.refreshHours();void refreshOpening();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();services.refreshHours();void refreshOpening();}},{signal:scope.signal});
    globalThis.addEventListener?.('online',()=>{if(state.filters.favoritesOnly)void services.reloadFavorites();},{signal:scope.signal});
   }catch(error){
    if(scope.signal.aborted)return;
    document.getElementById('poi-list').innerHTML='<div class="empty-state"><p>Catalogo temporaneamente non disponibile. Riprova.</p></div>';
    if(state.view!=='list')shell.toggle();
   }
  })();return loading;
 }
 return {mount,dispose:()=>scope.dispose()};
}

export function startMapPage(context=globalThis.window.EGI_MAP_CONTEXT,dependencies={}){
 return startPage(()=>createMapPage(context,dependencies));
}
