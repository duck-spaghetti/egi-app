import {reconcileMarkup,reconcileRows,forgetMarkup} from '../../reconcile.js';
import {createCollections} from '../favorites/collections.js';
import {createSavedPanel} from '../favorites/panel.js';
import {createCollectionPicker} from '../favorites/collection-picker.js';
import {createFavorites} from "../favorites/store.js";
import {prepareOffline} from "../favorites/offline.js";
import {createFavoriteControls} from "../favorites/controls.js";
import {createPresentation} from "./presentation.js";
/** createServices owns its behavior; dependencies and snapshots are explicit. */
export function createServices({context,scope,loader,sites,transit,translate,emit}) {
let state={pois:[],categories:[],languages:[],categoryTranslations:[],taxonomy:{course_levels:[]},filters:{cats:new Set(),offersOff:new Set()},lang:context.languageCode||'it',matchedIds:new Set()};
const model=createPresentation({snapshot:()=>state,context,translate});
const {normalizePublicService,normalizeArea,normalizeCategory,mergeServiceCategories,applyCategoryLabels,categoryBadge,formatDistance,sourceOpeningStatus,renderServiceHeader,renderInfoSection,renderHoursSection,renderContactsSection,renderSourcesSection,renderServiceBar,serviceButton,serviceTitle,SERVICE_SECTIONS,escapeHtml,t}=model;
let descriptions=new Map(),refreshTime=null;
/** Memoization belongs to one coherent refresh, including its clock/reference/language context. */
function beginRefresh(snapshot,now=new Date()){state=snapshot;refreshTime=now;descriptions=new Map();}
function describe(poi,now=refreshTime||new Date()){
 if(!refreshTime||now.getTime()!==refreshTime.getTime())return model.describe(poi,now);
 const key=poi.id??poi;if(!descriptions.has(key))descriptions.set(key,model.describe(poi,now));return descriptions.get(key);
}
const closeSheets=()=>emit('closeSheets');
const favorites=context.canonical ? createFavorites({territory:context.profile?.territory_code || 'roma',prepare:prepareOffline}) : null;
const collections=context.canonical?createCollections({territory:context.profile?.territory_code || 'roma',prepare:prepareOffline}):null;
let collectionEntries=new Map();
const chooseSavedList=favorites?createCollectionPicker({favorites,changed:()=>{void refreshSavedPanel();},territory:context.profile?.territory_code || 'roma',scope,translate,notify:message=>emit('toast',{message})}):null;
const favoriteControls=favorites ? createFavoriteControls({favorites,scope,translate,
  listSaved:async()=>{const lists=await collections.list();collectionEntries=new Map(lists.map(list=>[list.id,list.entries]));return lists.flatMap(list=>list.entries.map(entry=>entry.id));},
  chooseList:(control,id,language,copy)=>chooseSavedList(control,id,language,copy || [...collectionEntries.values()].flat().find(entry=>entry.id===id && entry.status==='saved')),
  notify:message=>emit('toast',{message}),changed:()=>emit('favoritesChanged',{
    unavailable:favoriteControls.entries().filter(entry=>entry.status==='unavailable').map(entry=>entry.id)})}) : null;

const savedPanel=favorites && document.getElementById('sheet-saved')?.hasAttribute?.('aria-modal') ? createSavedPanel({favorites,collections,scope,translate,emit,changed:()=>favoriteControls.load(true),renderEntry:(entry,group)=>renderListItem(projectSavedEntry(entry,state.catalogPois || state.pois),{position:`saved-${group}`,selectAttribute:'data-saved-select'})}) : null;

/** Refresh both bookmark membership and the visible library after a committed picker action. */
async function refreshSavedPanel() {
  const loaded=await favoriteControls.load(true);
  if(!loaded || scope.signal.aborted || !savedPanel?.visible())return;
  try{await savedPanel.render();}
  catch(error){if(!scope.signal.aborted)emit('toast',{message:t('lists.error')});}
}

/** Reuse current public cards where available; retain saved copies and scrubbed unavailable entries. */
function savedServices(snapshot) {
  return (snapshot.filters.savedCollection && snapshot.filters.savedCollection!=='favorites' ? collectionEntries.get(snapshot.filters.savedCollection) || [] : favoriteControls?.entries() || []).map(entry=>projectSavedEntry(entry,snapshot.pois));
}
function projectSavedEntry(entry,catalog) {
  const current=catalog.find(poi=>String(poi.id)===entry.id);
  if(entry.status==='saved' && current)return current;
  const raw=entry.status==='saved' ? structuredClone(entry.card) : {
    id:entry.id,name:t('favorites.unavailable'),data_status:'approved_canonical_local',
    description:t('favorites.removedDetails'),sources:[],contacts:[],place:{}};
  raw.hours_display={...raw.hours_display,canonical_opening:{status:'unknown'}};
  return {...normalizePublicService(raw),favoriteSavedAt:entry.updatedAt,
    favoriteLanguage:entry.language,favoriteUnavailable:entry.status==='unavailable'};
}

/** Refresh saved cards for the in-app favorites view without replacing the main catalogue. */
let favoriteRefresh;
async function reloadFavorites() {
  if(!favoriteControls || scope.signal.aborted)return;
  if(favoriteRefresh)return favoriteRefresh;
  favoriteRefresh=(async()=>{
    await favoriteControls.load(true);
    if(scope.signal.aborted)return;
    if(globalThis.navigator?.onLine){
      try {const result=await favorites.refresh();scope.check();await favoriteControls.load(true);
        if(result.failures)emit('toast',{message:t('favorites.refreshError')});
      }catch(error){if(!scope.signal.aborted)emit('toast',{message:t('favorites.refreshError')});}
    }
  })().finally(()=>{favoriteRefresh=undefined;});
  return favoriteRefresh;
}

/** Mark fallback cards as saved copies in their original content language. */
function savedCopyNotice(poi) {
  if(!poi.favoriteSavedAt)return '';
  const stamp=new Date(poi.favoriteSavedAt).toLocaleString(state.lang);
  return `<span class="favorite-snapshot">${escapeHtml(t(poi.favoriteUnavailable ? 'favorites.removedDetails' : 'favorites.snapshot'))}
    ${escapeHtml(t('favorites.updated'))}: ${escapeHtml(stamp)} · ${escapeHtml(t('favorites.contentLanguage'))}: ${escapeHtml(poi.favoriteLanguage.toUpperCase())}</span>`;
}

/** Remove all retained detail markup after an authoritative withdrawal. */
function clearDetail() {
  for(const id of ['detail-top','detail-body','detail-bar'])document.getElementById(id).replaceChildren();
}

async function openDetail(id) {
  const poi=[...state.pois,...(state.catalogPois || [])].find(p=>String(p.id)===String(id));
  if (!poi) return emit("toast",{message:"Servizio non disponibile"});
  const sheet=document.getElementById("sheet-detail");
  sheet.classList.add("service-mode");
  document.getElementById("detail-top").innerHTML=renderServiceHeader(poi,{actions:favoriteControls?.button(poi.id,serviceTitle(poi),'detail') || '',notice:savedCopyNotice(poi)});
  favoriteControls?.sync();
  document.getElementById("detail-body").innerHTML=[
    renderInfoSection(poi), renderHoursSection(poi), renderContactsSection(poi),
    renderArriveSection(poi), renderOtherServices(poi), renderSourcesSection(poi)].join("");
  document.getElementById("detail-bar").innerHTML=renderServiceBar(poi);
  bindServiceButtons();
  bindServiceSheet(poi);
  emit("detailReady",{poi});
  document.querySelector("#sheet-detail .sheet-body").scrollTop=0;
  emit("openSheet",{id:"sheet-detail"});
  document.querySelector("#detail-top .service-close")?.focus();
}

function renderArriveSection(poi) {
  const raw=poi.raw || {};
  const facility=raw.facility_name || raw.name || "";
  // Say how the point was found only when it is not the source's own point or a house number.
  const precise=["source_point"].includes(raw.placement?.status) || /house/.test(raw.placement?.status || "");
  const where=raw.itinerant_source ? "Servizio itinerante: il punto indicato non è una sede fissa." : precise ? "" : raw.placement?.label || "";
  return `<section class="detail-section service-section" id="sec-arrivare"><h3>Come arrivare</h3>
    <p>${facility ? `<strong>${escapeHtml(facility)}</strong><br>` : ""}${escapeHtml(poi.address || "Indirizzo non indicato")}</p>
    ${where ? `<p class="service-note">${escapeHtml(where)}</p>` : ""}
    ${transit.shell(poi)}
  </section>`;
}

/** Other services at the same place: own block above "Fonti e aggiornamenti" (layout r4). */

function renderOtherServices(poi) {
  const siblings=sites.siblings(poi).filter(p=>p.id!==poi.id);
  return siblings.length ? `<section class="detail-section service-section" id="sec-altri"><h3>Altri servizi qui</h3>${siblings.map(item=>serviceButton(item,state.matchedIds.has(item.id))).join("")}</section>` : "";
}

/** The only place that details how reliable the card is (one flag in the header). */

function bindServiceSheet(poi) {
  const top=document.getElementById("detail-top");
  const body=document.getElementById("detail-body");
  top.querySelector("[data-close-service]")?.addEventListener("click",()=>emit("closeSheets"), {signal: scope.signal});
  const mark=id=>top.querySelectorAll(".service-anchors [data-jump]").forEach(b=>b.classList.toggle("on",b.dataset.jump===id));
  let jumpedAt=0;
  const jump=id=>{
    const target=document.getElementById(`sec-${id}`);
    if (!target) return;
    if (target.tagName==="DETAILS") target.open=true;
    if (SERVICE_SECTIONS.some(([key])=>key===id)) mark(id);
    jumpedAt=Date.now();
    body.scrollTo({top:target.offsetTop-body.offsetTop-4,behavior:"smooth"});
  };
  top.querySelectorAll("[data-jump]").forEach(b=>b.addEventListener("click",()=>jump(b.dataset.jump), {signal: scope.signal}));
  body.onscroll=()=>{
    top.classList.toggle("compact", body.scrollTop>24);
    // Keep the requested section while the jump scrolls, and at the end, where a short last
    // section cannot reach the top.
    if (Date.now()-jumpedAt<1000) return;
    const atEnd=body.scrollTop+body.clientHeight>=body.scrollHeight-2;
    const edge=atEnd ? body.scrollTop+body.clientHeight-60 : body.scrollTop+40;
    const passed=SERVICE_SECTIONS.filter(([id])=>{const el=document.getElementById(`sec-${id}`);return el && el.offsetTop-body.offsetTop<=edge;});
    mark((passed[passed.length-1] || SERVICE_SECTIONS[0])[0]);
  };
}

function bindServiceButtons() {
  document.querySelectorAll("[data-service-id]").forEach(button=>button.addEventListener("click",()=>emit("select",{id:button.dataset.serviceId}), {signal: scope.signal}));
}

function openServiceChooser(items, matched = new Set(items.map(p=>p.id))) {
  if (items.length === 1) return emit("select",{id:items[0].id});
  document.getElementById("sheet-detail").classList.remove("service-mode");
  document.getElementById("detail-top").innerHTML = "";
  document.getElementById("detail-bar").innerHTML = "";
  document.querySelector("#sheet-detail .sheet-head h2").textContent = "Scegli il servizio";
  document.getElementById("detail-body").innerHTML = `<h2>${escapeHtml(items[0].raw?.facility_name || "Servizi in questo punto")}</h2><p>${items.length} servizi con questa posizione. Scegli una scheda.</p>${items.map(p=>serviceButton(p,matched.has(p.id))).join("")}<p class="source-note">Servizi nella stessa posizione secondo le fonti; ogni servizio mantiene le proprie caratteristiche.</p>`;
  bindServiceButtons();
  document.querySelector("#sheet-detail .sheet-body").scrollTop=0;
  emit("openSheet",{id:"sheet-detail"});
}
function renderListItem(poi,{position='list',selectAttribute='data-id'}={}) {
    const raw=poi.raw || {};
    const siblings=sites.siblings(poi).length;
    const distance=state.userLoc ? (poi._dist==null ? "Distanza non disponibile" : formatDistance(poi._dist)) : "";
    // Same hierarchy as the service sheet header (layout r3): category, title, place, hours, who.
    const display=describe(poi);
    const status=display.status,today=display.today;
    const who=[display.organiser,...display.sources].filter(Boolean);
    return `<div class="service-list-item" data-id="${escapeHtml(poi.id)}"><button type="button" class="poi-item" ${selectAttribute}="${escapeHtml(poi.id)}"><span class="marker-stripe" style="background:${poi.category_color}"></span><span class="info">
      <span class="meta">${display.categoryBadge}${distance?`<span class="dist">${escapeHtml(distance)}</span>`:""}${raw.itinerant_source?'<span class="dist">Itinerante</span>':""}</span>
      <span class="service-list-title"><span class="name">${escapeHtml(display.title)}</span></span>
      <span class="service-kind">${escapeHtml(display.kind)}${siblings>1?` <span class="service-key">· ${siblings} servizi qui</span>`:""}</span>
      <span class="facility-name">${escapeHtml(poi.address || "")}</span>
      <span class="service-status ${status.kind}" data-opening-service="${escapeHtml(poi.id)}"><strong>${escapeHtml(status.label)}</strong>${today ? `<span class="service-today">${escapeHtml(today)}</span>` : ""}<small hidden></small></span>
      ${transit.badge(poi)}
      <span class="list-who">${escapeHtml(who.join(" · "))} · <span class="list-flag">da verificare</span></span>
      ${savedCopyNotice(poi)}
    </span></button>${favoriteControls?.button(poi.id,display.title,position) || ''}</div>`;
}
function renderList(list) {
  document.getElementById("list-count").textContent=String(list.length);
  const wrap=document.getElementById("poi-list");
  if (!list.length) {
    reconcileMarkup(wrap,`<div class="empty-state"><p>${state.filters.favoritesOnly ? escapeHtml(t('favorites.empty')) : state.filters.section==="directory" ? "Nessun servizio esplicitamente a distanza nei dati selezionati. I servizi senza coordinate restano nell’elenco da localizzare." : "Nessun servizio per questa ricerca."}</p>${state.filters.favoritesOnly ? `<button type="button" class="btn" data-favorites-empty-all>${escapeHtml(t('favorites.showAll'))}</button>` : ''}</div>`);
    wrap.querySelector('[data-favorites-empty-all]')?.addEventListener('click',()=>emit('allServices'),{signal:scope.signal});
    return;
  }
  reconcileRows(wrap,list.map(poi=>({id:poi.id,html:renderListItem(poi)})));
  favoriteControls?.sync();
}
function bindHoursToggle() {
  const toggle = document.querySelector("[data-hours-toggle]");
  const table = document.getElementById("detail-hours-table");
  const label = document.querySelector("[data-hours-toggle-label]");
  if (!toggle || !table) return;

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    table.classList.toggle("collapsed", expanded);
    if (label) {
      label.textContent = expanded
        ? t("map.show_hours", {}, "Mostra orari")
        : t("map.hide_hours", {}, "Nascondi orari");
    }
  }, {signal: scope.signal});
}

function updateOpeningBadges() {
  const today=model.localDayKey();
  document.querySelectorAll('[data-calendar-day]').forEach(el=>{
    const current=el.dataset.calendarDay===today;el.dataset.today=String(current);
    el.setAttribute('aria-current',current?'date':'false');
  });
  // Filter membership must change at opening/closing boundaries as well as labels.

  document.querySelectorAll("[data-opening-service]").forEach(el=>{
    const poi=state.pois.find(p=>String(p.id)===el.dataset.openingService);
    if (!poi) return;
    const status=sourceOpeningStatus(poi.raw?.hours_display);
    el.className=`${el.classList.contains("service-status") ? "service-status" : "source-opening"} ${status.kind}`;
    el.querySelector("strong").textContent=status.label;
    el.querySelector("small").textContent=status.note;
  });
}

/** Render canonical state from the calendar-aware SQL result, without source heuristics. */

/** Only an applicable latest human check can remove the verification reminder. */

async function load(language, targetTranslate=translate) {
 const bundle=await loader.load(language);
 await favoriteControls?.load();
 scope.check();
 const candidate={...state,lang:language,languages:bundle.languages,categoryTranslations:bundle.categoryTranslations,taxonomy:bundle.taxonomy};
 const projection=createPresentation({snapshot:()=>candidate,context,translate:targetTranslate});
 const categories=projection.applyCategoryLabels(projection.mergeServiceCategories(bundle.categories
  .filter(c=>c.area_id==null||Number(c.area_id)===Number(context.cityId)).map(projection.normalizeCategory),bundle.rows));
 return {categories,pois:bundle.rows.map(projection.normalizePublicService).filter(Boolean),languages:bundle.languages,
  cityOptions:bundle.areas.map(projection.normalizeArea),categoryTranslations:bundle.categoryTranslations,taxonomy:{...bundle.taxonomy,needs:(bundle.taxonomy.needs||[]).map(projection.displayCategory)}};
}
const listHost=document.getElementById('poi-list');listHost.addEventListener('click',event=>{if(event.target.closest('[data-favorite-id]'))return;const row=event.target.closest('.poi-item[data-id]');if(row&&listHost.contains(row))emit('select',{id:row.dataset.id});},{signal:scope.signal});
function update(snapshot,list) {state=snapshot;if(list){document.getElementById('list-count').textContent=String(list.length);if(state.view==='list')renderList(list);else if(listHost.childNodes.length){listHost.replaceChildren();forgetMarkup(listHost);}}}
function dispose(){descriptions.clear();refreshTime=null;state={pois:[]};listHost.replaceChildren();forgetMarkup(listHost);document.getElementById('detail-body').onscroll=null;}

return {openSaved:()=>savedPanel?.open(),load,update,beginRefresh,show:openDetail,choose:openServiceChooser,refreshHours:updateOpeningBadges,describe,savedServices,reloadFavorites,clearDetail,dispose};
}
