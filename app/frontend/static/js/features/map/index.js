import {siteMarkers,PIN_SIZE,PIN_ANCHOR,USER_DOT_HTML,USER_DOT_SIZE,USER_DOT_LABEL} from "./pins.js";
/** createMap owns its behavior; dependencies and snapshots are explicit. */
export function createMap({context,sites,describe,emit,leaflet=L}) {
const L=leaflet;
let state={};const runtime={map:null,markersLayer:null,cityBounds:null,userMarker:null};
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
  siteMarkers(list,{sites,describe}).forEach(site => {
    const marker=L.marker([site.lat,site.lng],{icon:L.divIcon({className:"",html:site.html,iconSize:PIN_SIZE,iconAnchor:PIN_ANCHOR}),alt:site.label,title:site.label});
    marker.on("click",()=>emit("choose",site.choose()));
    runtime.markersLayer.addLayer(marker);
  });
  if (runtime.userMarker) {runtime.userMarker.remove();runtime.userMarker=null;}
  if (state.userLoc) runtime.userMarker=L.marker([state.userLoc.lat,state.userLoc.lng],{icon:L.divIcon({className:"",html:USER_DOT_HTML,iconSize:USER_DOT_SIZE,iconAnchor:[9,9]}),alt:USER_DOT_LABEL}).addTo(runtime.map);
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
