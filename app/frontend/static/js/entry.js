const API_BASE = window.EGI_API_BASE || "/api/preview";
const state = {
  step: 1,
  cycleIdx: 0,
  lang: "it",
  cityId: null,
  languages: [],
  cities: [],
  detectedPosition: null,
};

const LANG_CYCLE_ORDER = ["it", "en", "ar", "fr"];

const elements = {
  html: document.documentElement,
  stepNum: document.getElementById("step-num"),
  langTitleWrap: document.querySelector("#step-1 .step-title"),
  langTitleCycler: document.getElementById("lang-title-cycler"),
  langSubtitle: document.getElementById("lang-subtitle"),
  langList: document.getElementById("lang-list"),
  cityTitle: document.getElementById("city-title"),
  citySubtitle: document.getElementById("city-subtitle"),
  cityList: document.getElementById("city-list"),
  geoStatus: document.getElementById("geo-status"),
  ctaLabel: document.getElementById("cta-label"),
  ctaIcon: document.getElementById("cta-icon"),
  backButton: document.getElementById("back-button"),
  secondaryActions: document.getElementById("secondary-actions"),
  footerPrivacy: document.getElementById("footer-privacy"),
};

let cycleInterval = null;
let cycleLocked = false;

bootstrap();

async function bootstrap() {
  try {
    bindUi();
    await Promise.all([loadLanguages(), loadCities()]);
    preselectLanguage();
    await applyLanguage(state.lang);
    renderLanguages();
    await preselectCity();
    renderCities();
    updateStep();
    startCycler();
  } catch (error) {
    await applyLanguage(state.lang);
    elements.langList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    elements.cityList.innerHTML = "";
    elements.geoStatus.textContent = error.message;
    updateStep();
  }
}

function bindUi() {
  document.getElementById("cta-primary").addEventListener("click", onPrimaryClick);
  elements.backButton.addEventListener("click", () => goToStep(1));
}

async function loadLanguages() {
  const response = await fetch(`${API_BASE}/languages`);
  const languages = await readJson(response, "lingue");
  state.languages = languages.map((language) => ({
    id: language.id,
    code: language.code.toLowerCase(),
    native: language.name_native,
    en: language.name_english,
    rtl: language.direction === "rtl",
    isDefault: language.code.toLowerCase() === "it",
  }));
}

async function loadCities() {
  const response = await fetch(`${API_BASE}/areas`);
  const cities = await readJson(response, "città");
  state.cities = cities.map(normalizeArea);
}

function preselectLanguage() {
  const candidates = browserLanguageCandidates();
  const fallback = state.languages.find((item) => item.isDefault) || state.languages[0];
  const selected =
    state.languages.find((item) => candidates.includes(item.code.toLowerCase())) || fallback;
  if (selected) state.lang = selected.code;
}

async function applyLanguage(lang) {
  state.lang = lang;
  await window.EGI_I18N.setLanguage(lang);
  window.EGI_I18N.translatePage();
  const rtl = state.lang === "ar";
  elements.html.dir = rtl ? "rtl" : "ltr";
  setCyclerText(t("entry.language_title"), rtl);
  elements.langSubtitle.textContent = t("entry.language_subtitle");
  elements.cityTitle.textContent = t("entry.city_title");
  elements.citySubtitle.textContent = t("entry.city_subtitle");
  elements.backButton.textContent = t("common.back");
  elements.footerPrivacy.textContent = t("common.privacy_note");
  if (selectedCity()) {
    elements.geoStatus.textContent = t("entry.geo_matched", { city: selectedCity().name });
  } else {
    elements.geoStatus.textContent = t("entry.geo_searching");
  }
}

async function preselectCity() {
  const fallback=state.cities.find(item=>item.isDefault)||state.cities[0]||null;
  if (fallback) state.cityId=fallback.id;
  elements.geoStatus.textContent="Puoi scegliere una posizione di riferimento nella mappa.";
}

function renderLanguages() {
  elements.langList.innerHTML = "";
  state.languages.forEach((language) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lang-item lang-${language.code}${language.rtl ? " rtl" : ""}${state.lang === language.code ? " selected" : ""}`;
    button.innerHTML = `
      <div class="left">
        <span class="native">${escapeHtml(language.native)}${language.isDefault ? ` <span class="default-tag">${escapeHtml(t("entry.default_tag"))}</span>` : ""}</span>
        <span class="english">${escapeHtml(language.en)}</span>
      </div>
      <span class="check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
    `;
    button.addEventListener("click", async () => {
      state.lang = language.code;  // an explicit choice stops the title cycler, which switches languages globally
      await freezeCyclerOnSelectedLanguage();
    });
    elements.langList.append(button);
  });
}

function renderCities() {
  elements.cityList.innerHTML = "";
  state.cities.forEach((city) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `city-item${state.cityId === city.id ? " selected" : ""}`;
    button.innerHTML = `
      <div class="left">
        <div class="city-name">${escapeHtml(city.name)}${city.isDefault ? ` <span class="default-tag">${escapeHtml(t("entry.default_tag"))}</span>` : ""}</div>
        <div class="city-meta">${escapeHtml(city.countryCode)}</div>
      </div>
      <span class="check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
    `;
    button.addEventListener("click", () => {
      state.cityId = city.id;
      if (state.step === 2) {
        enterApp();
        return;
      }
      renderCities();
    });
    elements.cityList.append(button);
  });
}

// The cycle step in flight, so freezing waits for it instead of racing it: a step that
// finished after the freeze used to leave the title (and translations) in another language.
let cycleTask = null;

function startCycler() {
  cycleInterval = window.setInterval(() => {
    if (cycleLocked || cycleTask) return;
    cycleTask = (async () => {
      state.cycleIdx = (state.cycleIdx + 1) % LANG_CYCLE_ORDER.length;
      const code = LANG_CYCLE_ORDER[state.cycleIdx];
      await window.EGI_I18N.setLanguage(code);
      if (cycleLocked) return;
      transitionCycler(t("entry.language_title"), code === "ar");
      elements.langSubtitle.textContent = t("entry.language_subtitle");
    })().finally(() => { cycleTask = null; });
  }, 2400);
}

function transitionCycler(text, rtl) {
  elements.langTitleWrap.classList.add("cycling");
  window.setTimeout(() => {
    elements.langTitleWrap.classList.remove("cycling");
    if (!cycleLocked) setCyclerText(text, rtl);
  }, 200);
}

function setCyclerText(text, rtl) {
  elements.langTitleCycler.textContent = text;
  elements.langTitleCycler.style.direction = rtl ? "rtl" : "ltr";
}

async function onPrimaryClick() {
  if (state.step === 1) {
    await freezeCyclerOnSelectedLanguage();
    goToStep(2);
  } else {
    enterApp();
  }
}

function goToStep(step) {
  state.step = Math.max(1, Math.min(2, step));
  document.querySelectorAll(".step").forEach((element) => element.classList.remove("active", "exit"));
  if (state.step === 1) {
    document.getElementById("step-1").classList.add("active");
  } else {
    document.getElementById("step-2").classList.add("active");
    document.getElementById("step-1").classList.add("exit");
  }
  updateStep();
}

function updateStep() {
  elements.stepNum.textContent = t("entry.step_of", { current: state.step, total: 2 });
  document.querySelectorAll(".pip").forEach((pip) => {
    const idx = Number(pip.dataset.pip);
    pip.classList.toggle("active", idx <= state.step);
  });
  elements.secondaryActions.style.display = state.step === 1 ? "none" : "flex";
  elements.ctaLabel.textContent = state.step === 1 ? t("common.next") : t("entry.open_map");
  elements.ctaIcon.innerHTML =
    state.step === 1
      ? `<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>`
      : `<polyline points="9 18 15 12 9 6"></polyline>`;
}

async function freezeCyclerOnSelectedLanguage() {
  cycleLocked = true;
  if (cycleInterval) {
    window.clearInterval(cycleInterval);
    cycleInterval = null;
  }
  if (cycleTask) await cycleTask;
  await applyLanguage(state.lang);
  renderLanguages();
  renderCities();
  updateStep();
}

function enterApp() {
  const city = selectedCity();
  if (!city) return;
  const url = new URL("/map", window.location.origin);
  url.searchParams.set("city_id", String(city.id));
  url.searchParams.set("lang", state.lang);
  if (isDetectedPositionUsableForCity(city)) {
    url.searchParams.set("user_lat", formatCoordinate(state.detectedPosition.lat));
    url.searchParams.set("user_lng", formatCoordinate(state.detectedPosition.lng));
  }
  window.location.href = url.toString();
}

function isDetectedPositionUsableForCity(city) {
  const position = state.detectedPosition;
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    return false;
  }
  if (
    Number.isFinite(city.bboxSouth) &&
    Number.isFinite(city.bboxNorth) &&
    Number.isFinite(city.bboxWest) &&
    Number.isFinite(city.bboxEast)
  ) {
    return (
      position.lat >= city.bboxSouth &&
      position.lat <= city.bboxNorth &&
      position.lng >= city.bboxWest &&
      position.lng <= city.bboxEast
    );
  }
  return true;
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function selectedCity() {
  return state.cities.find((item) => item.id === state.cityId) || null;
}

function t(key, params = {}, fallback = "") {
  return window.EGI_I18N.t(key, params, fallback);
}

function findNearestCity(latitude, longitude) {
  const containing = state.cities.find(
    (city) =>
      Number.isFinite(city.bboxSouth) &&
      Number.isFinite(city.bboxNorth) &&
      Number.isFinite(city.bboxWest) &&
      Number.isFinite(city.bboxEast) &&
      latitude >= city.bboxSouth &&
      latitude <= city.bboxNorth &&
      longitude >= city.bboxWest &&
      longitude <= city.bboxEast
  );
  if (containing) return containing;
  return state.cities
    .filter((city) => Number.isFinite(city.centerLat) && Number.isFinite(city.centerLng))
    .map((city) => ({
      city,
      distance: distanceKm({ lat: latitude, lng: longitude }, { lat: city.centerLat, lng: city.centerLng }),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.city || null;
}

function distanceKm(a, b) {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function browserLanguageCandidates() {
  const fromNavigator = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language || "it"];
  return fromNavigator
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .flatMap((value) => [value, value.split("-")[0]]);
}

async function readJson(response, label) {
  if (response.ok) return response.json();
  let detail = response.statusText;
  try {
    const payload = await response.json();
    detail = payload.detail?.message || payload.detail || detail;
  } catch (_error) {
    // Keep the HTTP status text when the body is not JSON.
  }
  throw new Error(`Errore caricando ${label}: ${detail}`);
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
