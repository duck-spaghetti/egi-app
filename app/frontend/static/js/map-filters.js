/** Discovery filters, facets and list rendering. */
import { categoryColor, normalizeCategoryIconPath, normalizeEmbeddedCategory } from "./map-data.js";
import { POSITION_ISSUES, categoryBadge, formatDistance, openDetail, serviceKind, serviceOrganiser, serviceTitle, sourceCode, sourceName, sourceNames } from "./map-details.js";
import { courseLevelLabel, sourceOpeningStatus, todayHours } from "./map-hours.js";
import { renderCityList, renderLanguageList } from "./map-shell.js";
import { DEBUG_MODE, runtime, state } from "./map-state.js";
import { transitBadge } from "./map-transit.js";
import { categoryCaption, distanceKm, escapeHtml, folded } from "./map-utils.js";
import { renderMarkers, sameSourceGroup, sourceSiteKey } from "./map-view.js";

export function resetFilters() {
  Object.assign(state.filters, {cats: new Set(), offersOff: new Set(), q: "", issue: "", access: "", audience: "", meal: "", level: "", section: "all", openNow: false});
  document.getElementById("service-query").value = "";
  document.getElementById("open-now-filter").checked = false;
  document.getElementById("section-filter").value = "all";
  renderCatGrid();
  renderSearchOptions();
  refresh();
}

/** Filters that differ from "every service"; `withSource` false leaves out the kept source. */

export function activeFilterLabels(withSource = true) {
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
    f.level ? `Livello ${courseLevelLabel(f.level)}` : "",
    f.access ? selectedLabel("access-filter", f.access) : "",
    f.section !== "all" ? document.getElementById("section-filter")?.selectedOptions?.[0]?.textContent : "",
  ].filter(Boolean);
}

export function renderFilters() {
  renderCatGrid();
  renderSearchOptions();
  renderLanguageList();
  renderCityList();
}



/* "Vicino a": lines near a service's place (see app/backend/transit_nearby.py). */

export function renderCatGrid() {
  const wrap = document.getElementById("cat-grid");
  wrap.innerHTML = "";

  state.categories.forEach((category) => {
    const slug = category.slug;
    const label = categoryCaption(category.label || category.slug);
    const color = category.color || categoryColor(slug);
    const tile = document.createElement("button");
    tile.className = `cat-tile${state.filters.cats.has(slug) ? " active" : ""}`;
    tile.setAttribute("aria-pressed", String(state.filters.cats.has(slug)));
    const n = state.facets?.cats.get(slug) || 0;
    tile.innerHTML = `${categoryBadge(category)}<span class="cat-count" aria-label="${n} servizi">${n}</span>`;
    tile.classList.toggle("empty", n === 0);
    tile.addEventListener("click", () => {
      if (state.filters.cats.has(slug)) {
        state.filters.cats.delete(slug);
        (state.taxonomy.offers || []).filter(o => o.need === slug).forEach(o => state.filters.offersOff.delete(o.code));
        if (slug === "mangiare") state.filters.meal = "";
        if (slug === "istruzione") state.filters.level = "";
      } else state.filters.cats.add(slug);
      renderCatGrid();
      renderSearchOptions();
      refresh();
    }, {signal: runtime.lifecycle?.signal});
    wrap.append(tile);
  });
  renderOfferGroups();
}

/** For each chosen need, its offers as chips (all on at first) and, for Mangiare, the meal. */

export function renderOfferGroups() {
  const wrap = document.getElementById("offer-groups");
  const hint = document.getElementById("need-hint");
  if (!wrap) return;
  const f = state.filters;
  if (hint) hint.hidden = f.cats.size > 0;
  const counts = state.facets?.offer || new Map();
  const mealCounts = state.facets?.meal || new Map();
  const levelCounts = state.facets?.level || new Map();
  wrap.innerHTML = state.categories.filter(c => f.cats.has(c.slug)).map(c => {
    const offers = (state.taxonomy.offers || []).filter(o => o.need === c.slug && counts.get(o.code));
    const chips = offers.map(o => {
      const on = !f.offersOff.has(o.code);
      return `<button type="button" class="offer-chip${on ? " on" : ""}" aria-pressed="${on}" data-offer="${escapeHtml(o.code)}">${escapeHtml(o.label)} <span>${counts.get(o.code)}</span></button>`;
    }).join("");
    const meals = c.slug === "mangiare" ? (state.taxonomy.meal_times || []).filter(m => mealCounts.get(m.code) || f.meal === m.code) : [];
    const meal = meals.length ? `<label class="offer-meal">Pasto <select data-meal><option value="">Qualsiasi</option>${meals.map(m => `<option value="${escapeHtml(m.code)}"${f.meal === m.code ? " selected" : ""}>${escapeHtml(m.label)} (${mealCounts.get(m.code) || 0})</option>`).join("")}</select></label>` : "";
    // Course level (Scuolemigranti, user 2026-11-16): only sites that state that level.
    const levels = c.slug === "istruzione" ? (state.taxonomy.course_levels || []).filter(l => levelCounts.get(l.code) || f.level === l.code) : [];
    const level = levels.length ? `<label class="offer-meal">Livello del corso <select data-level><option value="">Qualsiasi</option>${levels.map(l => `<option value="${escapeHtml(l.code)}"${f.level === l.code ? " selected" : ""}>${escapeHtml(l.label)} (${levelCounts.get(l.code) || 0})</option>`).join("")}</select></label>` : "";
    return `<div class="offer-group"><h4>${escapeHtml(categoryCaption(c.label || c.slug))}</h4><div class="offer-chips">${chips || '<span class="source-note">Nessuna prestazione con i filtri attivi.</span>'}</div>${meal}${level}</div>`;
  }).join("");
  wrap.querySelectorAll("[data-offer]").forEach(b => b.addEventListener("click", () => {
    const code = b.dataset.offer;
    if (f.offersOff.has(code)) f.offersOff.delete(code); else f.offersOff.add(code);
    refresh();
  }, {signal: runtime.lifecycle?.signal}));
  wrap.querySelector("[data-meal]")?.addEventListener("change", e => { f.meal = e.target.value; refresh(); }, {signal: runtime.lifecycle?.signal});
  wrap.querySelector("[data-level]")?.addEventListener("change", e => { f.level = e.target.value; refresh(); }, {signal: runtime.lifecycle?.signal});
}

export function refresh() {
  renderFacets();
  renderActiveFilters();
  const list = filteredPois();
  // In the transport focus view only the focused service's site stays on the map.
  renderMarkers(state.focusSiteKey ? state.pois.filter(poi => sourceSiteKey(poi) === state.focusSiteKey) : list);
  renderList(list);
}

/** Text of a select's chosen option without its "(count)" suffix. */

export function selectedLabel(id, fallback) {
  return (document.getElementById(id)?.selectedOptions?.[0]?.textContent || fallback).replace(/ \(\d+\)$/, "");
}

/** Active filters as compact chips under the list toolbar, plus a count on its Filtri button. */

export function renderActiveFilters() {
  const chips = activeFilterLabels();
  const reset = document.getElementById("reset-filters");
  if (reset) reset.hidden = !activeFilterLabels(false).length;  // the source survives a reset
  const summary = document.getElementById("active-filter-summary");
  if (!summary) return;
  summary.innerHTML = chips.length
    ? chips.map(c => `<span class="filter-chip">${escapeHtml(c)}</span>`).join("")
    : `<span class="filter-none">Nessun filtro attivo · tutti i servizi</span>`;
  const count = document.getElementById("list-filter-count");
  if (count) { count.hidden = !chips.length; count.textContent = String(chips.length); }
}

export function searchTerms() {
  return state.filters.q?.trim() ? folded(state.filters.q).split(/\s+/).filter(Boolean) : [];
}

/** Values a POI contributes to one filter facet (for counts and matching). */

export function facetValues(poi, facet) {
  const raw = poi.raw || {};
  if (facet === "cats") return raw.needs?.length ? raw.needs : [resolveCategory(poi)?.slug || "other"];
  if (facet === "source") return [sourceCode(poi)];
  if (facet === "offer") return (raw.offers || []).map(o => o.code);
  if (facet === "audience") return (raw.audiences || []).map(a => a.code);
  if (facet === "meal") return (raw.meal_times || []).map(m => m.code);
  if (facet === "level") return raw.course_levels || [];
  if (facet === "issue") return raw.placement?.issue && raw.placement.issue !== "ok" && raw.placement.issue !== "manual" ? [raw.placement.issue] : [];
  if (facet === "access") return raw.access_tags ? raw.access_tags.map(a => a.code) : Object.entries(raw.access_raw || {}).filter(([, v]) => v === true).map(([k]) => k);
  return [];
}

/** Does a POI pass every active filter, optionally ignoring one facet (faceted counts)? */

export function passesFilters(p, skip = null, now = new Date(), terms = searchTerms()) {
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
  if (f.openNow && !["open", "closing"].includes(sourceOpeningStatus(p.raw?.hours_display, now).kind)) return false;
  return true;
}

/** Per-facet counts: each value counted under all the other active filters. */

export function facetCounts(now = new Date()) {
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

export function filteredPois(now = new Date()) {
  const terms = searchTerms();
  let list = state.pois.filter(p => passesFilters(p, null, now, terms)).map(poi=>({...poi,
    category_slug: resolveCategory(poi)?.slug || "other",
    category_color: resolveCategory(poi)?.color || categoryColor("other"),
    category_label: resolveCategory(poi)?.label || "Altro",
    category_icon_path: resolveCategory(poi)?.icon_path || null}));
  if (state.userLoc) list=list.map(p=>({...p,_dist:p.raw?.placement?.section!=="directory" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) ? distanceKm(state.userLoc,{lat:p.latitude,lng:p.longitude}) : null}));
  return list.sort((a,b)=>{
    const distance=state.filters.order==="distance" && state.userLoc ? (a._dist??Infinity)-(b._dist??Infinity) : 0;
    // "Nome" sorts by the title the card shows (layout r3), then by facility.
    return (Number.isNaN(distance)?0:distance) || serviceTitle(a).localeCompare(serviceTitle(b),"it")
      || serviceKind(a).localeCompare(serviceKind(b),"it") || String(a.id).localeCompare(String(b.id));
  });
}

export function renderList(list) {
  document.getElementById("list-count").textContent=String(list.length);
  const wrap=document.getElementById("poi-list");
  if (!list.length) {
    wrap.innerHTML=`<div class="empty-state"><p>${state.filters.section==="directory" ? "Nessun servizio esplicitamente a distanza nei dati selezionati. I servizi senza coordinate restano nell’elenco da localizzare." : "Nessun servizio per questa ricerca."}</p></div>`;
    return;
  }
  wrap.innerHTML=list.map(poi=>{
    const raw=poi.raw || {};
    const siblings=sameSourceGroup(poi).length;
    const distance=state.userLoc ? (poi._dist==null ? "Distanza non disponibile" : formatDistance(poi._dist)) : "";
    const icon=normalizeCategoryIconPath(poi.category_icon_path);
    // Same hierarchy as the service sheet header (layout r3): category, title, place, hours, who.
    const status=sourceOpeningStatus(raw.hours_display);
    const today=todayHours(raw.hours_display);
    const who=[serviceOrganiser(poi), ...sourceNames(poi)].filter(Boolean);
    return `<button type="button" class="poi-item" data-id="${escapeHtml(poi.id)}"><span class="marker-stripe" style="background:${poi.category_color}"></span><span class="info">
      <span class="meta">${categoryBadge(resolveCategory(poi))}${distance?`<span class="dist">${escapeHtml(distance)}</span>`:""}${raw.itinerant_source?'<span class="dist">Itinerante</span>':""}</span>
      <span class="service-list-title"><span class="name">${escapeHtml(serviceTitle(poi))}</span></span>
      <span class="service-kind">${escapeHtml(serviceKind(poi))}${siblings>1?` <span class="service-key">· ${siblings} servizi qui</span>`:""}</span>
      <span class="facility-name">${escapeHtml(poi.address || "")}</span>
      <span class="service-status ${status.kind}" data-opening-service="${escapeHtml(poi.id)}"><strong>${escapeHtml(status.label)}</strong>${today ? `<span class="service-today">${escapeHtml(today)}</span>` : ""}<small hidden></small></span>
      ${transitBadge(poi)}
      <span class="list-who">${escapeHtml(who.join(" · "))} · <span class="list-flag">da verificare</span></span>
    </span></button>`;
  }).join("");
  wrap.querySelectorAll(".poi-item").forEach(el=>el.addEventListener("click",()=>openDetail(el.dataset.id), {signal: runtime.lifecycle?.signal}));
}

export function resolveCategory(poi) {
  return state.categories.find((category) => category.id === poi.category_id)
    || normalizeEmbeddedCategory(poi.category)
    || null;
}

export function searchableService(poi) {
  const raw = poi.raw || {};
  return folded([poi.title, raw.name, raw.facility_name, poi.address, raw.organization_raw,
    raw.description, raw.derived_summary?.text, raw.native_classifications?.bisogno,
    raw.native_classifications?.tipologia,
    ...(raw.native_classifications?.prestazioni || []).map(p => p.nome),
    ...(raw.access_display?.sections || []).flatMap(s => s.entries.map(e => e.label)),
    raw.itinerant_source ? "itinerante" : "", sourceName(poi), raw.hours_display?.raw_text,
    ...(raw.hours_display?.days || []).filter(d=>d.intervals.length).flatMap(d=>[d.label,...d.intervals.map(v=>v.label)]),
    ...(raw.contacts || []).map(c => c.value)].filter(Boolean).join(" "));
}

/** Why a service has no map point (importer `issue`, see app/backend/preview.py). */

export function fillFacetSelect(select, facet, allLabel, labels) {
  const counts = state.facets?.[facet] || new Map();
  const selected = state.filters[facet];
  const values = [...labels.keys()].filter(v => counts.get(v) || v === selected)
    .sort((a, b) => labels.get(a).localeCompare(labels.get(b), "it"));
  if (selected && !labels.has(selected)) state.filters[facet] = "";
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(labels.get(v))} (${counts.get(v) || 0})</option>`).join("");
  select.value = state.filters[facet];
}

export function renderSearchOptions() {
  const access = document.getElementById("access-filter");
  const sources = document.getElementById("source-filter");
  if (!access) return;
  if (!state.facets) state.facets = facetCounts();
  const labels = {access: new Map(), audience: new Map(), source: new Map()};
  for (const p of state.pois) {
    const raw = p.raw || {};
    (raw.audiences || []).forEach(a => labels.audience.set(a.code, a.label));
    if (raw.access_tags) raw.access_tags.forEach(a => labels.access.set(a.code, a.label));
    else (raw.access_display?.sections || []).forEach(s => s.entries.filter(e => e.value === true).forEach(e => labels.access.set(e.code, e.label)));
    labels.source.set(sourceCode(p), sourceName(p));
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

export function renderFacets() {
  state.facets = facetCounts();
  const total = document.getElementById("filter-total");
  if (total) {
    const all = state.pois.length;
    total.textContent = state.facets.shown === all ? `${all} servizi disponibili` : `${state.facets.shown} servizi su ${all} con i filtri attivi`;
  }
  renderCatGrid();
  renderSearchOptions();
}

/** Source of a service row: Helpinet or one of the map exports (see app/backend/preview.py). */
