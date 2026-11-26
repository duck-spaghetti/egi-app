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
    q: "", source: "", issue: "", access: "", audience: "", meal: "", level: "", section: "all", order: "name", openNow: false,
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
 const search=factories.search({scope,describe:services.describe,emit,debug});
 const origin=factories.origin({context,scope,http,contains:map.contains,translate:i18n.t,emit});
 const cycle=factories.cycleways();
 const walking=context.view?.mode==='3d'&&factories.walking?factories.walking({context,scope,translate:i18n.t}):null;
 const buses=context.view?.mode==='3d'&&context.localLayers!==false&&factories.buses?factories.buses({scope,http,translate:i18n.t,container:document.getElementById("live-buses-controls")}):null;
 let mounted=false, loading=null, languageGeneration=0, refreshInFlight=false;
 const shell=factories.shell({state,scope,i18n,emit,actions:{refresh,
  renderFilters:renderFilters,renderSearchOptions:()=>search.update(snapshot()),resetFilters,
  chooseReferencePoint:origin.choose,geocodeAddress:origin.search,locateUser:origin.locate,loadOriginTransit:transit.origin}});

 function snapshot(){return structuredClone(state);}
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
 /** "Look at the building" in the service sheet, only with a map module that can (3D mode). */
 function lookButton(poi){
  if(typeof map.lookAt!=='function'||!Number.isFinite(poi?.latitude)||!Number.isFinite(poi?.longitude))return;
  const bar=document.getElementById('detail-bar');if(!bar)return;
  const button=document.createElement('button');button.type='button';button.className='btn look3d';
  button.textContent=i18n.t('map.map3d.look',{},"Guarda l'edificio");
  button.addEventListener('click',()=>{shell.close();map.lookAt(poi.latitude,poi.longitude);},{signal:scope.signal});
  bar.appendChild(button);
  if(walking){
   const walk=document.createElement('button');walk.type='button';walk.className='btn walk3d';
   walk.textContent=i18n.t('map.walk.action',{},'Vai a piedi');
   walk.addEventListener('click',()=>{
    if(!state.userLoc){shell.toast(i18n.t('map.walk.reference',{},'Scegli prima un punto di riferimento.'));origin.choose();return;}
    shell.close();if(state.view!=='map')shell.toggle();
    void walking.walk([state.userLoc.lng,state.userLoc.lat],[poi.longitude,poi.latitude]);
   },{signal:scope.signal});bar.appendChild(walk);
  }
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
 function refresh(){
  if(scope.signal.aborted)return;
  let view=snapshot();services.update(view);transit.update(view);origin.update(view);
  const list=search.select(view);state.matchedIds=new Set(list.map(row=>row.id));view=snapshot();
  services.update(view,list);search.update(view);
  map.update(view,state.focusSiteKey?state.pois.filter(row=>sites.key(row)===state.focusSiteKey):list);
  shell.update();
 }
 function renderFilters(){search.update(snapshot());shell.languages();shell.cities();}
 function resetFilters(){
  Object.assign(state.filters,{cats:new Set(),offersOff:new Set(),q:'',issue:'',access:'',audience:'',meal:'',level:'',section:'all',openNow:false});
  document.getElementById('service-query').value='';document.getElementById('open-now-filter').checked=false;
  document.getElementById('section-filter').value='all';refresh();
 }
 function select(id){
  if(scope.signal.aborted)return;
  state.selectedId=id;refresh();void services.show(id);
 }
 async function language(code){
  const generation=++languageGeneration;
  try{
   await i18n.setLanguage(code);scope.check();
   const data=await services.load(code);scope.check();if(generation!==languageGeneration)return;
   const chosen=new Set(state.filters.cats);Object.assign(state,data);state.lang=code;
   state.filters.cats=new Set(state.categories.map(row=>row.slug).filter(slug=>chosen.has(slug)));
   refresh();renderFilters();shell.translate();walking?.clear();buses?.refreshLabels();shell.close();
   if(state.selectedId)select(state.selectedId);
  }catch(error){if(!scope.signal.aborted && generation===languageGeneration)shell.toast('Catalogo temporaneamente non disponibile. Riprova.');}
 }
 async function refreshOpening(){
  if(!context.canonical || refreshInFlight || scope.signal.aborted)return;
  refreshInFlight=true;
  const generation=languageGeneration;
  try{const data=await services.load(state.lang);scope.check();if(generation!==languageGeneration)return;Object.assign(state,data);refresh();services.refreshHours();}
  catch(error){if(!scope.signal.aborted)services.refreshHours();}
  finally{refreshInFlight=false;}
 }
 function emit(type,payload={}){
  if(scope.signal.aborted)return;
  switch(type){
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
   case 'map3dBudget':{
    const button=document.getElementById('view3d-toggle');
    const text=i18n.t('map.map3d.slow',{},'La vista 3D è lenta su questo dispositivo: puoi tornare alla mappa piana.');
    if(button){button.dataset.warning='true';button.title=text;}
    shell.toast(text);break;}
   case 'detailReady':lookButton(payload.poi);void transit.detail(payload.poi);break;
   case 'openSheet':shell.open(payload.id);break;
   case 'closeSheets':shell.close();break;
   case 'showMap':shell.close();if(state.view!=='map')shell.toggle();break;
   case 'toast':shell.toast(payload.message);break;
   case 'invalidateMap':map.invalidate();break;
   case 'center':map.center(payload.lat,payload.lng);break;
   case 'pickedReference':origin.set(payload.lat,payload.lng,payload.label);break;
   case 'previewVisibility':map.servicesVisible(payload.visible);break;
   case 'reference':walking?.clear();state.choosingReference=false;state.userLoc=payload;state.filters.order='distance';refresh();transit.referenceChanged();map.center(payload.lat,payload.lng);break;
   case 'chooseReference':state.choosingReference=true;refresh();shell.close();if(state.view!=='map')shell.toggle();break;
   case 'referenceCleared':walking?.clear();refresh();break;
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
    map.mount();mounted=true;scope.own(map.dispose);
    scope.own(services.dispose);scope.own(origin.dispose);scope.own(transit.dispose);scope.own(cycle.dispose);
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
    if(service)select(service.id);
    if(context.localLayers!==false){void transit.summaries();scope.every(transit.summaries,300000);}
    scope.every(()=>{services.refreshHours();if(state.filters.openNow)refresh();void refreshOpening();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){services.refreshHours();void refreshOpening();}},{signal:scope.signal});
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
