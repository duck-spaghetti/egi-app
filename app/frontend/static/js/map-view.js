/** Leaflet map, exact-position grouping and marker projection. */
import { normalizeCategoryIconPath } from "./map-data.js";
import { markerFallbackLabel, openDetail, openServiceChooser } from "./map-details.js";
import { resolveCategory } from "./map-filters.js";
import { setUserLocation } from "./map-origin.js";
import { DEBUG_MODE, context, runtime, state } from "./map-state.js";
import { categoryCaption, escapeHtml } from "./map-utils.js";

export function initMap() {
  runtime.cityBounds = L.latLngBounds(
    [Number(context.boundsSouth), Number(context.boundsWest)],
    [Number(context.boundsNorth), Number(context.boundsEast)]
  );
  const cityCenter = [Number(context.latitude), Number(context.longitude)];

  runtime.map = L.map("map", {
    zoomControl: false,
    attributionControl: true,
    maxBounds: runtime.cityBounds,
    maxBoundsViscosity: 1,
    worldCopyJump: false,
  }).setView(cityCenter, Number(context.zoom));
  runtime.map.attributionControl.setPrefix(false);

  L.tileLayer(context.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    noWrap: true,
  }).addTo(runtime.map);

  if (typeof L.markerClusterGroup === "function") {
    runtime.markersLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 17,
      maxClusterRadius: 42,
    });
  } else {
    runtime.markersLayer = L.layerGroup();
  }
  runtime.markersLayer.addTo(runtime.map);
  runtime.map.setView(cityCenter, Number(context.zoom));
  const minCityZoom = runtime.map.getBoundsZoom(runtime.cityBounds, true, [18, 18]);
  runtime.map.setMinZoom(Math.max(9, minCityZoom));
  runtime.map.on("resize", () => runtime.map.setMinZoom(Math.max(9, runtime.map.getBoundsZoom(runtime.cityBounds, true, [18,18]))));
  runtime.map.setMaxBounds(runtime.cityBounds);
  runtime.map.panInsideBounds(runtime.cityBounds, { animate: false });
  if (context.localLayers !== false) runtime.cycle = CycleLayer.create(runtime.map, {
    toggle: document.getElementById("cycle-toggle"),
    status: document.getElementById("cycle-status"),
  });
  if (context.localLayers !== false) runtime.transport = TransportLayer.create(runtime.map, {
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
  if (!context.canonical && DEBUG_MODE && typeof DebugSources !== "undefined") {
    DebugSources.create(runtime.map, {
      setServicesVisible: visible => visible ? runtime.map.addLayer(runtime.markersLayer) : runtime.map.removeLayer(runtime.markersLayer),
      openDetail: id => openDetail(id),
    });
  }
  runtime.map.on("click", event=>{
    if (!state.choosingReference) return;
    state.choosingReference=false;
    setUserLocation(event.latlng.lat,event.latlng.lng,"Punto scelto sulla mappa");
  });
}

export function sourceSiteKey(poi) {
  if (!Number.isFinite(poi.latitude) || !Number.isFinite(poi.longitude) || poi.raw?.placement?.section === "directory") return null;
  if (context.canonical) return `point:${poi.latitude}:${poi.longitude}`;
  return [poi.raw?.source_group?.external_key || poi.id,poi.latitude,poi.longitude,poi.raw?.itinerant_source ? "itinerant" : "fixed"].join(":");
}

export function siteGroups(list) {
  // A matching service reveals its source site, including siblings in other categories.
  const keys = new Set(list.map(sourceSiteKey).filter(Boolean));
  const groups = new Map();
  (context.canonical ? list : state.pois).forEach(poi => {
    const key = sourceSiteKey(poi);
    if (!keys.has(key)) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(poi);
  });
  return [...groups.values()];
}

export function renderMarkers(list) {
  runtime.markersLayer.clearLayers();
  if (!runtime.map.hasLayer(runtime.markersLayer)) runtime.markersLayer.addTo(runtime.map);
  const matched = new Set(list.map(p => p.id));
  siteGroups(list).forEach(items => {
    const categories = [...new Map(items.map(p => {const c=resolveCategory(p); return [c?.slug,c];})).values()].filter(Boolean);
    const poi = {...items[0], group_count:items.length, site_categories:categories, site_weights:categories.map(c=>items.filter(item=>resolveCategory(item)?.slug===c.slug).length)};
    const label = `${poi.raw?.facility_name || poi.title}: ${items.length} servizi · ${categories.map(c=>categoryCaption(c.label || c.slug)).join(", ")}`;
    const marker=L.marker([poi.latitude,poi.longitude],{icon:makePin(poi),alt:label,title:label});
    marker.on("click",()=>openServiceChooser(sameSourceGroup(poi),matched));
    runtime.markersLayer.addLayer(marker);
  });
  if (runtime.userMarker) {runtime.userMarker.remove();runtime.userMarker=null;}
  if (state.userLoc) runtime.userMarker=L.marker([state.userLoc.lat,state.userLoc.lng],{icon:userIcon(),alt:"Punto di riferimento scelto"}).addTo(runtime.map);
}

export function makePin(poi) {
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

export function userIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="user-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export function isWithinCityBounds(lat, lng) {
  return runtime.cityBounds ? runtime.cityBounds.contains(L.latLng(lat, lng)) : true;
}

export function sameSourceGroup(poi) {
  if (context.canonical) { const key=sourceSiteKey(poi); return key ? state.pois.filter(p=>sourceSiteKey(p)===key) : [poi]; }
  const id = poi.raw?.source_group?.external_key;
  return id ? state.pois.filter(p=>p.raw?.source_group?.external_key === id) : [poi];
}
