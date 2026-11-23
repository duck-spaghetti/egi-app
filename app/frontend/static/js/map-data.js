/** Public requests, payload adapters and snapshot refresh. */
import { refresh, renderCatGrid } from "./map-filters.js";
import { updateOpeningBadges } from "./map-hours.js";
import { managedFetch } from "./map-network.js";
import { applyShellTranslations, closeSheets, renderLanguageList, renderSettings, showToast } from "./map-shell.js";
import { DEBUG_MODE, context, runtime, state } from "./map-state.js";
import { loadTransitSummaries } from "./map-transit.js";
import { normalizeLang, t } from "./map-utils.js";

export async function loadData() {
  const [
    categoriesResponse,
    services,
    languagesResponse,
    citiesResponse,
    translationsResponse,
  ] = await Promise.all([
    managedFetch(`${context.apiBase || "/api/preview"}/categories?sort_by=sort_order&sort_order=asc&limit=1000`),
    fetchPublicServices(),
    managedFetch(`${context.apiBase || "/api/preview"}/languages`),
    managedFetch(`${context.apiBase || "/api/preview"}/areas`),
    managedFetch(`${context.apiBase || "/api/preview"}/category-translations?limit=1000`),
  ]);
  try { state.taxonomy = await readJson(await managedFetch(`${context.apiBase || "/api/preview"}/taxonomy`), "tassonomia"); } catch (_e) { /* paths and labels optional */ }

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
  if (context.localLayers !== false) {
    void loadTransitSummaries();
    runtime.lifecycle.every(loadTransitSummaries,300000);
  }
  state.filters.cats = new Set();  // filters r4: nothing selected = every service
}

export async function readJson(response, label) {
  if (response.ok) {
    return response.json();
  }

  throw new Error(`Errore caricando ${label}: ${response.status}`);
}

export async function fetchPublicServices() {
  const params = new URLSearchParams({
    area_id: String(context.cityId),
    language: normalizeLang(state.lang),
    // The backend maximum: 2,000 silently dropped services once the guide chapters were loaded
    // (2,038 placed on 2026-11-09). Pagination is open work if the catalogue nears 5,000.
    limit: "5000",
  });
  // Services without a map point are hidden; the review view (?debug=1) still lists them.
  if (DEBUG_MODE) params.set("include_unplaced", "true");
  const response = await managedFetch(`${context.apiBase || "/api/preview"}/services?${params.toString()}`);
  return readJson(response, "servizi");
}

export async function refreshCategoriesForLanguage() {
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

export function normalizeExternalHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(raw)) return `https://${raw}`;
  return null;
}

export function normalizePublicService(service) {
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

export function mergeServiceCategories(categories, services) {
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

export function normalizeEmbeddedCategory(category) {
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

export function composePois(services, places) {
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

export function normalizeArea(area) {
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

export function normalizeCategory(category) {
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

export function applyCategoryLabels(categories) {
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

export function pointLatLng(geojson) {
  if (!geojson || geojson.type !== "Point" || !Array.isArray(geojson.coordinates)) {
    return { lat: null, lng: null };
  }
  const [lng, lat] = geojson.coordinates;
  return { lat: Number(lat), lng: Number(lng) };
}

export function bboxFromPolygon(geojson) {
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

export function categoryColor(slug) {
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

export function normalizeCategoryIconPath(iconPath) {
  const raw = String(iconPath || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^\/+/, "");
  if (!cleaned.endsWith(".svg")) return null;
  if (/^static\/assets\/icons\/[a-zA-Z0-9_ /-]+\.svg$/.test(cleaned)) return `/${cleaned}`;
  if (cleaned.startsWith("icons/")) return `/static/assets/${cleaned}`;
  if (cleaned.startsWith("assets/icons/")) return `/static/${cleaned}`;
  return null;
}

export async function refreshCanonicalOpening() {
  if (runtime.canonicalRefreshInFlight) return;
  runtime.canonicalRefreshInFlight=true;
  try {
    const services=await fetchPublicServices();
    state.pois=services.map(normalizePublicService).filter(Boolean);
    refresh();
    updateOpeningBadges();
  } catch (_error) {
    // Keep visible content. Expired opening results become unknown, never freshly open.
  } finally {
    runtime.canonicalRefreshInFlight=false;
  }
}

/** Unknown canonical weekdays stay unknown, including a partially declared week. */
