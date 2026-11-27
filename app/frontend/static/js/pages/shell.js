import {normalizeLang} from "../format.js";
import {escapeHtml} from "../format.js";
/** createShell owns its behavior; dependencies and snapshots are explicit. */
export function createShell({state,scope,i18n,actions,emit}) {
let sheetReturnFocus=null;
const backdrop=document.getElementById("backdrop");
const stage=document.getElementById("stage");
const listView=document.getElementById("list-view");
const viewToggle=document.getElementById("view-toggle");
const viewToggleLabel=document.getElementById("view-toggle-label");
const cityLabel=document.getElementById("city-label");
const cityValue=document.getElementById("city-value");
const langValue=document.getElementById("lang-value");
const locStatus=document.getElementById("loc-status");
const suggestions=document.getElementById("suggestions");
const toast=document.getElementById("toast");
const settingsBackHead=document.getElementById("settings-back-head");
const t=i18n.t;
const {refresh,renderFilters,renderSearchOptions,resetFilters,chooseReferencePoint,geocodeAddress,loadOriginTransit,locateUser}=actions;

function bindUi() {
  document.getElementById("open-now-filter").addEventListener("change",event=>{state.filters.openNow=event.target.checked; refresh();}, {signal: scope.signal});
  document.getElementById("service-query").addEventListener("input",event=>{state.filters.q=event.target.value; refresh();}, {signal: scope.signal});
  for (const [id,key] of [["source-filter","source"],["issue-filter","issue"],["access-filter","access"],["audience-filter","audience"],["section-filter","section"],["sort-services","order"]]) {
    document.getElementById(id).addEventListener("change",event=>{
      state.filters[key]=event.target.value;
      if (key==="source") renderSearchOptions();
      if (key==="order" && event.target.value==="distance" && !state.userLoc) openSheet("sheet-location");
      refresh();
    }, {signal: scope.signal});
  }
  document.getElementById("pick-reference").addEventListener("click",chooseReferencePoint, {signal: scope.signal});
  document.getElementById("pick-reference-location").addEventListener("click",chooseReferencePoint, {signal: scope.signal});
  document.getElementById("address-search-form").addEventListener("submit", event => {
    event.preventDefault();
    void geocodeAddress(document.getElementById("addr-input").value.trim());
  }, {signal: scope.signal});
  document.getElementById("open-emergency").addEventListener("click", () => openSheet("sheet-sos"), {signal: scope.signal});
  document.getElementById("sos-directory")?.addEventListener("click", () => document.getElementById("open-directory").click(), {signal: scope.signal});
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
  }, {signal: scope.signal});
  document.getElementById("origin-transit").addEventListener("toggle", event => {
    if (event.target.open) void loadOriginTransit();
  }, {signal: scope.signal});
  document.addEventListener("keydown", event => {
    if (event.key==="Escape") dismissSheets();
    if (event.key!=="Tab") return;
    const sheet=document.querySelector(".sheet.shown");
    if (!sheet) return;
    const controls=[...sheet.querySelectorAll('button,input,select,a[href],summary,[tabindex="0"]')].filter(el=>el.getClientRects().length && !el.disabled);
    const first=controls[0], last=controls.at(-1);
    if (event.shiftKey && (document.activeElement===first || !sheet.contains(document.activeElement))) {event.preventDefault();last?.focus();}
    else if (!event.shiftKey && (document.activeElement===last || !sheet.contains(document.activeElement))) {event.preventDefault();first?.focus();}
  }, {signal: scope.signal});
  document.getElementById("clear-reference").addEventListener("click",()=>{
    state.userLoc=null; state.choosingReference=false; state.filters.order="name";
    document.getElementById("sort-services").value="name";
    document.getElementById("reference-status").textContent="Scegli una posizione per ordinare per distanza";
    emit("referenceCleared");
    locStatus.className="loc-status";locStatus.textContent="Nessun riferimento scelto";
    document.getElementById("origin-transit-body").textContent="Scegli una posizione per vedere fermate e partenze vicine.";
    emit("cancelOrigin");
    refresh();
  }, {signal: scope.signal});
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => openSheet(`sheet-${button.dataset.sheet}`), {signal: scope.signal});
  });
  document.querySelectorAll("[data-sheet-open]").forEach((button) => {
    button.addEventListener("click", () => openSheet(`sheet-${button.dataset.sheetOpen}`), {signal: scope.signal});
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", dismissSheets, {signal: scope.signal});
  });
  backdrop.addEventListener("click", dismissSheets, {signal: scope.signal});

  viewToggle.addEventListener("click", ()=>{emit("cancelReference");toggleView();}, {signal: scope.signal});
  updateViewToggle();
  document.getElementById("reset-filters").addEventListener("click", resetFilters, {signal: scope.signal});
  document.getElementById("filters-search").addEventListener("click", () => {
    closeSheets();
    if (state.view !== "map") toggleView();
  }, {signal: scope.signal});
  document.getElementById("geo-btn").addEventListener("click", locateUser, {signal: scope.signal});
  document.querySelectorAll("[data-sub]").forEach((row) => {
    row.addEventListener("click", () => showSettingsPage(row.dataset.sub), {signal: scope.signal});
  });
  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showSettingsPage("main"), {signal: scope.signal});
  });
  settingsBackHead?.addEventListener("click", () => showSettingsPage("main"), {signal: scope.signal});
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

/** User dismissal abandons reference selection; programmatic sheet changes keep it. */
function dismissSheets() {emit('cancelReference');closeSheets();}

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
  emit("refresh");
  if (state.view === "map") requestAnimationFrame(() => emit("invalidateMap"));
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

/** "Azzera filtri": back to every service, as when the map opens (filters r4). The source
 * selector is a debugging aid kept across resets (user, 2026-11-16; removed in the final app). */

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
      emit("language",{language:code});
    }, {signal: scope.signal});
    wrap.append(button);
  });
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
  i18n.translatePage();
  document.title = `EGI — ${state.city}`;
  viewToggle.setAttribute("aria-label", t("map.change_view"));
  viewToggleLabel.textContent = state.view === "list" ? t("map.map_view") : t("map.list");

  if (!state.userLoc) {
    locStatus.className = "loc-status";
    locStatus.innerHTML = `<span class="label">${escapeHtml(t("map.position"))}</span>${escapeHtml(t("map.no_position_set"))}`;
  }
}

function showSettingsPage(name) {
  document.getElementById("settings-main").style.display = name === "main" ? "block" : "none";
  document.getElementById("sub-language").classList.toggle("shown", name === "language");
  document.getElementById("sub-city").classList.toggle("shown", name === "city");
  settingsBackHead?.classList.toggle("hidden", name === "main");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("shown");
  clearTimeout(showToast._timeout);
  showToast._timeout = scope.later(() => {
    toast.classList.remove("shown");
  }, 1800);
}

return {bind:bindUi,open:openSheet,close:closeSheets,toggle:toggleView,layout:syncFilterLayout,update:renderSettings,translate:applyShellTranslations,languages:renderLanguageList,cities:renderCityList,toast:showToast};
}
