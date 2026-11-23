import {escapeHtml,categoryCaption} from "../../format.js";
/** createMap owns its behavior; dependencies and snapshots are explicit. */
export function createMap({context,sites,describe,emit,leaflet=L}) {
const L=leaflet;
let state={};const runtime={map:null,markersLayer:null,cityBounds:null,userMarker:null};
function iconPath(iconPath) {
  const raw = String(iconPath || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^\/+/, "");
  if (!cleaned.endsWith(".svg")) return null;
  if (/^static\/assets\/icons\/[a-zA-Z0-9_ /-]+\.svg$/.test(cleaned)) return `/${cleaned}`;
  if (cleaned.startsWith("icons/")) return `/static/assets/${cleaned}`;
  if (cleaned.startsWith("assets/icons/")) return `/static/${cleaned}`;
  return null;
}

function initMap() {
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
  runtime.map.on("click", event=>{
    if (!state.choosingReference) return;
    emit("pickedReference",{lat:event.latlng.lat,lng:event.latlng.lng,label:"Punto scelto sulla mappa"});
  });
}

function renderMarkers(list) {
  runtime.markersLayer.clearLayers();
  if (!runtime.map.hasLayer(runtime.markersLayer)) runtime.markersLayer.addTo(runtime.map);
  const matched = new Set(list.map(p => p.id));
  sites.groups(list).forEach(items => {
    const categories = [...new Map(items.map(p => {const c=describe(p).category; return [c?.slug,c];})).values()].filter(Boolean);
    const poi = {...items[0], group_count:items.length, site_categories:categories, site_weights:categories.map(c=>items.filter(item=>describe(item).category?.slug===c.slug).length)};
    const label = `${poi.raw?.facility_name || poi.title}: ${items.length} servizi · ${categories.map(c=>categoryCaption(c.label || c.slug)).join(", ")}`;
    const marker=L.marker([poi.latitude,poi.longitude],{icon:makePin(poi),alt:label,title:label});
    marker.on("click",()=>emit("choose",{items:sites.siblings(poi),matched}));
    runtime.markersLayer.addLayer(marker);
  });
  if (runtime.userMarker) {runtime.userMarker.remove();runtime.userMarker=null;}
  if (state.userLoc) runtime.userMarker=L.marker([state.userLoc.lat,state.userLoc.lng],{icon:userIcon(),alt:"Punto di riferimento scelto"}).addTo(runtime.map);
}

function makePin(poi) {
  const categories = poi.site_categories || [describe(poi).category || {label:poi.category_label,color:poi.category_color,icon_path:poi.category_icon_path}];
  const weights = poi.site_weights || categories.map(()=>1);
  const total = weights.reduce((a,b)=>a+b,0);
  let position=0;
  const colorStops=categories.map((c,i)=>{const start=position; position+=weights[i]/total*100; return `${c.color || "#555"} ${start}% ${position}%`;}).join(",");
  const c=categories[0];
  const icon=iconPath(c.icon_path);
  const content=poi.group_count>1 ? `<span class="site-total">${poi.group_count}</span>` : `<span class="single-pin-icon">${icon ? `<img src="${escapeHtml(icon)}" alt="">` : escapeHtml(String(c.label||c.slug||"•").trim().charAt(0).toUpperCase())}</span>`;
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

function isWithinCityBounds(lat, lng) {
  return runtime.cityBounds ? runtime.cityBounds.contains(L.latLng(lat, lng)) : true;
}

function update(snapshot,list){state=snapshot;if(runtime.map)renderMarkers(list);}
function attach(factory){return factory(runtime.map);}
function center(lat,lng){if(runtime.map && isWithinCityBounds(lat,lng))runtime.map.setView([lat,lng],13);}
function dispose(){runtime.map?.remove();runtime.map=null;runtime.markersLayer=null;runtime.userMarker=null;}

return {mount:initMap,update,attach,center,contains:isWithinCityBounds,invalidate:()=>runtime.map?.invalidateSize(),servicesVisible(visible){if(visible)runtime.map.addLayer(runtime.markersLayer);else runtime.map.removeLayer(runtime.markersLayer);},dispose};
}
