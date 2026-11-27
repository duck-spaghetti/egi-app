import {reconcileMarkup,forgetMarkup} from '../../reconcile.js';
import {escapeHtml,categoryCaption,folded,distanceKm} from "../../format.js";
/** createSearch owns its behavior; dependencies and snapshots are explicit. */
export function createSearch({scope,describe,emit,debug=false,translate=(_key,_params,fallback)=>fallback}) {
let state={pois:[],categories:[],filters:{cats:new Set(),offersOff:new Set()},taxonomy:{}};
let facets=null;
const DEBUG_MODE=debug;
const POSITION_ISSUES={no_address:'Indirizzo mancante',no_street:'Via mancante',no_street_unresolved:'Via mancante, non trovata',unresolved:'Indirizzo non trovato',municipality_only:'Trovato solo il comune',postcode_area_only:'Trovato solo il CAP',ambiguous:'Indirizzo ambiguo',no_coordinates:'Coordinate mancanti (Helpinet)'};

function activeFilterLabels(withSource = true) {
  const f = state.filters;
  const needLabel = Object.fromEntries((state.taxonomy.needs || []).map(n => [n.slug, n.label]));
  return [
    ...[...f.cats].map(slug => categoryCaption(needLabel[slug] || slug)),
    f.offersOff.size ? `${f.offersOff.size} ${f.offersOff.size === 1 ? "prestazione esclusa" : "prestazioni escluse"}` : "",
    f.q?.trim() ? `“${f.q.trim()}”` : "",
    f.openNow ? "Aperti ora" : "",
    f.source && withSource ? selectedLabel("source-filter", f.source) : "",
    f.issue ? selectedLabel("issue-filter", f.issue) : "",
    f.audience ? selectedLabel("audience-filter", f.audience) : "",
    f.meal ? ((state.taxonomy.meal_times || []).find(m => m.code === f.meal) || {}).label || f.meal : "",
    f.level ? `Livello ${((state.taxonomy.course_levels||[]).find(row=>row.code===f.level)?.label||f.level)}` : "",
    f.access ? selectedLabel("access-filter", f.access) : "",
    f.section !== "all" ? document.getElementById("section-filter")?.selectedOptions?.[0]?.textContent : "",
  ].filter(Boolean);
}

function renderCatGrid() {
  const wrap = document.getElementById("cat-grid");
  const html=state.categories.map(category=>{
    const slug=category.slug,n=facets?.cats.get(slug)||0,on=state.filters.cats.has(slug);
    return `<button type="button" class="cat-tile${on?' active':''}${n?'':' empty'}" data-need="${escapeHtml(slug)}" aria-pressed="${on}">${describe({category,category_id:category.id,raw:{}}).categoryBadge}<span class="cat-count" aria-label="${n} servizi">${n}</span></button>`;
  }).join('');
  reconcileMarkup(wrap,html,{fallback:()=>document.querySelector('#sheet-filters.shown [data-close]')||document.getElementById('view-toggle')});
  renderOfferGroups();
}

/** For each chosen need, its offers as chips (all on at first) and, for Mangiare, the meal. */

function renderOfferGroups() {
  const wrap = document.getElementById("offer-groups");
  const hint = document.getElementById("need-hint");
  if (!wrap) return;
  const f = state.filters;
  if (hint) hint.hidden = f.cats.size > 0;
  const counts = facets?.offer || new Map();
  const mealCounts = facets?.meal || new Map();
  const levelCounts = facets?.level || new Map();
  const html = state.categories.filter(c => f.cats.has(c.slug)).map(c => {
    const offers = (state.taxonomy.offers || []).filter(o => o.need === c.slug && counts.get(o.code));
    const chips = offers.map(o => {
      const on = !f.offersOff.has(o.code);
      return `<button type="button" class="offer-chip${on ? " on" : ""}" aria-pressed="${on}" data-offer="${escapeHtml(o.code)}">${escapeHtml(o.label)} <span>${counts.get(o.code)}</span></button>`;
    }).join("");
    const meals = c.slug === "mangiare" ? (state.taxonomy.meal_times || []).filter(m => mealCounts.get(m.code) || f.meal === m.code) : [];
    const meal = meals.length ? `<label class="offer-meal" data-control="meal">Pasto <select data-meal><option value="">Qualsiasi</option>${meals.map(m => `<option value="${escapeHtml(m.code)}"${f.meal === m.code ? " selected" : ""}>${escapeHtml(m.label)} (${mealCounts.get(m.code) || 0})</option>`).join("")}</select></label>` : "";
    // Course level (Scuolemigranti, user 2026-11-16): only sites that state that level.
    const levels = c.slug === "istruzione" ? (state.taxonomy.course_levels || []).filter(l => levelCounts.get(l.code) || f.level === l.code) : [];
    const level = levels.length ? `<label class="offer-meal" data-control="level">Livello del corso <select data-level><option value="">Qualsiasi</option>${levels.map(l => `<option value="${escapeHtml(l.code)}"${f.level === l.code ? " selected" : ""}>${escapeHtml(l.label)} (${levelCounts.get(l.code) || 0})</option>`).join("")}</select></label>` : "";
    return `<div class="offer-group" data-need-group="${escapeHtml(c.slug)}"><h4>${escapeHtml(categoryCaption(c.label || c.slug))}</h4><div class="offer-chips">${chips || '<span class="source-note">Nessuna prestazione con i filtri attivi.</span>'}</div>${meal}${level}</div>`;
  }).join("");
  reconcileMarkup(wrap,html,{fallback:()=>document.querySelector('#sheet-filters.shown [data-close]')||document.getElementById('view-toggle')});
  const meal=wrap.querySelector('[data-meal]'),level=wrap.querySelector('[data-level]');
  if(meal)meal.value=f.meal||'';if(level)level.value=f.level||'';
}

function selectedLabel(id, fallback) {
  return (document.getElementById(id)?.selectedOptions?.[0]?.textContent || fallback).replace(/ \(\d+\)$/, "");
}

/** Active filters as compact chips under the list toolbar, plus a count on its Filtri button. */

function renderActiveFilters() {
  const chips = activeFilterLabels();
  const reset = document.getElementById("reset-filters");
  if (reset) reset.hidden = !activeFilterLabels(false).length;  // the source survives a reset
  const summary = document.getElementById("active-filter-summary");
  if (!summary) return;
  summary.innerHTML = chips.length
    ? chips.map(c => `<span class="filter-chip">${escapeHtml(c)}</span>`).join("")
    : `<span class="filter-none">${state.filters.favoritesOnly ? escapeHtml(translate('favorites.onDevice',{},'Servizi salvati sul dispositivo')) : "Nessun filtro attivo · tutti i servizi"}</span>`;
  const count = document.getElementById("list-filter-count");
  if (count) { count.hidden = !chips.length; count.textContent = String(chips.length); }
}

function searchTerms() {
  return state.filters.q?.trim() ? folded(state.filters.q).split(/\s+/).filter(Boolean) : [];
}

/** Values a POI contributes to one filter facet (for counts and matching). */

function facetValues(poi, facet) {
  const raw = poi.raw || {};
  if (facet === "cats") return raw.needs?.length ? raw.needs : [describe(poi).category?.slug || "other"];
  if (facet === "source") return [describe(poi).sourceCode];
  if (facet === "offer") return (raw.offers || []).map(o => o.code);
  if (facet === "audience") return (raw.audiences || []).map(a => a.code);
  if (facet === "meal") return (raw.meal_times || []).map(m => m.code);
  if (facet === "level") return raw.course_levels || [];
  if (facet === "issue") return raw.placement?.issue && raw.placement.issue !== "ok" && raw.placement.issue !== "manual" ? [raw.placement.issue] : [];
  if (facet === "access") return raw.access_tags ? raw.access_tags.map(a => a.code) : Object.entries(raw.access_raw || {}).filter(([, v]) => v === true).map(([k]) => k);
  return [];
}

/** Does a POI pass every active filter, optionally ignoring one facet (faceted counts)? */

function passesFilters(p, skip = null, now = new Date(), terms = searchTerms()) {
  const f = state.filters;
  // Need first (filters r4): no need chosen = every service; within a chosen need the
  // service passes unless all its offers there are switched off.
  if (skip !== "cats" && f.cats.size) {
    const offers = p.raw?.offers || [];
    const ok = facetValues(p, "cats").some(slug => {
      if (!f.cats.has(slug)) return false;
      const mine = offers.filter(o => o.need === slug);
      return skip === "offer" || !mine.length || mine.some(o => !f.offersOff.has(o.code));
    });
    if (!ok) return false;
  }
  for (const facet of ["source", "issue", "access", "audience"]) {
    if (skip !== facet && f[facet] && !facetValues(p, facet).includes(f[facet])) return false;
  }
  if (skip !== "meal" && f.meal && f.cats.has("mangiare") && !facetValues(p, "meal").includes(f.meal)) return false;
  if (skip !== "level" && f.level && f.cats.has("istruzione") && !facetValues(p, "level").includes(f.level)) return false;
  if (terms.length && !terms.every(term => searchableService(p).includes(term))) return false;
  const section = p.raw?.placement?.section;
  if (f.section === "directory" && section !== "directory") return false;
  if (f.section === "services" && section === "directory") return false;
  if (f.section === "needs_position" && (section === "directory" || (p.latitude !== null && p.longitude !== null))) return false;
  if (f.openNow && !["open", "closing"].includes(describe(p,now).status.kind)) return false;
  return true;
}

/** Per-facet counts: each value counted under all the other active filters. */

function facetCounts(now = new Date()) {
  const terms = searchTerms();
  const counts = {cats: new Map(), source: new Map(), issue: new Map(), offer: new Map(), access: new Map(), audience: new Map(), meal: new Map(), level: new Map(), shown: 0};
  for (const p of state.pois) {
    if (passesFilters(p, null, now, terms)) counts.shown++;
    for (const facet of ["cats", "source", "issue", "offer", "access", "audience", "meal", "level"]) {
      if (!passesFilters(p, facet, now, terms)) continue;
      for (const v of facetValues(p, facet)) counts[facet].set(v, (counts[facet].get(v) || 0) + 1);
    }
  }
  return counts;
}

function filteredPois(now = new Date()) {
  const terms = searchTerms();
  let list = state.pois.filter(p => passesFilters(p, null, now, terms)).map(poi=>({...poi,
    category_slug: describe(poi).category?.slug || "other",
    category_color: describe(poi).category?.color || "var(--cat-other)",
    category_label: describe(poi).category?.label || "Altro",
    category_icon_path: describe(poi).category?.icon_path || null}));
  if (state.userLoc) list=list.map(p=>({...p,_dist:p.raw?.placement?.section!=="directory" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) ? distanceKm(state.userLoc,{lat:p.latitude,lng:p.longitude}) : null}));
  return list.sort((a,b)=>{
    const distance=state.filters.order==="distance" && state.userLoc ? (a._dist??Infinity)-(b._dist??Infinity) : 0;
    // "Nome" sorts by the title the card shows (layout r3), then by facility.
    return (Number.isNaN(distance)?0:distance) || describe(a).title.localeCompare(describe(b).title,"it")
      || describe(a).kind.localeCompare(describe(b).kind,"it") || String(a.id).localeCompare(String(b.id));
  });
}

function searchableService(poi) {
  const raw = poi.raw || {};
  return folded([poi.title, raw.name, raw.facility_name, poi.address, raw.organization_raw,
    raw.description, raw.derived_summary?.text, raw.native_classifications?.bisogno,
    raw.native_classifications?.tipologia,
    ...(raw.native_classifications?.prestazioni || []).map(p => p.nome),
    ...(raw.access_display?.sections || []).flatMap(s => s.entries.map(e => e.label)),
    raw.itinerant_source ? "itinerante" : "", describe(poi).sourceName, raw.hours_display?.raw_text,
    ...(raw.hours_display?.days || []).filter(d=>d.intervals.length).flatMap(d=>[d.label,...d.intervals.map(v=>v.label)]),
    ...(raw.contacts || []).map(c => c.value)].filter(Boolean).join(" "));
}

/** Why a service has no map point (importer `issue`, see app/backend/preview.py). */

function fillFacetSelect(select, facet, allLabel, labels) {
  const counts = facets?.[facet] || new Map();
  const selected = state.filters[facet];
  const values = [...labels.keys()].filter(v => counts.get(v) || v === selected)
    .sort((a, b) => labels.get(a).localeCompare(labels.get(b), "it"));
  if (selected && !labels.has(selected)) emit("filter",{key:facet,value:""});
  reconcileMarkup(select,`<option value="">${escapeHtml(allLabel)}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(labels.get(v))} (${counts.get(v) || 0})</option>`).join(""));
  select.value = state.filters[facet];
}

function renderSearchOptions() {
  const access = document.getElementById("access-filter");
  const sources = document.getElementById("source-filter");
  if (!access) return;
  if (!facets) facets = facetCounts();
  const labels = {access: new Map(), audience: new Map(), source: new Map()};
  for (const p of state.pois) {
    const raw = p.raw || {};
    (raw.audiences || []).forEach(a => labels.audience.set(a.code, a.label));
    if (raw.access_tags) raw.access_tags.forEach(a => labels.access.set(a.code, a.label));
    else (raw.access_display?.sections || []).forEach(s => s.entries.filter(e => e.value === true).forEach(e => labels.access.set(e.code, e.label)));
    labels.source.set(describe(p).sourceCode, describe(p).sourceName);
  }
  fillFacetSelect(access, "access", "Qualsiasi modalità di accesso", labels.access);
  const audience = document.getElementById("audience-filter");
  if (audience) fillFacetSelect(audience, "audience", "Per tutte e tutti", labels.audience);
  if (sources) fillFacetSelect(sources, "source", "Tutte le fonti", labels.source);
  const issues = document.getElementById("issue-filter");
  if (issues) issues.closest?.(".issue-filter-wrap")?.toggleAttribute("hidden", !DEBUG_MODE);
  if (issues && DEBUG_MODE) fillFacetSelect(issues, "issue", "Qualsiasi (anche posizioni presenti)", new Map(Object.entries(POSITION_ISSUES)));
}

/** Recount facets and update the filter sheet: total, need tiles and selects. */

function renderFacets(now=new Date()) {
  facets = facetCounts(now);
  const total = document.getElementById("filter-total");
  if (total) {
    const all = state.pois.length;
    total.textContent = facets.shown === all ? `${all} servizi disponibili` : `${facets.shown} servizi su ${all} con i filtri attivi`;
  }
  renderCatGrid();
  renderSearchOptions();
}

/** Source of a service row: Helpinet or one of the map exports (see app/backend/preview.py). */

// Delegate once: removed controls never leave one AbortSignal listener per refresh.
const grid=document.getElementById('cat-grid'),offers=document.getElementById('offer-groups');
grid.addEventListener('click',event=>{const tile=event.target.closest('[data-need]');if(tile&&grid.contains(tile))emit('toggleNeed',{slug:tile.dataset.need});},{signal:scope.signal});
offers?.addEventListener('click',event=>{const chip=event.target.closest('[data-offer]');if(chip&&offers.contains(chip))emit('toggleOffer',{code:chip.dataset.offer});},{signal:scope.signal});
offers?.addEventListener('change',event=>{if(event.target.matches('[data-meal]'))emit('filter',{key:'meal',value:event.target.value});else if(event.target.matches('[data-level]'))emit('filter',{key:'level',value:event.target.value});},{signal:scope.signal});
function update(snapshot,now=new Date()){state=snapshot;renderFacets(now);renderActiveFilters();}
function select(snapshot,now=new Date()){state=snapshot;return filteredPois(now);}

return {update,select,matches:(poi,now)=>passesFilters(poi,null,now),dispose(){state={pois:[],categories:[],filters:{cats:new Set(),offersOff:new Set()},taxonomy:{}};facets=null;for(const id of ['cat-grid','offer-groups','access-filter','audience-filter','source-filter','issue-filter'])forgetMarkup(document.getElementById(id));}};
}
