/** Page controls, sheets, language settings and focus. */
import { refreshCategoriesForLanguage } from "./map-data.js";
import { refresh, renderFilters, renderSearchOptions, resetFilters } from "./map-filters.js";
import { chooseReferencePoint, geocodeAddress, loadOriginTransit, locateUser } from "./map-origin.js";
import { backdrop, cityLabel, cityValue, langValue, listView, locStatus, runtime, settingsBackHead, stage, state, toast, viewToggle, viewToggleLabel } from "./map-state.js";
import { escapeHtml, normalizeLang, t } from "./map-utils.js";

export function bindUi() {
  document.getElementById("open-now-filter").addEventListener("change",event=>{state.filters.openNow=event.target.checked; refresh();}, {signal: runtime.lifecycle?.signal});
  document.getElementById("service-query").addEventListener("input",event=>{state.filters.q=event.target.value; refresh();}, {signal: runtime.lifecycle?.signal});
  for (const [id,key] of [["source-filter","source"],["issue-filter","issue"],["access-filter","access"],["audience-filter","audience"],["section-filter","section"],["sort-services","order"]]) {
    document.getElementById(id).addEventListener("change",event=>{
      state.filters[key]=event.target.value;
      if (key==="source") renderSearchOptions();
      if (key==="order" && event.target.value==="distance" && !state.userLoc) openSheet("sheet-location");
      refresh();
    }, {signal: runtime.lifecycle?.signal});
  }
  document.getElementById("pick-reference").addEventListener("click",chooseReferencePoint, {signal: runtime.lifecycle?.signal});
  document.getElementById("pick-reference-location").addEventListener("click",chooseReferencePoint, {signal: runtime.lifecycle?.signal});
  document.getElementById("address-search-form").addEventListener("submit", event => {
    event.preventDefault();
    void geocodeAddress(document.getElementById("addr-input").value.trim());
  }, {signal: runtime.lifecycle?.signal});
  document.getElementById("open-emergency").addEventListener("click", () => openSheet("sheet-sos"), {signal: runtime.lifecycle?.signal});
  document.getElementById("sos-directory")?.addEventListener("click", () => document.getElementById("open-directory").click(), {signal: runtime.lifecycle?.signal});
  document.getElementById("open-directory").addEventListener("click", () => {
    state.filters.section="directory";
    state.filters.q=""; state.filters.source=""; state.filters.issue=""; state.filters.access=""; state.filters.audience=""; state.filters.meal=""; state.filters.level="";
    state.filters.openNow=false; state.filters.cats=new Set(); state.filters.offersOff=new Set();
    document.getElementById("section-filter").value="directory";
    document.getElementById("service-query").value="";
    document.getElementById("open-now-filter").checked=false;
    renderFilters(); closeSheets();
    if (state.view!=="list") toggleView();
    refresh();
  }, {signal: runtime.lifecycle?.signal});
  document.getElementById("origin-transit").addEventListener("toggle", event => {
    if (event.target.open) void loadOriginTransit();
  }, {signal: runtime.lifecycle?.signal});
  document.addEventListener("keydown", event => {
    if (event.key==="Escape") closeSheets();
    if (event.key!=="Tab") return;
    const sheet=document.querySelector(".sheet.shown");
    if (!sheet) return;
    const controls=[...sheet.querySelectorAll('button,input,select,a[href],summary,[tabindex="0"]')].filter(el=>el.getClientRects().length && !el.disabled);
    const first=controls[0], last=controls.at(-1);
    if (event.shiftKey && (document.activeElement===first || !sheet.contains(document.activeElement))) {event.preventDefault();last?.focus();}
    else if (!event.shiftKey && (document.activeElement===last || !sheet.contains(document.activeElement))) {event.preventDefault();first?.focus();}
  }, {signal: runtime.lifecycle?.signal});
  document.getElementById("clear-reference").addEventListener("click",()=>{
    state.userLoc=null; state.choosingReference=false; state.filters.order="name";
    document.getElementById("sort-services").value="name";
    document.getElementById("reference-status").textContent="Scegli una posizione per ordinare per distanza";
    if (runtime.userMarker) {runtime.userMarker.remove();runtime.userMarker=null;}
    locStatus.className="loc-status";locStatus.textContent="Nessun riferimento scelto";
    document.getElementById("origin-transit-body").textContent="Scegli una posizione per vedere fermate e partenze vicine.";
    runtime.originRequest?.abort();
    refresh();
  }, {signal: runtime.lifecycle?.signal});
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => openSheet(`sheet-${button.dataset.sheet}`), {signal: runtime.lifecycle?.signal});
  });
  document.querySelectorAll("[data-sheet-open]").forEach((button) => {
    button.addEventListener("click", () => openSheet(`sheet-${button.dataset.sheetOpen}`), {signal: runtime.lifecycle?.signal});
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", closeSheets, {signal: runtime.lifecycle?.signal});
  });
  backdrop.addEventListener("click", closeSheets, {signal: runtime.lifecycle?.signal});

  viewToggle.addEventListener("click", toggleView, {signal: runtime.lifecycle?.signal});
  updateViewToggle();
  document.getElementById("reset-filters").addEventListener("click", resetFilters, {signal: runtime.lifecycle?.signal});
  document.getElementById("filters-search").addEventListener("click", () => {
    closeSheets();
    if (state.view !== "map") toggleView();
  }, {signal: runtime.lifecycle?.signal});
  document.getElementById("geo-btn").addEventListener("click", locateUser, {signal: runtime.lifecycle?.signal});
  document.querySelectorAll("[data-sub]").forEach((row) => {
    row.addEventListener("click", () => showSettingsPage(row.dataset.sub), {signal: runtime.lifecycle?.signal});
  });
  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showSettingsPage("main"), {signal: runtime.lifecycle?.signal});
  });
  settingsBackHead?.addEventListener("click", () => showSettingsPage("main"), {signal: runtime.lifecycle?.signal});
}

export function openSheet(id) {
  runtime.sheetReturnFocus = document.activeElement;
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

export function closeSheets() {
  document.querySelectorAll(".sheet").forEach((sheet) => sheet.classList.remove("shown"));
  backdrop.classList.remove("shown");
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.remove("active"));
  showSettingsPage("main");
  runtime.sheetReturnFocus?.focus?.();
}

export function toggleView() {
  state.view = state.view === "map" ? "list" : "map";
  listView.classList.toggle("shown", state.view === "list");
  stage.classList.toggle("list-mode", state.view === "list");
  updateViewToggle();
  syncFilterLayout();
  closeSheets();
  if (state.view === "map") requestAnimationFrame(() => runtime.map.invalidateSize());
}

export function syncFilterLayout() {
  // One filter tree for map and list; the list toolbar opens the same sheet.
  document.getElementById("filter-sheet-host").appendChild(document.getElementById("filter-controls"));
}

export function updateViewToggle() {
  const showMapAction = state.view === "list";
  viewToggle.classList.toggle("is-map", state.view === "map");
  viewToggle.classList.toggle("is-list", state.view === "list");
  viewToggle.setAttribute("aria-pressed", String(state.view === "list"));
  viewToggleLabel.textContent = showMapAction ? t("map.map_view") : t("map.list");
}

/** "Azzera filtri": back to every service, as when the map opens (filters r4). The source
 * selector is a debugging aid kept across resets (user, 2026-11-16; removed in the final app). */

export function renderLanguageList() {
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
    }, {signal: runtime.lifecycle?.signal});
    wrap.append(button);
  });
}

export function renderCityList() {
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

export function renderSettings() {
  cityLabel.textContent = state.city;
  cityValue.textContent = state.city;
  langValue.textContent = state.lang.toUpperCase();
}

export function applyShellTranslations() {
  window.EGI_I18N.translatePage();
  document.title = `EGI — ${state.city}`;
  viewToggle.setAttribute("aria-label", t("map.change_view"));
  viewToggleLabel.textContent = state.view === "list" ? t("map.map_view") : t("map.list");

  if (!state.userLoc) {
    locStatus.className = "loc-status";
    locStatus.innerHTML = `<span class="label">${escapeHtml(t("map.position"))}</span>${escapeHtml(t("map.no_position_set"))}`;
  }
}

export function showSettingsPage(name) {
  document.getElementById("settings-main").style.display = name === "main" ? "block" : "none";
  document.getElementById("sub-language").classList.toggle("shown", name === "language");
  document.getElementById("sub-city").classList.toggle("shown", name === "city");
  settingsBackHead?.classList.toggle("hidden", name === "main");
}

export function showToast(message) {
  toast.textContent = message;
  toast.classList.add("shown");
  window.clearTimeout(showToast._timeout);
  showToast._timeout = window.setTimeout(() => {
    toast.classList.remove("shown");
  }, 1800);
}
