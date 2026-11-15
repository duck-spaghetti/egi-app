const context = window.EGI_MAP_CONTEXT;
const DEBUG_MODE = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");

const state = {
  categories: [],
  categoryTranslations: [],
  languages: [],
  pois: [],
  transitByPlace: {},
  focusSiteKey: null,
  transitAvailability: "loading",
  cityOptions: [],
  filters: {
    cats: new Set(),
    q: "", source: "", issue: "", type: "", prestation: "", access: "", audience: "", meal: "", path: "", section: "all", order: "name", openNow: false,
  },
  taxonomy: {needs: [], offers: [], audiences: [], access: [], meal_times: [], paths: []},
  view: "map",
  userLoc: null,
  city: context.cityName || "Roma",
  lang: normalizeLang(context.languageCode || "it"),
};

const backdrop = document.getElementById("backdrop");
const stage = document.getElementById("stage");
const listView = document.getElementById("list-view");
const viewToggle = document.getElementById("view-toggle");
const viewToggleLabel = document.getElementById("view-toggle-label");
const cityLabel = document.getElementById("city-label");
const cityValue = document.getElementById("city-value");
const langValue = document.getElementById("lang-value");
const locStatus = document.getElementById("loc-status");
const suggestions = document.getElementById("suggestions");
const toast = document.getElementById("toast");
const settingsBackHead = document.getElementById("settings-back-head");

let map;
let markersLayer;
let transport;
let userMarker;
let cityBounds;
let sheetReturnFocus = null;
let originRequest = null;
let addressRequest = null;

init().catch((error) => {
  console.error("Preview load failed", error);
  document.getElementById("poi-list").innerHTML = `<div class="empty-state"><p>Impossibile caricare la preview: ${escapeHtml(error.message)}</p></div>`;
  state.view = "list";
  listView.classList.add("shown");
  stage.classList.add("list-mode");
  updateViewToggle();
});

async function init() {
  await window.EGI_I18N.setLanguage(state.lang);
  applyShellTranslations();
  initMap();
  bindUi();
  syncFilterLayout();
  applyInitialUserLocation();
  await loadData();
  renderFilters();
  renderSettings();
  refresh();
  setInterval(updateOpeningBadges, 30000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden) updateOpeningBadges();});
}

function initMap() {
  cityBounds = L.latLngBounds(
    [Number(context.boundsSouth), Number(context.boundsWest)],
    [Number(context.boundsNorth), Number(context.boundsEast)]
  );
  const cityCenter = [Number(context.latitude), Number(context.longitude)];

  map = L.map("map", {
    zoomControl: false,
    attributionControl: true,
    maxBounds: cityBounds,
    maxBoundsViscosity: 1,
    worldCopyJump: false,
  }).setView(cityCenter, Number(context.zoom));
  map.attributionControl.setPrefix(false);

  L.tileLayer(context.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    noWrap: true,
  }).addTo(map);

  if (typeof L.markerClusterGroup === "function") {
    markersLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 17,
      maxClusterRadius: 42,
    });
  } else {
    markersLayer = L.layerGroup();
  }
  markersLayer.addTo(map);
  map.setView(cityCenter, Number(context.zoom));
  const minCityZoom = map.getBoundsZoom(cityBounds, true, [18, 18]);
  map.setMinZoom(Math.max(9, minCityZoom));
  map.on("resize", () => map.setMinZoom(Math.max(9, map.getBoundsZoom(cityBounds, true, [18,18]))));
  map.setMaxBounds(cityBounds);
  map.panInsideBounds(cityBounds, { animate: false });
  CycleLayer.create(map, {
    toggle: document.getElementById("cycle-toggle"),
    status: document.getElementById("cycle-status"),
  });
  transport = TransportLayer.create(map, {
    toggle: document.getElementById("transport-toggle"),
    status: document.getElementById("transport-status"),
    modes: {
      metro: document.getElementById("transport-metro"),
      rail: document.getElementById("transport-rail"),
      tram: document.getElementById("transport-tram"),
      bus: document.getElementById("transport-bus"),
    },
  });
  // Local position checks: ?debug=1 adds the one-source view (debug-sources.js).
  if (DEBUG_MODE && typeof DebugSources !== "undefined") {
    DebugSources.create(map, {
      setServicesVisible: visible => visible ? map.addLayer(markersLayer) : map.removeLayer(markersLayer),
      openDetail: id => openDetail(id),
    });
  }
  map.on("click", event=>{
    if (!state.choosingReference) return;
    state.choosingReference=false;
    setUserLocation(event.latlng.lat,event.latlng.lng,"Punto scelto sulla mappa");
  });
}

async function loadData() {
  const [
    categoriesResponse,
    services,
    languagesResponse,
    citiesResponse,
    translationsResponse,
  ] = await Promise.all([
    fetch("/api/preview/categories?sort_by=sort_order&sort_order=asc&limit=1000"),
    fetchPublicServices(),
    fetch("/api/preview/languages"),
    fetch("/api/preview/areas"),
    fetch("/api/preview/category-translations?limit=1000"),
  ]);
  try { state.taxonomy = await readJson(await fetch("/api/preview/taxonomy"), "tassonomia"); } catch (_e) { /* paths and labels optional */ }

  const categories = await readJson(categoriesResponse, "categorie");
  state.languages = await readJson(languagesResponse, "lingue");
  state.cityOptions = (await readJson(citiesResponse, "città")).map(normalizeArea);
  state.categoryTranslations = await readJson(translationsResponse, "traduzioni categorie");
  state.categories = applyCategoryLabels(
    mergeServiceCategories(
      categories
        .filter((category) => category.area_id == null || Number(category.area_id) === Number(context.cityId))
        .map(normalizeCategory),
      services
    )
  );
  state.pois = services.map(normalizePublicService).filter(Boolean);
  void loadTransitSummaries();
  setInterval(loadTransitSummaries, 300000);
  state.filters.cats = new Set(state.categories.map((category) => category.slug));
}

function bindUi() {
  document.getElementById("open-now-filter").addEventListener("change",event=>{state.filters.openNow=event.target.checked; refresh();});
  document.getElementById("service-query").addEventListener("input",event=>{state.filters.q=event.target.value; refresh();});
  for (const [id,key] of [["source-filter","source"],["issue-filter","issue"],["service-type-filter","type"],["prestation-filter","prestation"],["access-filter","access"],["audience-filter","audience"],["meal-filter","meal"],["section-filter","section"],["sort-services","order"]]) {
    document.getElementById(id).addEventListener("change",event=>{
      state.filters[key]=event.target.value;
      if (key==="type" || key==="source") renderSearchOptions();
      if (key==="order" && event.target.value==="distance" && !state.userLoc) openSheet("sheet-location");
      refresh();
    });
  }
  document.getElementById("pick-reference").addEventListener("click",chooseReferencePoint);
  document.getElementById("pick-reference-location").addEventListener("click",chooseReferencePoint);
  document.getElementById("address-search-form").addEventListener("submit", event => {
    event.preventDefault();
    void geocodeAddress(document.getElementById("addr-input").value.trim());
  });
  document.getElementById("open-emergency").addEventListener("click", () => openSheet("sheet-sos"));
  document.getElementById("sos-directory")?.addEventListener("click", () => document.getElementById("open-directory").click());
  document.getElementById("open-directory").addEventListener("click", () => {
    state.filters.section="directory";
    state.filters.q=""; state.filters.source=""; state.filters.issue=""; state.filters.type=""; state.filters.prestation=""; state.filters.access=""; state.filters.audience=""; state.filters.meal=""; state.filters.path="";
    state.filters.openNow=false; state.filters.cats=new Set(state.categories.map(c=>c.slug));
    document.getElementById("section-filter").value="directory";
    document.getElementById("service-query").value="";
    document.getElementById("open-now-filter").checked=false;
    renderFilters(); closeSheets();
    if (state.view!=="list") toggleView();
    refresh();
  });
  document.getElementById("origin-transit").addEventListener("toggle", event => {
    if (event.target.open) void loadOriginTransit();
  });
  document.addEventListener("keydown", event => {
    if (event.key==="Escape") closeSheets();
    if (event.key!=="Tab") return;
    const sheet=document.querySelector(".sheet.shown");
    if (!sheet) return;
    const controls=[...sheet.querySelectorAll('button,input,select,a[href],summary,[tabindex="0"]')].filter(el=>el.getClientRects().length && !el.disabled);
    const first=controls[0], last=controls.at(-1);
    if (event.shiftKey && (document.activeElement===first || !sheet.contains(document.activeElement))) {event.preventDefault();last?.focus();}
    else if (!event.shiftKey && (document.activeElement===last || !sheet.contains(document.activeElement))) {event.preventDefault();first?.focus();}
  });
  document.getElementById("clear-reference").addEventListener("click",()=>{
    state.userLoc=null; state.choosingReference=false; state.filters.order="name";
    document.getElementById("sort-services").value="name";
    document.getElementById("reference-status").textContent="Scegli una posizione per ordinare per distanza";
    if (userMarker) {userMarker.remove();userMarker=null;}
    locStatus.className="loc-status";locStatus.textContent="Nessun riferimento scelto";
    document.getElementById("origin-transit-body").textContent="Scegli una posizione per vedere fermate e partenze vicine.";
    originRequest?.abort();
    refresh();
  });
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => openSheet(`sheet-${button.dataset.sheet}`));
  });
  document.querySelectorAll("[data-sheet-open]").forEach((button) => {
    button.addEventListener("click", () => openSheet(`sheet-${button.dataset.sheetOpen}`));
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", closeSheets);
  });
  backdrop.addEventListener("click", closeSheets);

  viewToggle.addEventListener("click", toggleView);
  updateViewToggle();
  document.getElementById("reset-filters").addEventListener("click", () => {
    state.filters.path = ""; renderPaths();
    state.filters.cats = new Set();
    renderCatGrid();
    renderSearchOptions();
    refresh();
  });
  document.getElementById("select-all-filters").addEventListener("click", () => {
    state.filters.path = ""; renderPaths();
    state.filters.cats = new Set(state.categories.map((category) => category.slug));
    renderCatGrid();
    renderSearchOptions();
    refresh();
  });
  document.getElementById("geo-btn").addEventListener("click", locateUser);
  document.querySelectorAll("[data-sub]").forEach((row) => {
    row.addEventListener("click", () => showSettingsPage(row.dataset.sub));
  });
  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showSettingsPage("main"));
  });
  settingsBackHead?.addEventListener("click", () => showSettingsPage("main"));
}

function openSheet(id) {
  sheetReturnFocus = document.activeElement;
  document.querySelectorAll(".sheet").forEach((sheet) => sheet.classList.remove("shown"));
  const sheet = document.getElementById(id);
  if (sheet) {
    sheet.classList.add("shown");
    sheet.querySelector("button,input,select")?.focus();
  }
  backdrop.classList.add("shown");
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.remove("active"));
  if (id === "sheet-filters") document.querySelector('[data-sheet="filters"]').classList.add("active");
  if (id === "sheet-sos") document.querySelector('[data-sheet="settings"]').classList.add("active");
  if (id === "sheet-location") document.querySelector('[data-sheet="location"]').classList.add("active");
  if (id === "sheet-settings") document.querySelector('[data-sheet="settings"]').classList.add("active");
}

async function readJson(response, label) {
  if (response.ok) {
    return response.json();
  }

  let detail = response.statusText;
  try {
    const payload = await response.json();
    detail = payload.detail || detail;
  } catch (_error) {
    // Keep the HTTP status text when the response body is not JSON.
  }

  console.error(`Errore caricando ${label}:`, response.status, detail);
  showToast(`${t("common.loading")} ${label}`);
  throw new Error(`Errore caricando ${label}: ${response.status}`);
}

async function fetchPublicServices() {
  const params = new URLSearchParams({
    area_id: String(context.cityId),
    language: normalizeLang(state.lang),
    // The backend maximum: 2,000 silently dropped services once the guide chapters were loaded
    // (2,038 placed on 2026-11-09). Pagination is open work if the catalogue nears 5,000.
    limit: "5000",
  });
  // Services without a map point are hidden; the review view (?debug=1) still lists them.
  if (DEBUG_MODE) params.set("include_unplaced", "true");
  const response = await fetch(`/api/preview/services?${params.toString()}`);
  return readJson(response, "servizi");
}

function closeSheets() {
  document.querySelectorAll(".sheet").forEach((sheet) => sheet.classList.remove("shown"));
  backdrop.classList.remove("shown");
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.remove("active"));
  showSettingsPage("main");
  sheetReturnFocus?.focus?.();
}

function toggleView() {
  state.view = state.view === "map" ? "list" : "map";
  listView.classList.toggle("shown", state.view === "list");
  stage.classList.toggle("list-mode", state.view === "list");
  updateViewToggle();
  syncFilterLayout();
  closeSheets();
  if (state.view === "map") requestAnimationFrame(() => map.invalidateSize());
}

function syncFilterLayout() {
  // One filter tree for map and list; the list toolbar opens the same sheet.
  document.getElementById("filter-sheet-host").appendChild(document.getElementById("filter-controls"));
}

function updateViewToggle() {
  const showMapAction = state.view === "list";
  viewToggle.classList.toggle("is-map", state.view === "map");
  viewToggle.classList.toggle("is-list", state.view === "list");
  viewToggle.setAttribute("aria-pressed", String(state.view === "list"));
  viewToggleLabel.textContent = showMapAction ? t("map.map_view") : t("map.list");
}

function renderFilters() {
  renderPaths();
  renderCatGrid();
  renderSearchOptions();
  renderLanguageList();
  renderCityList();
}



/* "Vicino a": lines near a service's place (see app/backend/transit_nearby.py). */
const TRANSIT_NOTE = "Tempi a piedi stimati in linea d’aria (+30%, 4 km/h). Bus, metro e tram: Roma Servizi per la Mobilità; treni: Trenitalia (NeTEx, NAP nazionale); ferrovie senza orari: © OpenStreetMap contributors (ODbL 1.0), servizio odierno non verificato. Le corse soppresse non sono indicate. Accessibilità indicata solo dove la fonte la dichiara.";

async function loadTransitSummaries() {
  try {
    const response = await fetch("/api/preview/transit/places");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.transitAvailability = data.availability;
    state.transitByPlace = data.places || {};
  } catch (_error) {
    state.transitAvailability = "unavailable";
    state.transitByPlace = {};
  }
  renderList(filteredPois());
}

function transitEligible(poi) {
  const raw = poi.raw || {};
  return poi.latitude !== null && poi.longitude !== null && !raw.itinerant_source && raw.placement?.section !== "directory";
}

function lineChip(row) {
  const color = TransportLayer.lineColor(row.mode, row.color);
  const label = `${modeName(row.mode)} ${row.code}`;
  const short = {metro: "M", rail: "Treno", tram: "T"}[row.mode] || "Bus";
  return `<span class="line-chip ${escapeHtml(row.mode)}" style="--line-color:${escapeHtml(color)}" title="${escapeHtml(label)}"><span class="line-mode" aria-hidden="true">${short}</span><span class="line-code">${escapeHtml(row.code)}</span><span class="visually-hidden">${escapeHtml(label)}</span></span>`;
}

function transitBadge(poi) {
  if (!transitEligible(poi)) return "";
  const summary = state.transitByPlace[poi.place_id];
  if (!summary || (!summary.metro && !summary.rail && !summary.surface)) return "";
  const parts = [summary.metro, summary.rail, summary.surface].filter(Boolean).map(row =>
    `<span class="transit-pair">${lineChip(row)}<span class="transit-walk">${row.mode === "metro" || row.mode === "rail" ? `${escapeHtml(row.stop_name)} ` : ""}${row.walk_min}′</span></span>`
  );
  const extra = summary.lines - parts.length;
  return `<span class="transit-badge" aria-label="Trasporti vicini, minuti a piedi stimati">${parts.join("")}${extra > 0 ? `<span class="transit-more">+${extra} linee</span>` : ""}</span>`;
}

function transitSectionShell(poi) {
  if (!transitEligible(poi)) return "";
  return `<div class="transit-near" data-transit-place="${escapeHtml(poi.place_id)}"><p class="source-note">Cerco fermate e linee vicine…</p></div>`;
}

function modeName(mode) {
  return {metro: "Metro", rail: "Treno", tram: "Tram"}[mode] || "Autobus";
}

function transitNext(row) {
  if (row.untimed) return `<span class="transit-next">${TransportLayer.UNTIMED_NOTE}</span>`;
  return (row.next || []).map(direction => {
    const shown = TransportLayer.directionTimes(direction);
    const live = shown.live ? '<span class="tl-live-dot" aria-label="tempo reale"></span>' : "";
    const scheduled = shown.scheduled ? `<span class="transit-scheduled">orario: ${escapeHtml(shown.scheduled)}</span>` : "";
    return `<span class="transit-next${shown.live ? " live" : ""}">${live}${direction.headsign ? `→ ${escapeHtml(direction.headsign)}: ` : ""}${escapeHtml(shown.text)}</span>${scheduled}`;
  }).join("");
}

/** One line of a stop: the chip is a button that shows that line on the map. */
function transitLine(row) {
  const night = row.night ? `<span class="night-tag">notturna</span>` : "";
  return `<li class="transit-line"><button type="button" class="line-chip-button" data-focus-route="${escapeHtml(row.route_id)}" aria-label="Mostra ${escapeHtml(modeName(row.mode))} ${escapeHtml(row.code)} sulla mappa">${lineChip(row)}</button>${night}<span class="transit-next-wrap">${row.origin ? transitNext(row) || '<span class="transit-next">Orari non disponibili</span>' : row.untimed ? '<span class="source-note">Senza orari · OpenStreetMap</span>' : ""}</span></li>`;
}

/** Alerts naming one of the group's lines or stops. */
function stopAlerts(group, alerts) {
  const routes = new Set(group.lines.map(line => line.route_id));
  const stops = new Set(group.stop_ids || []);
  return (alerts || []).filter(alert => (alert.routes || []).some(r => routes.has(r)) || (alert.stops || []).some(s => stops.has(s)));
}

/** A stop (same-named stops within 150 m) with its lines and a "show all its lines" button. */
function transitStopGroup(group, index, alerts = []) {
  const metro = group.modes.includes("metro");
  const rail = group.modes.includes("rail");
  const place = metro ? "Stazione" : rail ? "Stazione ferroviaria" : group.modes.length === 1 && group.modes[0] === "tram" ? "Fermata tram" : "Fermata";
  const icon = metro ? '<span class="tl-roundel">M</span>' : rail ? `<span class="tl-roundel tl-train">${TransportLayer.TRAIN_GLYPH}</span>` : group.modes[0] === "tram" ? '<span class="tl-stop tl-tram">T</span>' : '<span class="tl-stop tl-bus">Bus</span>';
  const wheelchair = group.wheelchair === "yes" ? ` · <span class="wheelchair-tag">accessibile in sedia a rotelle</span>` : group.wheelchair === "no" ? " · non accessibile in sedia a rotelle" : "";
  const count = group.lines.length;
  return `<li class="transit-stop-group"><div class="transit-stop-head"><span class="transit-stop-icon">${icon}</span><span class="transit-text"><span class="transit-stop">${place} ${escapeHtml(group.stop_name)}</span><span class="transit-meta">circa ${group.walk_min} min a piedi · ${group.distance_m} m in linea d’aria · ${count} ${count === 1 ? "linea" : "linee"}${wheelchair}</span></span><button type="button" class="transit-row-focus" data-focus-stop="${index}" aria-label="Mostra sulla mappa le linee di ${escapeHtml(group.stop_name)}">Mostra linee</button></div><details class="stop-lines"><summary>Linee e dettagli</summary>${TransportLayer.alertsHtml(stopAlerts(group, alerts), new Set(group.lines.map(line => line.route_id)))}<ul class="transit-lines">${group.lines.map(transitLine).join("")}</ul></details></li>`;
}

/** The stop to name first: the nearest, or the nearest served by a line that also stops near the user. */
function nearestStopChoice(stops, origin) {
  if (!stops.length) return null;
  const routes = new Map();
  (origin?.stops || []).forEach(g => g.lines.forEach(line => { if (!routes.has(line.route_id)) routes.set(line.route_id, {line, from: g}); }));
  for (const g of stops) {
    const shared = g.lines.find(line => routes.has(line.route_id));
    if (shared) return {group: g, link: {line: shared, from: routes.get(shared.route_id).from}};
  }
  return {group: stops[0], link: null};
}

function nearestStopHtml(choice, index, alerts = []) {
  const g = choice.group;
  const link = choice.link;
  const mode = g.modes.includes("metro") ? "Stazione metro" : g.modes.includes("rail") ? "Stazione" : g.modes.length === 1 && g.modes[0] === "tram" ? "Fermata tram" : "Fermata";
  return `<div class="nearest-stop"><p class="service-key">${link ? "Fermata collegata a te" : "Fermata più vicina"}</p>
    <p class="nearest-stop-name"><strong>${escapeHtml(mode)} ${escapeHtml(g.stop_name)}</strong> · ${g.walk_min} min a piedi${g.wheelchair === "yes" ? ' · <span class="wheelchair-tag">accessibile in sedia a rotelle</span>' : ""}</p>
    <div class="nearest-stop-lines">${g.lines.map(line => `<button type="button" class="line-chip-button" data-focus-route="${escapeHtml(line.route_id)}" aria-label="Mostra ${escapeHtml(modeName(line.mode))} ${escapeHtml(line.code)} sulla mappa">${lineChip(line)}</button>`).join("")}<button type="button" class="transit-row-focus" data-focus-stop="${index}">Mostra linee</button></div>
    ${TransportLayer.alertsHtml(stopAlerts(g, alerts), new Set(g.lines.map(line => line.route_id)))}
    ${link ? `<p class="nearest-stop-link">${escapeHtml(modeName(link.line.mode))} ${escapeHtml(link.line.code)} passa anche da ${escapeHtml(link.from.stop_name)}, vicino alla tua posizione.</p>` : ""}</div>`;
}

function renderTransitRows(data, origin = null) {
  const head = "";
  if (data.availability !== "available") {
    const reason = data.availability === "outside_calendar" ? "Orario dei trasporti non disponibile per oggi." : "Dati sui trasporti non disponibili al momento.";
    return `${head}<p class="source-note">${reason}</p>`;
  }
  const lines = data.lines || [];
  const stops = data.stops || [];
  if (!lines.length) return `${head}<p>Nessuna linea con fermate nei dati disponibili entro 500 m (metro e treni entro 800 m).</p><p class="source-note">${TRANSIT_NOTE}</p>`;
  const alerts = data.alerts || [];
  const choice = nearestStopChoice(stops, origin);
  if (!choice) return `<p>Nessuna fermata nei dati disponibili.</p>`;
  const chosen = stops.indexOf(choice.group);
  const rest = stops.map((g, i) => [g, i]).filter(([, i]) => i !== chosen);
  const all = `<button type="button" class="transit-focus-all" data-focus-route="*">Mostra tutte le ${lines.length} linee sulla mappa</button>`;
  const more = rest.length ? `<details class="transit-more-lines"><summary>Altre ${rest.length} fermate</summary>${all}<ul class="transit-list">${rest.map(([g, i]) => transitStopGroup(g, i, alerts)).join("")}</ul><p class="source-note">${TRANSIT_NOTE}</p></details>` : `<p class="source-note">${TRANSIT_NOTE}</p>`;
  return `${nearestStopHtml(choice, chosen, alerts)}${more}`;
}

async function loadTransitDetail(poi) {
  const node = document.querySelector("[data-transit-place]");
  if (!node) return;
  let data;
  try {
    const response = await fetch(`/api/preview/transit/places/${encodeURIComponent(poi.place_id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (_error) {
    data = { availability: "unavailable", lines: [] };
  }
  // With a reference position, prefer a stop whose line also serves the user (layout r3).
  let origin = null;
  if (state.userLoc && data.availability === "available") {
    try {
      const response = await fetch(`/api/preview/transit/origin?${new URLSearchParams({lat: state.userLoc.lat, lon: state.userLoc.lng})}`);
      if (response.ok) origin = await response.json();
    } catch (_error) { origin = null; }
  }
  // The sheet may already show another service.
  if (!node.isConnected || node.dataset.transitPlace !== String(poi.place_id)) return;
  node.innerHTML = renderTransitRows(data, origin);
  node.querySelectorAll("[data-focus-route]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.focusRoute;
    focusTransit(poi, id === "*" ? data.lines : data.lines.filter(row => row.route_id === id));
  }));
  node.querySelectorAll("[data-focus-stop]").forEach(button => button.addEventListener("click", () => {
    const group = (data.stops || [])[Number(button.dataset.focusStop)];
    if (group) focusTransit(poi, group.lines, group.stop_name);
  }));
}

/** Leave the sheet, show the map and only these lines, highlighting their nearby stops. */
function focusTransit(poi, rows, stopName = null) {
  if (!rows.length || !transport) return;
  closeSheets();
  if (state.view === "list") toggleView();
  state.focusSiteKey = sourceSiteKey(poi);
  refresh();
  const label = rows.length === 1
    ? `${modeName(rows[0].mode)} ${rows[0].code} vicino a ${poi.title}`
    : stopName ? `Linee di ${stopName}` : `${rows.length} linee vicino a ${poi.title}`;
  transport.focus({
    routeIds: rows.map(row => row.route_id),
    label,
    stopIds: rows.map(row => row.stop_id),
    points: [[poi.latitude, poi.longitude], ...rows.filter(row => row.stop_point).map(row => [row.stop_point[1], row.stop_point[0]])],
    onClear: () => {
      state.focusSiteKey = null;
      refresh();
    },
  });
}


function renderCatGrid() {
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
      if (state.filters.cats.has(slug)) state.filters.cats.delete(slug);
      else state.filters.cats.add(slug);
      renderCatGrid();
      renderSearchOptions();
      refresh();
    });
    wrap.append(tile);
  });
}

function renderLanguageList() {
  const wrap = document.getElementById("lang-list");
  wrap.innerHTML = "";

  state.languages.forEach((language) => {
    const code = normalizeLang(language.code);
    const button = document.createElement("button");
    button.className = `pill${state.lang === code ? " active" : ""}`;
    button.textContent = code.toUpperCase();
    button.addEventListener("click", () => {
      state.lang = code;
      refreshCategoriesForLanguage();
    });
    wrap.append(button);
  });
}

async function refreshCategoriesForLanguage() {
  await window.EGI_I18N.setLanguage(state.lang);
  applyShellTranslations();

  const previousSelection = new Set(state.filters.cats);
  const services = await fetchPublicServices();
  state.pois = services.map(normalizePublicService).filter(Boolean);
  state.categories = mergeServiceCategories(state.categories, services);
  state.categories = applyCategoryLabels(state.categories);
  state.filters.cats = new Set(
    state.categories
      .map((category) => category.slug)
      .filter((slug) => previousSelection.has(slug))
  );
  renderLanguageList();
  renderCatGrid();
  refresh();
  renderSettings();
  closeSheets();
  showToast(`${t("map.language")}: ${state.lang.toUpperCase()}`);
}

function renderCityList() {
  const wrap = document.getElementById("city-list");
  wrap.innerHTML = "";

  state.cityOptions.forEach((city) => {
    const row = document.createElement("a");
    row.className = "row";
    row.href = `/map?city_id=${city.id}&lang=${encodeURIComponent(normalizeLang(state.lang))}`;
    row.innerHTML = `
      <div class="left">
        <div class="text">
          <div class="name">${escapeHtml(city.name)}</div>
          <div class="desc">${escapeHtml(city.countryCode)}</div>
        </div>
      </div>
      <div class="value">${city.name === state.city ? "●" : "○"}</div>
    `;
    wrap.append(row);
  });
}

function renderSettings() {
  cityLabel.textContent = state.city;
  cityValue.textContent = state.city;
  langValue.textContent = state.lang.toUpperCase();
}

function applyShellTranslations() {
  window.EGI_I18N.translatePage();
  document.title = `EGI — ${state.city}`;
  viewToggle.setAttribute("aria-label", t("map.change_view"));
  viewToggleLabel.textContent = state.view === "list" ? t("map.map_view") : t("map.list");

  if (!state.userLoc) {
    locStatus.className = "loc-status";
    locStatus.innerHTML = `<span class="label">${escapeHtml(t("map.position"))}</span>${escapeHtml(t("map.no_position_set"))}`;
  }
}

function refresh() {
  renderFacets();
  renderActiveFilters();
  const list = filteredPois();
  // In the transport focus view only the focused service's site stays on the map.
  renderMarkers(state.focusSiteKey ? state.pois.filter(poi => sourceSiteKey(poi) === state.focusSiteKey) : list);
  renderList(list);
}

/** Text of a select's chosen option without its "(count)" suffix. */
function selectedLabel(id, fallback) {
  return (document.getElementById(id)?.selectedOptions?.[0]?.textContent || fallback).replace(/ \(\d+\)$/, "");
}

/** Active filters as compact chips under the list toolbar, plus a count on its Filtri button. */
function renderActiveFilters() {
  const summary = document.getElementById("active-filter-summary");
  if (!summary) return;
  const f = state.filters;
  const allCats = f.cats.size === state.categories.length;
  const chips = [
    allCats ? "" : `${f.cats.size} bisogni`,
    f.q?.trim() ? `“${f.q.trim()}”` : "",
    f.openNow ? "Aperti ora" : "",
    f.source ? selectedLabel("source-filter", f.source) : "",
    f.issue ? selectedLabel("issue-filter", f.issue) : "",
    f.type,
    f.path ? `Percorso: ${(state.taxonomy.paths.find(x => x.code === f.path) || {}).label || f.path}` : "",
    f.prestation ? selectedLabel("prestation-filter", "Prestazione") : "",
    f.audience ? selectedLabel("audience-filter", f.audience) : "",
    f.meal ? selectedLabel("meal-filter", f.meal) : "",
    f.access ? selectedLabel("access-filter", f.access) : "",
    f.section !== "all" ? document.getElementById("section-filter").selectedOptions?.[0]?.textContent : "",
  ].filter(Boolean);
  summary.innerHTML = chips.length
    ? chips.map(c => `<span class="filter-chip">${escapeHtml(c)}</span>`).join("")
    : `<span class="filter-none">Nessun filtro attivo · tutti i bisogni</span>`;
  const count = document.getElementById("list-filter-count");
  if (count) { count.hidden = !chips.length; count.textContent = String(chips.length); }
}

function searchTerms() {
  return state.filters.q?.trim() ? folded(state.filters.q).split(/\s+/).filter(Boolean) : [];
}

/** Values a POI contributes to one filter facet (for counts and matching). */
function facetValues(poi, facet) {
  const raw = poi.raw || {};
  if (facet === "cats") return raw.needs?.length ? raw.needs : [resolveCategory(poi)?.slug || "other"];
  if (facet === "source") return [sourceCode(poi)];
  if (facet === "type") return raw.native_classifications?.tipologia ? [raw.native_classifications.tipologia] : [];
  if (facet === "prestation") return raw.offers ? raw.offers.map(o => o.code) : (raw.native_classifications?.prestazioni || []).map(v => String(v.id));
  if (facet === "audience") return (raw.audiences || []).map(a => a.code);
  if (facet === "meal") return (raw.meal_times || []).map(m => m.code);
  if (facet === "issue") return raw.placement?.issue && raw.placement.issue !== "ok" && raw.placement.issue !== "manual" ? [raw.placement.issue] : [];
  if (facet === "access") return raw.access_tags ? raw.access_tags.map(a => a.code) : Object.entries(raw.access_raw || {}).filter(([, v]) => v === true).map(([k]) => k);
  return [];
}

/** Does a POI pass every active filter, optionally ignoring one facet (faceted counts)? */
function passesFilters(p, skip = null, now = new Date(), terms = searchTerms()) {
  const f = state.filters;
  if (skip !== "cats" && !facetValues(p, "cats").some(slug => f.cats.has(slug))) return false;
  for (const facet of ["source", "issue", "type", "prestation", "access", "audience", "meal"]) {
    if (skip !== facet && f[facet] && !facetValues(p, facet).includes(f[facet])) return false;
  }
  if (f.path) {
    const path = state.taxonomy.paths.find(x => x.code === f.path);
    if (path && !(p.raw?.offers || []).some(o => path.offers.includes(o.code))) return false;
  }
  if (terms.length && !terms.every(term => searchableService(p).includes(term))) return false;
  const section = p.raw?.placement?.section;
  if (f.section === "directory" && section !== "directory") return false;
  if (f.section === "services" && section === "directory") return false;
  if (f.section === "needs_position" && (section === "directory" || (p.latitude !== null && p.longitude !== null))) return false;
  if (f.openNow && !["open", "closing"].includes(sourceOpeningStatus(p.raw?.hours_display, now).kind)) return false;
  return true;
}

/** Per-facet counts: each value counted under all the other active filters. */
function facetCounts(now = new Date()) {
  const terms = searchTerms();
  const counts = {cats: new Map(), source: new Map(), issue: new Map(), type: new Map(), prestation: new Map(), access: new Map(), audience: new Map(), meal: new Map(), shown: 0};
  for (const p of state.pois) {
    if (passesFilters(p, null, now, terms)) counts.shown++;
    for (const facet of ["cats", "source", "issue", "type", "prestation", "access", "audience", "meal"]) {
      if (!passesFilters(p, facet, now, terms)) continue;
      for (const v of facetValues(p, facet)) counts[facet].set(v, (counts[facet].get(v) || 0) + 1);
    }
  }
  return counts;
}

function filteredPois(now = new Date()) {
  const terms = searchTerms();
  let list = state.pois.filter(p => passesFilters(p, null, now, terms)).map(poi=>({...poi,
    category_slug: resolveCategory(poi)?.slug || "other",
    category_color: resolveCategory(poi)?.color || categoryColor("other"),
    category_label: resolveCategory(poi)?.label || "Altro",
    category_icon_path: resolveCategory(poi)?.icon_path || null}));
  if (state.userLoc) list=list.map(p=>({...p,_dist:p.raw?.placement?.section!=="directory" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) ? distanceKm(state.userLoc,{lat:p.latitude,lng:p.longitude}) : null}));
  return list.sort((a,b)=>{
    const distance=state.filters.order==="distance" && state.userLoc ? (a._dist??Infinity)-(b._dist??Infinity) : 0;
    return (Number.isNaN(distance)?0:distance) || a.title.localeCompare(b.title,"it") || String(a.id).localeCompare(String(b.id));
  });
}

function sourceSiteKey(poi) {
  if (!Number.isFinite(poi.latitude) || !Number.isFinite(poi.longitude) || poi.raw?.placement?.section === "directory") return null;
  return [poi.raw?.source_group?.external_key || poi.id,poi.latitude,poi.longitude,poi.raw?.itinerant_source ? "itinerant" : "fixed"].join(":");
}

function siteGroups(list) {
  // A matching service reveals its source site, including siblings in other categories.
  const keys = new Set(list.map(sourceSiteKey).filter(Boolean));
  const groups = new Map();
  state.pois.forEach(poi => {
    const key = sourceSiteKey(poi);
    if (!keys.has(key)) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(poi);
  });
  return [...groups.values()];
}

function renderMarkers(list) {
  markersLayer.clearLayers();
  if (!map.hasLayer(markersLayer)) markersLayer.addTo(map);
  const matched = new Set(list.map(p => p.id));
  siteGroups(list).forEach(items => {
    const categories = [...new Map(items.map(p => {const c=resolveCategory(p); return [c?.slug,c];})).values()].filter(Boolean);
    const poi = {...items[0], group_count:items.length, site_categories:categories, site_weights:categories.map(c=>items.filter(item=>resolveCategory(item)?.slug===c.slug).length)};
    const label = `${poi.raw?.facility_name || poi.title}: ${items.length} servizi · ${categories.map(c=>categoryCaption(c.label || c.slug)).join(", ")}`;
    const marker=L.marker([poi.latitude,poi.longitude],{icon:makePin(poi),alt:label,title:label});
    marker.on("click",()=>openServiceChooser(items,matched));
    markersLayer.addLayer(marker);
  });
  if (userMarker) {userMarker.remove();userMarker=null;}
  if (state.userLoc) userMarker=L.marker([state.userLoc.lat,state.userLoc.lng],{icon:userIcon(),alt:"Punto di riferimento scelto"}).addTo(map);
}


function renderList(list) {
  document.getElementById("list-count").textContent=String(list.length);
  const wrap=document.getElementById("poi-list");
  if (!list.length) {
    wrap.innerHTML=`<div class="empty-state"><p>${state.filters.section==="directory" ? "Nessun servizio esplicitamente a distanza nei dati selezionati. I servizi senza coordinate restano nell’elenco da localizzare." : "Nessun servizio per questa ricerca."}</p></div>`;
    return;
  }
  wrap.innerHTML=list.map(poi=>{
    const raw=poi.raw || {};
    const siblings=sameSourceGroup(poi).length;
    const distance=state.userLoc ? (poi._dist==null ? "Distanza non disponibile" : poi._dist<1?`${Math.round(poi._dist*1000)} m`:`${poi._dist.toFixed(1)} km`) : "";
    const icon=normalizeCategoryIconPath(poi.category_icon_path);
    // Same hierarchy as the service sheet header (layout r3): category, title, place, hours, who.
    const facility=raw.facility_name || raw.name || "";
    const status=sourceOpeningStatus(raw.hours_display);
    const today=todayHours(raw.hours_display);
    const who=[raw.organization_raw, ...sourceNames(poi)].filter(Boolean);
    return `<button type="button" class="poi-item" data-id="${escapeHtml(poi.id)}"><span class="marker-stripe" style="background:${poi.category_color}"></span><span class="info">
      <span class="meta">${categoryBadge(resolveCategory(poi))}${distance?`<span class="dist">${escapeHtml(distance)}</span>`:""}${raw.itinerant_source?'<span class="dist">Itinerante</span>':""}</span>
      <span class="service-list-title"><span class="name">${escapeHtml(serviceTitle(poi))}</span></span>
      <span class="facility-name">${facility ? `<strong>${escapeHtml(facility)}</strong>` : ""}${facility && poi.address ? " · " : ""}${escapeHtml(poi.address || "")}${siblings>1?` · ${siblings} servizi qui`:""}</span>
      <span class="service-status ${status.kind}" data-opening-service="${escapeHtml(poi.id)}"><strong>${escapeHtml(status.label)}</strong>${today ? `<span class="service-today">${escapeHtml(today)}</span>` : ""}<small hidden></small></span>
      ${transitBadge(poi)}
      <span class="list-who">${escapeHtml(who.join(" · "))} · <span class="list-flag">da verificare</span></span>
    </span></button>`;
  }).join("");
  wrap.querySelectorAll(".poi-item").forEach(el=>el.addEventListener("click",()=>openDetail(el.dataset.id)));
}

function listOpeningStatus(poi) {
  if (poi.raw?.data_status === "unreviewed_source_preview") {
    return { isOpen: null, label: "Da verificare", detail: `Orari originali ${sourceName(poi)}, non revisionati` };
  }
  const status = currentOpeningStatus(buildWeeklySchedule(poi.hours || []), new Date());
  return {
    ...status,
    label: status.isOpen ? t("map.open", {}, "Aperto") : t("map.closed", {}, "Chiuso"),
  };
}

/**
 * Service sheet (layout r3, 2026-11-15): a fixed header with what matters first, anchors
 * to four sections on one scrolling page, a fixed call/directions bar, and the single
 * reliability panel at the end ("Fonti e aggiornamenti"). See .scratch/card-layout/plan.md.
 */
async function openDetail(id) {
  const poi=state.pois.find(p=>String(p.id)===String(id));
  if (!poi) return showToast("Servizio non disponibile");
  const sheet=document.getElementById("sheet-detail");
  sheet.classList.add("service-mode");
  document.getElementById("detail-top").innerHTML=renderServiceHeader(poi);
  document.getElementById("detail-body").innerHTML=[
    renderInfoSection(poi), renderHoursSection(poi), renderContactsSection(poi),
    renderArriveSection(poi), renderSourcesSection(poi)].join("");
  document.getElementById("detail-bar").innerHTML=renderServiceBar(poi);
  bindServiceButtons();
  bindServiceSheet(poi);
  void loadTransitDetail(poi);
  document.querySelector("#sheet-detail .sheet-body").scrollTop=0;
  openSheet("sheet-detail");
  document.querySelector("#detail-top .service-close")?.focus();
}

const SERVICE_SECTIONS=[["info","Informazioni"],["orari","Orari"],["contatti","Contatti"],["arrivare","Come arrivare"]];

/** Main offer cluster of the card's primary need, else the source's service name. */
function serviceTitle(poi) {
  const raw=poi.raw || {};
  const primary=raw.category?.slug || raw.needs?.[0];
  const offer=(raw.offers || []).find(o=>o.need===primary && o.code!=="associazioni") || (raw.offers || []).find(o=>o.code!=="associazioni");
  return offer?.label || poi.title;
}

/** Today's declared intervals in Rome time, e.g. "Oggi 19:00 – 08:00 (del giorno dopo)". */
function todayHours(display, now=new Date()) {
  const structured=display?.days?.some(d=>d.intervals?.length);
  if (!structured) return display?.raw_text || display?.scoped?.length ? "Orari indicati come testo" : "";
  const day=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Rome",weekday:"short"}).format(now);
  const key=["lun","mar","mer","gio","ven","sab","dom"][["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(day)];
  const today=display.days.find(d=>d.day===key);
  return today?.intervals?.length ? `Oggi ${today.intervals.map(i=>i.label).join(", ")}` : "";  // closed today: the status says it
}

/** Hours that deserve the separate amber flag: corrections, conflicts, review notes. */
function hoursNeedReview(display) {
  if (!display) return false;
  return Boolean((display.warnings || []).length || (display.days || []).some(d=>d.issues?.length || d.intervals?.some(i=>i.review_note)));
}

function sourceNames(poi) {
  const names=(poi.raw?.sources || []).map(s=>s.source_name).filter(Boolean);
  return names.length ? [...new Set(names)] : [sourceName(poi)];
}

function renderServiceHeader(poi) {
  const raw=poi.raw || {};
  const cat=resolveCategory(poi) || {};
  const facility=raw.facility_name || raw.name || "";
  const address=poi.address || "";
  const status=sourceOpeningStatus(raw.hours_display);
  const today=todayHours(raw.hours_display);
  const report=reportErrorAction(poi);
  return `<header class="service-head">
    <div class="service-head-row">${categoryBadge(cat)}<button type="button" class="service-close" data-close-service aria-label="Chiudi la scheda">Chiudi</button></div>
    <h2 class="service-title">${escapeHtml(serviceTitle(poi))}</h2>
    <p class="service-where">${facility ? `<strong>${escapeHtml(facility)}</strong>` : ""}${facility && address ? " · " : ""}${escapeHtml(address || (facility ? "" : raw.placement?.label || ""))}</p>
    <p class="service-status ${status.kind}" data-opening-service="${escapeHtml(poi.id)}"><strong>${escapeHtml(status.label)}</strong>${today ? `<span class="service-today">${escapeHtml(today)}</span>` : ""}${hoursNeedReview(raw.hours_display) ? '<span class="flag-hours">orari da verificare</span>' : ""}<small hidden></small></p>
    <div class="service-extra">
      ${raw.organization_raw ? `<p class="service-line"><span class="service-key">Organizzato da</span> ${escapeHtml(raw.organization_raw)}</p>` : ""}
      <p class="service-line service-sources"><span class="service-key">Fonti</span> ${sourceNames(poi).map(n=>`<span class="source-chip">${escapeHtml(n)}</span>`).join("")}<button type="button" class="flag-data" data-jump="fonti">da verificare</button>${report ? `<a class="service-report" href="${escapeHtml(report.href)}">Segnala errore</a>` : ""}</p>
    </div>
  </header>
  <nav class="service-anchors" aria-label="Sezioni della scheda">${SERVICE_SECTIONS.map(([id,label],i)=>`<button type="button" data-jump="${id}" class="${i===0 ? "on" : ""}">${label}</button>`).join("")}</nav>`;
}

function chipList(items, interpreted=new Set()) {
  return `<div class="service-chips">${items.map(x=>`<span class="service-chip${interpreted.has(x) ? " interpreted" : ""}">${escapeHtml(x)}</span>`).join("")}</div>`;
}

/** Labels in order, without repeats (case-insensitive). */
function uniqueLabels(labels) {
  const seen=new Set();
  return labels.filter(x=>{const k=String(x || "").toLowerCase().trim(); if (!k || seen.has(k)) return false; seen.add(k); return true;});
}

/** Source prestazioni not already shown as an offer ("Doccia" is covered by "Docce"). */
function uncoveredPrestazioni(raw) {
  const offers=raw.offers || [];
  const covered=new Set(offers.flatMap(o=>[o.label,String(o.basis || "").replace(/^(prestazione|tipo) della fonte: /,"")]).map(x=>String(x).toLowerCase()));
  const levels=(raw.course_facts?.levels || []).map(l=>String(l).toLowerCase());  // shown as "Livelli dei corsi"
  return uniqueLabels((raw.native_classifications?.prestazioni || []).map(p=>p.nome))
    .filter(n=>!covered.has(n.toLowerCase()) && !levels.some(l=>n.toLowerCase().includes(l)));
}

function renderInfoSection(poi) {
  const raw=poi.raw || {};
  const interpreted=new Set([...(raw.offers || []),...(raw.audiences || []),...(raw.access_tags || [])].filter(x=>x.interpreted).map(x=>x.label));
  const offers=uniqueLabels((raw.offers || []).filter(o=>o.code!=="associazioni" || raw.offers.length===1).map(o=>o.label));
  const extra=uncoveredPrestazioni(raw);
  const sections=raw.access_display?.sections || [];
  const entries=code=>(sections.find(s=>s.code===code)?.entries || []).map(e=>e.label);
  const forWhom=uniqueLabels([...entries("audience"),...(raw.audiences || []).map(a=>a.label)]);
  const access=uniqueLabels([...entries("procedure"),...entries("documents"),...entries("cost"),...(raw.access_tags || []).map(a=>a.label)]);
  const texts=raw.access_display?.texts || [];
  const levels=raw.course_facts?.levels || [];
  const description=raw.description || "";
  const siblings=sameSourceGroup(poi).filter(p=>p.id!==poi.id);
  const printed=raw.sources?.[0]?.source_kind==="document" ? ' class="source-printed-text"' : "";
  return `<section class="detail-section service-section" id="sec-info"><h3>Informazioni</h3>
    ${offers.length ? `<h4>Cosa offre</h4>${chipList(offers, interpreted)}` : ""}
    ${extra.length ? `<p class="service-also"><span class="service-key">Indicato anche dalla fonte</span> ${escapeHtml(extra.join(" · "))}</p>` : ""}
    ${forWhom.length ? `<h4>Per chi</h4>${chipList(forWhom, interpreted)}` : ""}
    ${access.length ? `<h4>Come si accede</h4>${chipList(access, interpreted)}` : ""}
    ${texts.map(t=>`<h4>${escapeHtml(t.title)}</h4><p class="source-hours-text">${escapeHtml(t.text)}</p>`).join("")}
    ${levels.length ? `<h4>Livelli dei corsi</h4>${chipList(levels)}` : ""}
    ${description ? (description.length > 260
      ? `<details class="service-description"><summary><span class="service-key">Descrizione della fonte</span> ${escapeHtml(description.slice(0,160))}…</summary><p${printed}>${escapeHtml(description)}</p></details>`
      : `<h4>Descrizione della fonte</h4><p${printed}>${escapeHtml(description)}</p>`) : ""}
    ${siblings.length ? `<h4>Altri servizi qui</h4>${siblings.map(serviceButton).join("")}` : ""}
  </section>`;
}

function renderHoursSection(poi) {
  const raw=poi.raw || {};
  const display=raw.hours_display;
  const known=Boolean(display?.days?.some(d=>d.intervals?.length) || display?.raw_text || display?.scoped?.length);
  const meals=(raw.meal_times || []).map(m=>m.label);
  const status=sourceOpeningStatus(display);
  const quiet=display ? {...display, note: ""} : display;
  return `<section class="detail-section service-section" id="sec-orari"><h3>Orari</h3>
    ${known ? renderSourceHours(quiet) : "<p>La fonte non indica orari.</p>"}
    ${meals.length ? `<h4>Pasti</h4>${chipList(meals)}` : ""}
    ${!known || hoursNeedReview(display) || status.kind==="unknown" ? '<p class="service-advice">Chiama prima di andare: gli orari potrebbero non essere aggiornati.</p>' : ""}
  </section>`;
}

function renderContactsSection(poi) {
  const contacts=(poi.contacts || []).filter(c=>c?.is_active!==false);
  return `<section class="detail-section service-section" id="sec-contatti"><h3>Contatti</h3>
    ${contactActions(contacts).length ? renderContacts(contacts) : "<p>La fonte non indica contatti.</p>"}
  </section>`;
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
    ${transitSectionShell(poi)}
  </section>`;
}

/** The only place that details how reliable the card is (one flag in the header). */
function renderSourcesSection(poi) {
  const raw=poi.raw || {};
  const interpreted=[...(raw.offers || []),...(raw.audiences || []),...(raw.access_tags || [])].filter(x=>x.interpreted);
  const items=[
    raw.freshness?.label,
    raw.placement?.label ? `Posizione: ${raw.placement.label}.` : "",
    raw.position?.match ? `Posizione ricavata dall’indirizzo con Nominatim (© OpenStreetMap contributors): ${raw.position.match}.` : "",
    sourceCode(poi)==="helpinet" ? "Ruolo dell’organizzazione indicata non verificato." : "",
    raw.hours_display?.note ? `Orari: ${raw.hours_display.note}` : "",
    raw.merged_from?.length ? `Scheda composta da ${raw.merged_from.length} schede della fonte che descrivono lo stesso servizio.` : "",
    interpreted.length ? `Etichette ricavate dal testo della fonte (da verificare): ${interpreted.map(x=>`${x.label} (${x.basis})`).join("; ")}.` : "",
  ].filter(Boolean);
  return `<details class="detail-section service-section service-sources-panel" id="sec-fonti"><summary><h3>Fonti e aggiornamenti</h3></summary>
    ${renderProvenance(poi)}
    <p class="service-key">Dati non revisionati da EGI: verifica con chi eroga il servizio.</p>
    <ul class="service-reliability">${items.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>
    <details><summary>Dati originali</summary><pre class="source-evidence">${escapeHtml(JSON.stringify({record:raw.source_locator,gruppo:raw.source_group,sintesi:raw.derived_summary,campi_originali:raw.source_values,posizione:raw.position,da_verificare:raw.review_required,schede_unite:raw.merged_from},null,2))}</pre></details>
  </details>`;
}

/** Fixed bar: call first (or e-mail / website), then directions. */
function renderServiceBar(poi) {
  const actions=contactActions((poi.contacts || []).filter(c=>c?.is_active!==false));
  const reach=actions.find(a=>a.kind==="phone") || actions.find(a=>a.kind==="email") || actions.find(a=>a.kind==="website");
  const go=directionsAction(poi);
  const label={phone:"Chiama",email:"Scrivi",website:"Sito web"};
  const buttons=[
    reach ? `<a class="service-bar-btn primary ${reach.kind}" href="${escapeHtml(reach.href)}"${reach.external ? ' target="_blank" rel="noopener noreferrer"' : ""}><span class="contact-action-icon">${contactActionIcon(reach)}</span>${label[reach.kind]}</a>` : "",
    go ? `<a class="service-bar-btn${reach ? "" : " primary"}" href="${escapeHtml(go.href)}" target="_blank" rel="noopener noreferrer"><span class="contact-action-icon">${contactActionIcon(go)}</span>Indicazioni</a>` : "",
  ].filter(Boolean);
  return buttons.join("");
}

/** Close, anchors, the header's data flag, and the compact header while scrolling. */
function bindServiceSheet(poi) {
  const top=document.getElementById("detail-top");
  const body=document.getElementById("detail-body");
  top.querySelector("[data-close-service]")?.addEventListener("click",closeSheets);
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
  top.querySelectorAll("[data-jump]").forEach(b=>b.addEventListener("click",()=>jump(b.dataset.jump)));
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

function resolveLocalizedContent(poi, currentLanguageCode) {
  const code = String(currentLanguageCode || "").toLowerCase();
  const match = (poi.translations || []).find((translation) => translation.language?.code?.toLowerCase() === code);
  if (match) {
    return {
      title: match.title || poi.title,
      notes: match.notes || poi.notes,
      badge: `${t("map.language")} ${match.language?.code?.toUpperCase() || code.toUpperCase()}`,
    };
  }
  return {
    title: poi.title,
    notes: poi.notes,
    badge: poi.original_language ? `Fallback ${poi.original_language.code.toUpperCase()}` : t("map.language"),
  };
}

function showSettingsPage(name) {
  document.getElementById("settings-main").style.display = name === "main" ? "block" : "none";
  document.getElementById("sub-language").classList.toggle("shown", name === "language");
  document.getElementById("sub-city").classList.toggle("shown", name === "city");
  settingsBackHead?.classList.toggle("hidden", name === "main");
}

function locateUser() {
  if (!navigator.geolocation) {
    locStatus.className = "loc-status err";
    locStatus.innerHTML = `<span class="label">${escapeHtml(t("map.position"))}</span>${escapeHtml(t("map.no_position_set"))}`;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setUserLocation(position.coords.latitude, position.coords.longitude, t("map.detected_position"));
    },
    () => {
      locStatus.className = "loc-status err";
      locStatus.innerHTML = `<span class="label">${escapeHtml(t("map.position"))}</span>${escapeHtml(t("map.no_position_set"))}`;
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function setUserLocation(lat,lng,label) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return showToast("Coordinate non valide");
  if (!isWithinCityBounds(lat,lng)) return showToast("Scegli un punto nell’area di Roma e dintorni");
  state.userLoc={lat,lng,label}; state.filters.order="distance";
  document.getElementById("sort-services").value="distance";
  const named = !/^(Punto|Posizione rilevata|Detected)/i.test(label);
  const display = named ? label : `${label} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  document.getElementById("reference-status").textContent=`Distanze in linea d’aria da ${display}`;
  locStatus.className="loc-status ok";
  locStatus.textContent=display;
  document.getElementById("origin-transit-body").textContent="Apri per caricare fermate e partenze dal punto scelto.";
  originRequest?.abort();
  if (document.getElementById("origin-transit").open) void loadOriginTransit();
  if (isWithinCityBounds(lat,lng)) map.setView([lat,lng],13);
  closeSheets();refresh();
}

function applyInitialUserLocation() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("user_lat") || !params.has("user_lng") || !params.get("user_lat")?.trim() || !params.get("user_lng")?.trim()) return;
  const lat = Number(params.get("user_lat"));
  const lng = Number(params.get("user_lng"));
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    setUserLocation(lat, lng, t("map.detected_position"));
  }
  clearInitialUserLocationParams(params);
}

function clearInitialUserLocationParams(params) {
  if (!params.has("user_lat") && !params.has("user_lng")) {
    return;
  }

  params.delete("user_lat");
  params.delete("user_lng");
  const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", cleanUrl);
}

async function geocodeAddress(address) {
  if (address.length<3) return;
  addressRequest?.abort();
  const current=new AbortController(); addressRequest=current;
  const status=document.getElementById("address-search-status");
  const results=document.getElementById("address-results");
  results.replaceChildren(); status.textContent="Cerco indirizzo…";
  try {
    const response=await fetch("/api/preview/address-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:address}),signal:current.signal});
    if (!response.ok) throw Error("unavailable");
    const data=await response.json();
    if (current.signal.aborted) return;
    status.textContent=data.results.length ? "Scegli un risultato:" : "Nessun risultato nell’area di Roma e dintorni. Prova un indirizzo più preciso o scegli sulla mappa.";
    for (const row of data.results) {
      const button=document.createElement("button"); button.type="button"; button.className="address-result"; button.textContent=row.label;
      button.addEventListener("click",()=>{setUserLocation(row.lat,row.lon,row.label); results.replaceChildren(); status.textContent="Indirizzo selezionato.";});
      results.appendChild(button);
    }
  } catch(error) {
    if (current.signal.aborted) return;
    status.textContent="Ricerca indirizzo non disponibile. Puoi usare la geolocalizzazione o scegliere sulla mappa.";
  }
}

async function loadOriginTransit() {
  if (!state.userLoc) return;
  originRequest?.abort();
  const current=new AbortController(); originRequest=current;
  const origin=state.userLoc;
  const node=document.getElementById("origin-transit-body");
  node.textContent="Carico fermate e partenze vicine…";
  try {
    const response=await fetch(`/api/preview/transit/origin?${new URLSearchParams({lat:origin.lat,lon:origin.lng})}`,{signal:current.signal});
    if (!response.ok) throw Error("unavailable");
    const data=await response.json();
    if (current.signal.aborted || state.userLoc!==origin) return;
    const stops=data.stops || [];
    stops.forEach(g=>g.lines.forEach(line=>line.origin=true));
    node.innerHTML=`<p class="source-note">Dal riferimento: ${escapeHtml(origin.label)}. Distanze in linea d’aria; verifica di poter raggiungere la fermata in tempo.</p><ul class="transit-list">${stops.map((g,i)=>transitStopGroup(g,i,data.alerts)).join("")}</ul>${!stops.length ? "Nessuna fermata nei dati disponibili vicino al punto scelto." : ""}<p class="source-note">${TransportLayer.realtimeNote(data)} Aggiornato alle ${escapeHtml(data.now || "—")}.</p><button type="button" data-refresh-origin>Aggiorna partenze</button>`;
    node.querySelector("[data-refresh-origin]")?.addEventListener("click",loadOriginTransit);
    node.querySelectorAll("[data-focus-route]").forEach(button=>button.addEventListener("click",()=>focusOriginLines(data.lines.filter(row=>row.route_id===button.dataset.focusRoute))));
    node.querySelectorAll("[data-focus-stop]").forEach(button=>button.addEventListener("click",()=>focusOriginLines(stops[Number(button.dataset.focusStop)].lines)));
  } catch(error) {if (!current.signal.aborted) node.textContent="Mezzi vicini non disponibili al momento. La ricerca servizi resta disponibile.";}
}

function focusOriginLines(lines) {
  const origin=state.userLoc;
  if (!origin || !lines.length) return;
  closeSheets(); if (state.view!=="map") toggleView();
  transport.focus({routeIds:lines.map(r=>r.route_id),label:`Mezzi vicino a ${origin.label}`,stopIds:lines.flatMap(r=>r.stop_ids),points:[[origin.lat,origin.lng],...lines.map(r=>[r.stop_point[1],r.stop_point[0]])]});
}

function renderHours(hours) {
  const schedule = buildWeeklySchedule(hours);
  const now = new Date();
  const today = isoWeekday(now);
  const status = currentOpeningStatus(schedule, now);
  const isCollapsed = !status.isOpen;
  const statusTag = isCollapsed ? "button" : "div";
  const statusAttributes = isCollapsed
    ? ' type="button" data-hours-toggle aria-expanded="false" aria-controls="detail-hours-table"'
    : "";
  return `
    <${statusTag} class="hours-status ${status.isOpen ? "open" : "closed"}${isCollapsed ? " interactive" : ""}"${statusAttributes}>
      <span class="hours-status-dot" aria-hidden="true"></span>
      <span class="hours-status-copy">
        <strong>${escapeHtml(status.label)}</strong>
        <span>${escapeHtml(status.detail)}</span>
      </span>
      ${isCollapsed ? `
        <span class="hours-toggle-label">
          <span data-hours-toggle-label>${escapeHtml(t("map.show_hours", {}, "Mostra orari"))}</span>
          <span class="hours-toggle-chevron" aria-hidden="true">⌄</span>
        </span>
      ` : ""}
    </${statusTag}>
    <div class="hours-table${isCollapsed ? " collapsed" : ""}" id="detail-hours-table">
      ${[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
        const ranges = schedule.get(weekday) || [];
        const isToday = weekday === today;
        return `
          <div class="hours-row${isToday ? " today" : ""}">
            <div class="hours-day">
              <span>${escapeHtml(weekdayFullLabel(weekday))}</span>
              ${isToday ? `<span class="hours-today-tag">${escapeHtml(t("map.today", {}, "Oggi"))}</span>` : ""}
            </div>
            <div class="hours-time${ranges.length ? "" : " closed"}">
              ${ranges.length ? ranges.map(formatHourRange).join('<span class="hours-range-separator">/</span>') : escapeHtml(t("map.closed", {}, "Closed"))}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
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
  });
}

function renderContacts(contacts) {
  const activeContacts = contacts.filter((contact) => contact?.is_active !== false);
  const actions = contactActions(activeContacts);
  if (!actions.length) {
    return `<p style="margin:0;font-size:14px">${escapeHtml(t("common.not_available"))}</p>`;
  }

  const columnCount = Math.min(actions.length, 4);
  return `
    <div class="contact-actions" style="--contact-count:${columnCount}">
      ${actions.map((action) => `
        <a class="contact-action ${action.kind}" href="${escapeHtml(action.href)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>
          <span class="contact-action-icon">${contactActionIcon(action)}</span>
          <span class="contact-action-label">${escapeHtml(action.label)}</span>
        </a>
      `).join("")}
    </div>
  `;
}

function renderDetailHeaderActions(poi) {
  const actions = [directionsAction(poi), reportErrorAction(poi)].filter(Boolean);
  if (!actions.length) return "";
  return `
    <div class="detail-header-actions">
      ${actions.map((action) => `
        <a class="detail-header-action ${action.kind}" href="${escapeHtml(action.href)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>
          <span class="detail-header-action-icon">${contactActionIcon(action)}</span>
          <span class="detail-header-action-label">${escapeHtml(action.label)}</span>
        </a>
      `).join("")}
    </div>
  `;
}

function renderCost(poi) {
  const label = costLabel(poi.cost_tag);
  const note = poi.cost_note ? `<span style="display:block;color:var(--ink-soft);margin-top:4px">${escapeHtml(poi.cost_note)}</span>` : "";
  return `<p style="margin:0;font-size:14px">${escapeHtml(label)}${note}</p>`;
}

function renderTags(tags) {
  if (!tags.length) {
    return `<p style="margin:0;font-size:14px">${escapeHtml(t("common.not_available"))}</p>`;
  }
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag.label || tag.slug)}</span>`).join("")}
    </div>
  `;
}

function buildWeeklySchedule(hours) {
  const schedule = new Map([1, 2, 3, 4, 5, 6, 7].map((weekday) => [weekday, []]));
  (hours || []).forEach((hour) => {
    const weekday = Number(hour.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return;

    const range = hour.is_24h
      ? { weekday, is24h: true, opensMinutes: 0, closesMinutes: 1440, note: hour.note || "" }
      : hourRangeFromRecord(hour, weekday);
    if (!range) return;
    schedule.get(weekday).push(range);
  });

  schedule.forEach((ranges) => {
    ranges.sort((a, b) => a.opensMinutes - b.opensMinutes);
  });
  return schedule;
}

function hourRangeFromRecord(hour, weekday) {
  const opensMinutes = parseClockMinutes(hour.opens_at);
  const closesMinutes = parseClockMinutes(hour.closes_at);
  if (opensMinutes == null || closesMinutes == null) return null;
  return {
    weekday,
    is24h: false,
    opensMinutes,
    closesMinutes,
    note: hour.note || "",
  };
}

function currentOpeningStatus(schedule, now) {
  const nowMinute = weekMinute(now);
  const intervals = mergedOpeningIntervals(schedule);
  if (!intervals.length) {
    return {
      isOpen: false,
      label: t("map.closed_now", {}, "Chiuso ora"),
      detail: t("map.no_opening_records", {}, "Nessuna apertura registrata."),
    };
  }

  const current = intervals.find((interval) => nowMinute >= interval.start && nowMinute < interval.end);
  if (current) {
    if (current.end - current.start >= 7 * 24 * 60) {
      return {
        isOpen: true,
        label: t("map.open_now", {}, "Aperto ora"),
        detail: t("map.open_24h", {}, "24h"),
      };
    }
    return {
      isOpen: true,
      label: t("map.open_now", {}, "Aperto ora"),
      detail: formatOpeningDelta("closes", current.end, nowMinute),
    };
  }

  const next = intervals.find((interval) => interval.start > nowMinute);
  if (!next) {
    return {
      isOpen: false,
      label: t("map.closed_now", {}, "Chiuso ora"),
      detail: t("map.no_opening_records", {}, "Nessuna apertura registrata."),
    };
  }

  return {
    isOpen: false,
    label: t("map.closed_now", {}, "Chiuso ora"),
    detail: formatOpeningDelta("opens", next.start, nowMinute),
  };
}

function formatOpeningDelta(kind, targetMinute, nowMinute) {
  const delta = targetMinute - nowMinute;
  if (delta < 6 * 60) {
    const duration = formatDuration(delta);
    return kind === "closes"
      ? t("map.closes_in", { duration }, `Chiude tra ${duration}`)
      : t("map.opens_in", { duration }, `Apre tra ${duration}`);
  }

  const target = weekMomentLabel(targetMinute);
  return kind === "closes"
    ? t("map.closes_at", { day: target.day, time: target.time }, `Chiude ${target.day} alle ${target.time}`)
    : t("map.opens_at", { day: target.day, time: target.time }, `Apre ${target.day} alle ${target.time}`);
}

function mergedOpeningIntervals(schedule) {
  const week = 7 * 24 * 60;
  const intervals = [];
  schedule.forEach((ranges, weekday) => {
    ranges.forEach((range) => {
      const startBase = (weekday - 1) * 24 * 60 + range.opensMinutes;
      const endBase = range.is24h
        ? (weekday - 1) * 24 * 60 + 24 * 60
        : startBase + rangeDurationMinutes(range);
      for (let offset = -1; offset <= 2; offset += 1) {
        intervals.push({
          start: startBase + offset * week,
          end: endBase + offset * week,
        });
      }
    });
  });

  intervals.sort((a, b) => a.start - b.start);
  return intervals.reduce((merged, interval) => {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
      return merged;
    }
    merged.push({ ...interval });
    return merged;
  }, []);
}

function rangeDurationMinutes(range) {
  if (range.is24h) return 24 * 60;
  if (range.closesMinutes <= range.opensMinutes) {
    return 24 * 60 - range.opensMinutes + range.closesMinutes;
  }
  return range.closesMinutes - range.opensMinutes;
}

function formatHourRange(range) {
  const label = range.is24h
    ? escapeHtml(t("map.open_24h", {}, "24h"))
    : `${escapeHtml(formatClock(range.opensMinutes))}-${escapeHtml(formatClock(range.closesMinutes))}`;
  const note = range.note ? ` <span class="hours-note">${escapeHtml(range.note)}</span>` : "";
  return `<span>${label}${note}</span>`;
}

function parseClockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatClock(minutes) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
  const mins = String(normalized % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

function weekMomentLabel(weekMinutes) {
  const week = 7 * 24 * 60;
  const normalized = ((weekMinutes % week) + week) % week;
  const weekday = Math.floor(normalized / (24 * 60)) + 1;
  const minutes = normalized % (24 * 60);
  return {
    day: weekdayFullLabel(weekday),
    time: formatClock(minutes),
  };
}

function weekMinute(date) {
  const weekday = isoWeekday(date);
  return (weekday - 1) * 24 * 60 + date.getHours() * 60 + date.getMinutes();
}

function isoWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function formatDuration(minutes) {
  const total = Math.max(1, Math.ceil(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) {
    return [days ? `${days} d` : "", hours ? `${hours} h` : ""].filter(Boolean).join(" ");
  }
  if (hours > 0) {
    return [hours ? `${hours} h` : "", mins ? `${mins} min` : ""].filter(Boolean).join(" ");
  }
  return `${mins} min`;
}

function weekdayFullLabel(weekday) {
  const labels = {
    it: ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
    en: ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    fr: ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"],
    ar: ["", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
  };
  return (labels[state.lang] || labels.it)[Number(weekday)] || String(weekday);
}

function contactActions(contacts) {
  const actions = [];
  const seen = new Set();

  contacts.forEach((contact) => {
    const action = contactAction(contact);
    if (!action) return;
    const key = `${action.kind}:${action.href}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(action);
  });

  return actions.sort((a, b) => a.priority - b.priority);
}

function contactAction(contact) {
  const type = String(contact.type || contact.contact_type || "").toLowerCase();
  const value = String(contact.value || contact.contact_value || "").trim();
  if (!value) return null;
  const href = contactHref(contact);
  if (!href) return null;

  if (type === "phone") {
    return {
      kind: "phone",
      href,
      label: String(contact.label || "").trim() || value,
      external: false,
      priority: 1,
    };
  }
  if (type === "whatsapp") {
    return {
      kind: "whatsapp",
      href,
      label: t("map.whatsapp_action", {}, "WhatsApp"),
      external: true,
      priority: 2,
    };
  }
  if (type === "website" || type === "social") {
    return {
      kind: "website",
      href,
      label: type === "social" ? t("map.social_action", {}, "Social") : t("map.website_short_action", {}, "Sito web"),
      external: true,
      priority: 3,
    };
  }
  if (type === "email") {
    return {
      kind: "email",
      href,
      label: String(contact.label || "").trim() || value,
      external: false,
      priority: 4,
    };
  }
  if (type === "telegram") {
    return {
      kind: "telegram",
      href,
      label: t("map.telegram_action", {}, "Telegram"),
      external: true,
      priority: 5,
    };
  }
  return {
    kind: "other",
    href,
    label: contact.label || value,
    external: /^https?:\/\//i.test(href),
    priority: 6,
  };
}

function directionsAction(poi) {
  if (!poi) return null;
  const href = googleMapsDirectionsHref(poi);
  if (!href) return null;
  return {
    kind: "directions",
    href,
    label: t("map.directions_action", {}, "Indicazioni"),
    external: true,
    priority: 0,
  };
}

function reportErrorAction(poi) {
  if (!poi?.id) return null;
  const url = new URL("/contribuisci", window.location.origin);
  url.searchParams.set("city_id", String(context.cityId || ""));
  url.searchParams.set("lang", normalizeLang(state.lang));
  url.searchParams.set("poi_id", String(poi.id));
  url.searchParams.set("issue", "error");
  return {
    kind: "report-error",
    href: url.pathname + url.search,
    label: t("map.report_error_action", {}, "Segnala un errore"),
    external: false,
    priority: 10,
  };
}

function contactActionIcon(action) {
  const icons = {
    directions: "/static/assets/icons/default/direction.svg",
    "report-error": "/static/assets/icons/default/report.svg",
    website: "/static/assets/icons/default/web.svg",
    email: "/static/assets/icons/default/email.svg",
    phone: "/static/assets/icons/ui/phone.svg",
    whatsapp: "/static/assets/icons/brands/whatsapp.svg",
  };
  const icon = icons[action.kind];
  if (icon) {
    return `<img src="${icon}" alt="" aria-hidden="true" />`;
  }
  const symbol = action.kind === "email" ? "@" : action.kind === "website" ? "www" : action.kind === "report-error" ? "!" : "↗";
  return `<span class="contact-action-symbol" aria-hidden="true">${escapeHtml(symbol)}</span>`;
}

function googleMapsDirectionsHref(poi) {
  if (poi.raw?.placement?.section === "directory") return null;
  const lat = poi.latitude;
  const lng = poi.longitude;
  const destination = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat},${lng}`
    : String(poi.address || "").trim();
  if (!destination) return null;

  const params = new URLSearchParams({
    api: "1",
    destination,
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function contactHref(contact) {
  const type = String(contact.type || contact.contact_type || "").toLowerCase();
  const value = String(contact.value || contact.contact_value || "").trim();
  if (!value) return null;
  // Helpinet v0.3 gives a dialable number (`dial`); null means the value is not a number.
  if ((type === "phone" || type === "fax") && "dial" in contact) return contact.dial ? `tel:${contact.dial}` : null;
  if (type === "phone" || type === "fax") return `tel:${value.replace(/[^\d+]/g, "")}`;
  if (type === "email") return `mailto:${value}`;
  if (type === "whatsapp") return `https://wa.me/${value.replace(/\D/g, "")}`;
  if (type === "website" || type === "social" || type === "telegram") {
    return normalizeExternalHref(value);
  }
  return null;
}

function normalizeExternalHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(raw)) return `https://${raw}`;
  return null;
}

function costLabel(costTag) {
  const labels = {
    free: t("contribute.cost.free", {}, "Gratis"),
    low_cost: t("contribute.cost.contribution", {}, "Contributo"),
    donation: t("contribute.cost.contribution", {}, "Contributo"),
    variable: t("contribute.cost.unknown", {}, "Non noto"),
    paid: t("map.paid", {}, "A pagamento"),
    unknown: t("contribute.cost.unknown", {}, "Non noto"),
  };
  return labels[costTag] || costTag || t("common.not_available");
}

function makePin(poi) {
  const categories = poi.site_categories || [resolveCategory(poi) || {label:poi.category_label,color:poi.category_color,icon_path:poi.category_icon_path}];
  const weights = poi.site_weights || categories.map(()=>1);
  const total = weights.reduce((a,b)=>a+b,0);
  let position=0;
  const colorStops=categories.map((c,i)=>{const start=position; position+=weights[i]/total*100; return `${c.color || "#555"} ${start}% ${position}%`;}).join(",");
  const c=categories[0];
  const icon=normalizeCategoryIconPath(c.icon_path);
  const content=poi.group_count>1 ? `<span class="site-total">${poi.group_count}</span>` : `<span class="single-pin-icon">${icon ? `<img src="${escapeHtml(icon)}" alt="">` : escapeHtml(markerFallbackLabel(c.label || c.slug))}</span>`;
  return L.divIcon({className:"",html:`<div class="site-pin ${poi.group_count>1 ? "multi" : "single"}" style="background:conic-gradient(${colorStops})">${content}</div>`,iconSize:[44,44],iconAnchor:[22,44]});
}

function userIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="user-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function resolveCategory(poi) {
  return state.categories.find((category) => category.id === poi.category_id)
    || normalizeEmbeddedCategory(poi.category)
    || null;
}

function normalizePublicService(service) {
  const place = service.place || {};
  const point = pointLatLng(place.geometry);
  const primarySource = (service.sources || []).find((source) => source.is_primary)
    || (service.sources || [])[0]
    || (place.sources || [])[0]
    || null;

  return {
    id: service.id,
    place_id: service.place_id || place.id,
    category_id: service.category?.id || service.category_id,
    subcategory_id: service.subcategory?.id || service.subcategory_id,
    title: service.service_title || service.name || place.name || "Servizio",
    notes: service.description || "",
    cost_tag: service.cost_tag,
    cost_note: service.cost_note,
    valid_from: service.valid_from,
    valid_until: service.valid_until,
    address: place.is_protected_address ? t("common.not_available") : place.address,
    latitude: point.lat,
    longitude: point.lng,
    category: service.category || null,
    subcategory: service.subcategory || null,
    subcategories: service.subcategories || [],
    hours: service.hours || [],
    contacts: service.contacts || [],
    place_contacts: place.contacts || [],
    tags: service.tags || [],
    sources: service.sources || [],
    place_sources: place.sources || [],
    source_url: primarySource?.source_url || null,
    original_language: null,
    translations: [],
    raw: service,
  };
}

function mergeServiceCategories(categories, services) {
  const byId = new Map(categories.map((category) => [Number(category.id), category]));
  services.forEach((service) => {
    const embedded = normalizeEmbeddedCategory(service.category);
    if (!embedded) return;

    const current = byId.get(Number(embedded.id));
    byId.set(Number(embedded.id), {
      ...embedded,
      ...current,
      label: embedded.label || current?.label || embedded.slug,
    });
  });
  return Array.from(byId.values()).sort((a, b) => (a.sort_order || 100) - (b.sort_order || 100));
}

function normalizeEmbeddedCategory(category) {
  if (!category || category.id == null) return null;
  return {
    id: Number(category.id),
    area_id: null,
    slug: category.slug,
    label: category.label || category.slug,
    color: category.color,
    icon_path: category.icon_path,
    sort_order: category.sort_order || 100,
  };
}

function composePois(services, places) {
  const placesById = new Map(places.map((place) => [Number(place.id), place]));
  return services
    .map((service) => {
      const place = placesById.get(Number(service.place_id));
      if (!place) return null;
      const point = pointLatLng(place.geometry);
      return {
        id: service.id,
        place_id: service.place_id,
        category_id: service.category_id,
        subcategory_id: service.subcategory_id,
        title: service.name || place.name || "Servizio",
        notes: service.description || "",
        cost_tag: service.cost_tag,
        address: place.is_protected_address ? t("common.not_available") : place.address,
        latitude: point.lat,
        longitude: point.lng,
        source_url: null,
        original_language: null,
        translations: [],
      };
    })
    .filter(Boolean);
}

function normalizeArea(area) {
  const center = pointLatLng(area.default_center);
  const bbox = bboxFromPolygon(area.geometry_bbox);
  return {
    id: area.id,
    slug: area.slug,
    name: area.name,
    countryCode: area.country_code,
    isDefault: area.slug === "roma" || area.name.toLowerCase() === "roma",
    centerLat: center.lat,
    centerLng: center.lng,
    bboxNorth: bbox.north,
    bboxSouth: bbox.south,
    bboxEast: bbox.east,
    bboxWest: bbox.west,
  };
}

function normalizeCategory(category) {
  return {
    id: category.id,
    area_id: category.area_id,
    slug: category.slug,
    label: category.label || category.slug,
    color: category.color,
    icon_path: category.icon_path,
    sort_order: category.sort_order,
  };
}

function applyCategoryLabels(categories) {
  const languageId = state.languages.find((language) => normalizeLang(language.code) === normalizeLang(state.lang))?.id
    || state.languages.find((language) => normalizeLang(language.code) === "it")?.id
    || null;
  return categories.map((category) => {
    const translation = state.categoryTranslations.find(
      (item) => item.category_id === category.id && item.language_id === languageId
    ) || state.categoryTranslations.find((item) => item.category_id === category.id);
    return {
      ...category,
      label: translation?.label || category.label || category.slug,
    };
  });
}

function pointLatLng(geojson) {
  if (!geojson || geojson.type !== "Point" || !Array.isArray(geojson.coordinates)) {
    return { lat: null, lng: null };
  }
  const [lng, lat] = geojson.coordinates;
  return { lat: Number(lat), lng: Number(lng) };
}

function bboxFromPolygon(geojson) {
  const ring = geojson?.type === "Polygon" && Array.isArray(geojson.coordinates)
    ? geojson.coordinates.flat(1)
    : [];
  const lngs = ring.map((point) => Number(point?.[0])).filter(Number.isFinite);
  const lats = ring.map((point) => Number(point?.[1])).filter(Number.isFinite);
  if (!lngs.length || !lats.length) {
    return { north: null, south: null, east: null, west: null };
  }
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

function categoryColor(slug) {
  const palette = {
    food: "var(--cat-food)",
    shelter: "var(--cat-shelter)",
    hygiene: "var(--cat-hygiene)",
    health: "var(--cat-health)",
    legal: "var(--cat-legal)",
    psych: "var(--cat-psych)",
    other: "var(--cat-other)",
  };
  return palette[slug] || palette.other;
}

function normalizeCategoryIconPath(iconPath) {
  const raw = String(iconPath || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^\/+/, "");
  if (!cleaned.endsWith(".svg")) return null;
  if (/^static\/assets\/icons\/[a-zA-Z0-9_ /-]+\.svg$/.test(cleaned)) return `/${cleaned}`;
  if (cleaned.startsWith("icons/")) return `/static/assets/${cleaned}`;
  if (cleaned.startsWith("assets/icons/")) return `/static/${cleaned}`;
  return null;
}

function markerFallbackLabel(label) {
  const first = String(label || "").trim().charAt(0);
  return first ? first.toUpperCase() : "•";
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function isWithinCityBounds(lat, lng) {
  return cityBounds ? cityBounds.contains(L.latLng(lat, lng)) : true;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("shown");
  window.clearTimeout(showToast._timeout);
  showToast._timeout = window.setTimeout(() => {
    toast.classList.remove("shown");
  }, 1800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function t(key, params = {}, fallback = "") {
  return window.EGI_I18N.t(key, params, fallback);
}

function normalizeLang(value) {
  return String(value || "it").split("-")[0].toLowerCase();
}

function folded(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("it");
}

function searchableService(poi) {
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
const POSITION_ISSUES = {
  no_address: "Indirizzo mancante", no_street: "Via mancante", no_street_unresolved: "Via mancante, non trovata",
  unresolved: "Indirizzo non trovato", municipality_only: "Trovato solo il comune", postcode_area_only: "Trovato solo il CAP",
  ambiguous: "Indirizzo ambiguo", no_coordinates: "Coordinate mancanti (Helpinet)",
};

/** Rebuild one select: values with a count under the other filters, plus the selected one. */
function fillFacetSelect(select, facet, allLabel, labels) {
  const counts = state.facets?.[facet] || new Map();
  const selected = state.filters[facet];
  const values = [...labels.keys()].filter(v => counts.get(v) || v === selected)
    .sort((a, b) => labels.get(a).localeCompare(labels.get(b), "it"));
  if (selected && !labels.has(selected)) state.filters[facet] = "";
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(labels.get(v))} (${counts.get(v) || 0})</option>`).join("");
  select.value = state.filters[facet];
}

function renderSearchOptions() {
  const types = document.getElementById("service-type-filter");
  const prestations = document.getElementById("prestation-filter");
  const access = document.getElementById("access-filter");
  const sources = document.getElementById("source-filter");
  if (!types || !prestations || !access) return;
  if (!state.facets) state.facets = facetCounts();
  const labels = {type: new Map(), prestation: new Map(), access: new Map(), audience: new Map(), meal: new Map(), source: new Map()};
  const needLabel = Object.fromEntries((state.taxonomy.needs || []).map(n => [n.slug, n.label]));
  for (const p of state.pois) {
    const raw = p.raw || {};
    if (raw.native_classifications?.tipologia) labels.type.set(raw.native_classifications.tipologia, raw.native_classifications.tipologia);
    if (raw.offers) raw.offers.forEach(o => labels.prestation.set(o.code, `${needLabel[o.need] || o.need} › ${o.label}`));
    else (raw.native_classifications?.prestazioni || []).forEach(v => labels.prestation.set(String(v.id), v.nome));
    (raw.audiences || []).forEach(a => labels.audience.set(a.code, a.label));
    (raw.meal_times || []).forEach(m => labels.meal.set(m.code, m.label));
    if (raw.access_tags) raw.access_tags.forEach(a => labels.access.set(a.code, a.label));
    else (raw.access_display?.sections || []).forEach(s => s.entries.filter(e => e.value === true).forEach(e => labels.access.set(e.code, e.label)));
    labels.source.set(sourceCode(p), sourceName(p));
  }
  fillFacetSelect(types, "type", "Tutte le tipologie", labels.type);
  fillFacetSelect(prestations, "prestation", "Tutte le prestazioni", labels.prestation);
  fillFacetSelect(access, "access", "Qualsiasi modalità di accesso", labels.access);
  const audience = document.getElementById("audience-filter"), meal = document.getElementById("meal-filter");
  if (audience) fillFacetSelect(audience, "audience", "Per tutte e tutti", labels.audience);
  if (meal) fillFacetSelect(meal, "meal", "Qualsiasi pasto", labels.meal);
  if (sources) fillFacetSelect(sources, "source", "Tutte le fonti", labels.source);
  const issues = document.getElementById("issue-filter");
  if (issues) issues.closest?.(".issue-filter-wrap")?.toggleAttribute("hidden", !DEBUG_MODE);
  if (issues && DEBUG_MODE) fillFacetSelect(issues, "issue", "Qualsiasi (anche posizioni presenti)", new Map(Object.entries(POSITION_ISSUES)));
}

/** Recount facets and update the filter sheet: total, need tiles and selects. */
function renderFacets() {
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
function sourceCode(poi) {
  return poi.raw?.source_code || "helpinet";
}

/** Second list line: the facility, or the address when the facility repeats the title. */
function facilityLine(poi) {
  const raw = poi.raw || {};
  const facility = raw.facility_name || raw.name || "";
  return facility && facility !== poi.title ? facility : (poi.address || facility);
}

function sourceName(poi) {
  return poi.raw?.sources?.[0]?.source_name || "Helpinet";
}

/** Map-export positions are geocoded estimates; say how they were found. */
function renderPositionNote(raw) {
  const pos = raw.position;
  if (!pos) return "";
  const match = pos.match ? ` Corrispondenza: ${escapeHtml(pos.match)}.` : "";
  return `<p class="source-note">Posizione ricavata dall’indirizzo della fonte con Nominatim (© OpenStreetMap contributors).${match}</p>`;
}


// Provenance wording by registry source kind; map exports stay the default.
const SOURCE_KIND_TEXT = {
  map_export: {link: "mappa originale", acquired: "Esportazione KML acquisita il"},
  open_data: {link: "file originale", acquired: "File open data acquisito il"},
  web_pages: {link: "pagine originali", acquired: "Pagine web acquisite il"},
  document: {link: "guida originale", acquired: "Estratto dalla guida (PDF, revisione egi_sources) il"},
};

function renderProvenance(poi) {
  const raw = poi.raw || {};
  const src = raw.sources?.[0] || {};
  if (sourceCode(poi) === "helpinet") return `<p>Helpinet · <a href="https://helpinet.app/app/" target="_blank" rel="noopener">helpinet.app</a>. Copia locale del ${escapeHtml((raw.observed_at || "—").slice(0, 10))}; data di raccolta originale non nota.</p>`;
  const kind = SOURCE_KIND_TEXT[src.source_kind] || SOURCE_KIND_TEXT.map_export;
  const link = src.source_url ? ` · <a href="${escapeHtml(src.source_url)}" target="_blank" rel="noopener">${kind.link}</a>` : "";
  return `<p>${escapeHtml(src.source_title || src.source_name || "Fonte")}${link}. ${kind.acquired} ${escapeHtml(raw.original_retrieved_at || "—")}.</p>${src.attribution?`<p class="source-note">${escapeHtml(src.attribution)}. Licenza di riuso non stabilita: solo preview locale.</p>`:""}`;
}

function renderSourceHours(display) {
  if (!display) return '<p>Orari non indicati.</p>';
  if ("raw_text" in display && display.scoped?.length) return `<p class="source-note">${escapeHtml(display.note)}</p>${display.scoped.map(b=>`<div class="access-section">${b.title?`<h4>${escapeHtml(b.title)}</h4>`:""}${b.labels.length?`<div class="service-chips">${b.labels.map(l=>`<span class="service-chip">${escapeHtml(l.kind)}: ${escapeHtml(l.text)}${l.interpreted?" (interpretazione in revisione)":""}</span>`).join("")}</div>`:""}<p class="source-hours-text">${escapeHtml(b.text)}</p></div>`).join("")}`;
  if ("raw_text" in display) return `<p class="source-note">${escapeHtml(display.note)}</p>${display.raw_text?`<p class="source-hours-text">${escapeHtml(display.raw_text)}</p>`:""}`;
  // Days without hours are closed when the source declares other days (user, 2026-11-15).
  const empty=display.days.some(d=>d.intervals.length) ? '<span class="unknown-value">Chiuso</span>' : '<span class="unknown-value">Non indicato</span>';
  return `${display.note ? `<p class="source-note">${escapeHtml(display.note)}</p>` : ""}<div class="source-week">${display.days.map(day=>`<div class="source-day"><strong>${escapeHtml(day.label)}</strong><span>${day.intervals.length ? day.intervals.map(v=>`<span>${escapeHtml(v.label)}${v.review_note ? ` <small>${escapeHtml(v.review_note)}</small>`:""}</span>`).join("<br>") : empty}${day.issues.length && !day.intervals.length ? `<small>${escapeHtml(day.issues.join("; "))}</small>`:""}</span></div>`).join("")}</div>${(display.warnings || []).map(w=>`<p class="source-note">${escapeHtml(w)}</p>`).join("")}`;
}

function renderSourceAccess(display) {
  if (!display) return '<p>Indicazioni non disponibili.</p>';
  const texts=(display.texts || []).map(t=>`<div class="access-section"><h4>${escapeHtml(t.title)}</h4><p class="source-hours-text">${escapeHtml(t.text)}</p></div>`).join("");
  if (texts && !display.sections.length) return `${texts}<p class="source-note">${escapeHtml(display.note)}</p>`;
  return `${texts}${display.sections.length ? display.sections.map(section=>`<div class="access-section"><h4>${escapeHtml(section.title)}</h4><div class="service-chips">${section.entries.map(e=>`<span class="service-chip"${e.basis?` title="${escapeHtml(e.basis)}"`:""}>${escapeHtml(e.label)}${e.status==="derived"?" *":""}</span>`).join("")}</div></div>`).join("") : '<p>Nessuna indicazione positiva nella fonte.</p>'}<p class="source-note">${escapeHtml(display.note)}</p>`;
}

function sameSourceGroup(poi) {
  const id = poi.raw?.source_group?.external_key;
  return id ? state.pois.filter(p=>p.raw?.source_group?.external_key === id) : [poi];
}

function serviceButton(poi, matches = true) {
  return `<button type="button" class="related-service${matches ? "" : " outside-search"}" data-service-id="${escapeHtml(poi.id)}">${categoryBadge(resolveCategory(poi))}<span>${escapeHtml(poi.title)}</span>${matches?"":'<em>Altro servizio nel punto · fuori dai filtri attivi</em>'}<small>${escapeHtml((poi.raw?.native_classifications?.prestazioni || []).map(p=>p.nome).join(" · "))}</small></button>`;
}

function bindServiceButtons() {
  document.querySelectorAll("[data-service-id]").forEach(button=>button.addEventListener("click",()=>openDetail(button.dataset.serviceId)));
}

function openServiceChooser(items, matched = new Set(items.map(p=>p.id))) {
  if (items.length === 1) return openDetail(items[0].id);
  document.getElementById("sheet-detail").classList.remove("service-mode");
  document.getElementById("detail-top").innerHTML = "";
  document.getElementById("detail-bar").innerHTML = "";
  document.querySelector("#sheet-detail .sheet-head h2").textContent = "Scegli il servizio";
  document.getElementById("detail-body").innerHTML = `<h2>${escapeHtml(items[0].raw?.facility_name || "Gruppo della fonte")}</h2><p>${items.length} servizi con questa posizione. Scegli una scheda.</p>${items.map(p=>serviceButton(p,matched.has(p.id))).join("")}<p class="source-note">Servizi nella stessa posizione secondo le fonti; ogni servizio mantiene le proprie caratteristiche.</p>`;
  bindServiceButtons();
  document.querySelector("#sheet-detail .sheet-body").scrollTop=0;
  openSheet("sheet-detail");
}

function chooseReferencePoint() {
  state.choosingReference = true;
  closeSheets();
  if (state.view === "list") toggleView();
  document.getElementById("reference-status").textContent = "Tocca un punto sulla mappa come riferimento";
  showToast("Tocca la mappa per scegliere il riferimento");
}

/** Quick paths (presentation taxonomy): one tap sets a curated set of offers and shows its guidance. */
function renderPaths() {
  const wrap = document.getElementById("path-buttons");
  if (!wrap) return;
  const paths = state.taxonomy.paths || [];
  wrap.closest(".quick-paths")?.toggleAttribute("hidden", !paths.length);
  wrap.innerHTML = paths.map(p => `<button type="button" class="btn path-btn${state.filters.path === p.code ? " on" : ""}" data-path="${escapeHtml(p.code)}" aria-pressed="${state.filters.path === p.code}">${escapeHtml(p.label)}</button>`).join("");
  wrap.querySelectorAll("[data-path]").forEach(b => b.addEventListener("click", () => selectPath(b.dataset.path)));
  const note = document.getElementById("path-note");
  const current = paths.find(p => p.code === state.filters.path);
  if (note) { note.hidden = !current; note.textContent = current ? current.text : ""; }
}

function selectPath(code) {
  const f = state.filters;
  f.path = f.path === code ? "" : code;
  if (f.path) {
    Object.assign(f, {q: "", source: "", issue: "", type: "", prestation: "", access: "", audience: "", meal: "", section: "all", openNow: false});
    f.cats = new Set(state.categories.map(c => c.slug));
    document.getElementById("service-query").value = "";
    document.getElementById("open-now-filter").checked = false;
    document.getElementById("section-filter").value = "all";
  }
  renderPaths(); renderCatGrid(); renderSearchOptions(); refresh();
}

/** "Cosa offre": offers grouped by need, then audiences, access and meal times; interpretations marked. */
function renderOffers(raw) {
  if (!raw.offers) return "";
  const needs = Object.fromEntries((state.taxonomy.needs || []).map(n => [n.slug, n.label]));
  const chip = x => `<span class="service-chip${x.interpreted ? " interpreted" : ""}" title="${escapeHtml(x.basis || "")}">${escapeHtml(x.label)}${x.interpreted ? " *" : ""}</span>`;
  const groups = (raw.needs || []).map(n => {
    const items = raw.offers.filter(o => o.need === n);
    return `<div class="access-section"><h4>${escapeHtml(needs[n] || n)}</h4><div class="service-chips">${items.map(chip).join("") || '<span class="unknown-value">Bisogno indicato dalla fonte</span>'}</div></div>`;
  }).join("");
  const tags = [["Per chi", raw.audiences], ["Pasto", raw.meal_times], ["Come si accede", raw.access_tags]]
    .filter(([, list]) => list?.length)
    .map(([title, list]) => `<div class="access-section"><h4>${title}</h4><div class="service-chips">${list.map(chip).join("")}</div></div>`).join("");
  const interpreted = [...raw.offers, ...(raw.audiences || []), ...(raw.access_tags || [])].some(x => x.interpreted);
  return `<section class="detail-section"><h3>Cosa offre</h3>${groups}${tags}<p class="source-note">${interpreted ? "* Ricavato dal testo della fonte: interpretazione da verificare. " : ""}Passa sopra un'etichetta per vedere da dove viene.</p></section>`;
}

function categoryCaption(value) {
  // Sentence case: taxonomy labels are written as phrases ("Vestiti e coperte").
  const text = String(value || "Servizio").replaceAll("_", " ");
  return text.charAt(0).toLocaleUpperCase("it") + text.slice(1);
}

function categoryBadge(category) {
  const c=category || {};
  const url=normalizeCategoryIconPath(c.icon_path);
  return `<span class="category-badge" style="background:${escapeHtml(c.color || "#555")}">${url?`<img src="${escapeHtml(url)}" alt="">`:""}<span>${escapeHtml(categoryCaption(c.label || c.slug))}</span></span>`;
}

function sourceOpeningStatus(display, now = new Date()) {
  // Calculated from source intervals in Rome time, without asserting completeness.
  const unknown={kind:"unknown",label:"Orario non disponibile",note:display?.opening_note || "Orari Helpinet non revisionati · fuso Europe/Rome"};
  if (!display?.days || !Number.isFinite(now.getTime())) return unknown;
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Rome",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).map(p=>[p.type,p.value]));
  const dayIndex=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(parts.weekday);
  const keys=["lun","mar","mer","gio","ven","sab","dom"];
  const day=display.days.find(d=>d.day===keys[dayIndex]);
  const minute=Number(parts.hour)*60+Number(parts.minute);
  const intervals=day?.intervals || [];
  if (day?.issues?.length || intervals.some(i=>i.review_note)) return {...unknown,label:"Orari da verificare"};
  // An interval ending before it starts crosses midnight (night shelters); 23:59 closes the day.
  const span=i=>{const a=parseClockMinutes(i.opens_raw);let b=parseClockMinutes(i.closes_raw);if(a===null||b===null)return null;if(b===1439)b=1440;return b>a?{today:[a,b]}:b<a?{today:[a,1440],next:[0,b]}:null;};
  const spans=intervals.map(span);
  if (spans.some(x=>x===null)) return {...unknown,label:"Orari da verificare"};
  const yesterday=display.days.find(d=>d.day===keys[(dayIndex+6)%7]);
  const carried=yesterday?.issues?.length ? [] : (yesterday?.intervals || []).map(span).filter(x=>x?.next).map(x=>x.next);
  const ranges=[...spans.map(x=>x.today),...carried].sort((a,b)=>a[0]-b[0]);
  // Merge overlapping or adjacent intervals before finding the closing boundary.
  const merged=[];
  ranges.forEach(([a,b])=>{const last=merged[merged.length-1];if(last && a<=last[1]) last[1]=Math.max(last[1],b);else merged.push([a,b]);});
  const active=merged.find(([a,b])=>a<=minute && minute<b);
  if (active && active[1]===1440) return {kind:"open",label:"Aperto ora",note:unknown.note};  // continues past midnight
  if (active) {
    const remaining=active[1]-minute;
    return {kind:remaining<=60 ? "closing" : "open",label:remaining<=60?`Aperto ora · chiude alle ${String(Math.floor(active[1]/60)).padStart(2,"0")}:${String(active[1]%60).padStart(2,"0")}`:"Aperto ora",note:unknown.note};
  }
  const upcoming=merged.find(([a])=>a>minute);
  if (upcoming) return {kind:"closed",label:`Chiuso ora · apre oggi alle ${String(Math.floor(upcoming[0]/60)).padStart(2,"0")}:${String(upcoming[0]%60).padStart(2,"0")}`,note:unknown.note};
  // A day without declared hours counts as closed when the source declares other days
  // (user decision, 2026-11-15); with no structured hours at all the status stays unknown.
  for (let offset=1;offset<=7;offset++) {
    const candidate=display.days.find(d=>d.day===keys[(dayIndex+offset)%7]);
    if (candidate?.issues?.length) continue;
    const next=(candidate?.intervals || []).filter(i=>!i.review_note && span(i)!==null).sort((a,b)=>a.opens_raw.localeCompare(b.opens_raw))[0];
    if (next) return {kind:"closed",label:`Chiuso ora · apre ${offset===1 ? "domani" : candidate.label.toLowerCase()} alle ${next.opens_raw}`,note:`${unknown.note} · giorni senza orari considerati chiusi`};
  }
  return unknown;
}

function openingBadge(poi, now = new Date()) {
  const status=sourceOpeningStatus(poi.raw?.hours_display,now);
  return `<span class="source-opening ${status.kind}" data-opening-service="${escapeHtml(poi.id)}"><strong>${escapeHtml(status.label)}</strong><small>${escapeHtml(status.note)}</small></span>`;
}

function updateOpeningBadges() {
  // Filter membership must change at opening/closing boundaries as well as labels.
  if (state.filters.openNow) refresh();
  document.querySelectorAll("[data-opening-service]").forEach(el=>{
    const poi=state.pois.find(p=>String(p.id)===el.dataset.openingService);
    if (!poi) return;
    const status=sourceOpeningStatus(poi.raw?.hours_display);
    el.className=`${el.classList.contains("service-status") ? "service-status" : "source-opening"} ${status.kind}`;
    el.querySelector("strong").textContent=status.label;
    el.querySelector("small").textContent=status.note;
  });
}
