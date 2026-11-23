/** Explicit visitor origin and address-search interactions. */
import { refresh } from "./map-filters.js";
import { managedFetch, post } from "./map-network.js";
import { closeSheets, showToast, toggleView } from "./map-shell.js";
import { context, locStatus, runtime, state } from "./map-state.js";
import { focusOriginLines, transitStopGroup } from "./map-transit.js";
import { escapeHtml, t } from "./map-utils.js";
import { isWithinCityBounds } from "./map-view.js";

export function locateUser() {
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

export function setUserLocation(lat,lng,label) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return showToast("Coordinate non valide");
  if (!isWithinCityBounds(lat,lng)) return showToast(`Scegli un punto nell’area di ${context.cityName}`);
  state.userLoc={lat,lng,label}; state.filters.order="distance";
  document.getElementById("sort-services").value="distance";
  const named = !/^(Punto|Posizione rilevata|Detected)/i.test(label);
  const display = named ? label : `${label} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  document.getElementById("reference-status").textContent=`Distanze in linea d’aria da ${display}`;
  locStatus.className="loc-status ok";
  locStatus.textContent=display;
  document.getElementById("origin-transit-body").textContent="Apri per caricare fermate e partenze dal punto scelto.";
  runtime.originRequest?.abort();
  if (document.getElementById("origin-transit").open) void loadOriginTransit();
  if (isWithinCityBounds(lat,lng)) runtime.map.setView([lat,lng],13);
  closeSheets();refresh();
}

export async function geocodeAddress(address) {
  if (address.length<3) return;
  runtime.addressRequest?.abort();
  const current=new AbortController(); runtime.addressRequest=current;
  const status=document.getElementById("address-search-status");
  const results=document.getElementById("address-results");
  results.replaceChildren(); status.textContent="Cerco indirizzo…";
  try {
    const response=await managedFetch("/api/preview/address-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:address}),signal:current.signal});
    if (!response.ok) throw Error("unavailable");
    const data=await response.json();
    if (current.signal.aborted) return;
    status.textContent=data.results.length ? "Scegli un risultato:" : `Nessun risultato nell’area di ${context.cityName}. Prova un indirizzo più preciso o scegli sulla mappa.`;
    for (const row of data.results) {
      const button=document.createElement("button"); button.type="button"; button.className="address-result"; button.textContent=row.label;
      button.addEventListener("click",()=>{setUserLocation(row.lat,row.lon,row.label); results.replaceChildren(); status.textContent="Indirizzo selezionato.";}, {signal: runtime.lifecycle?.signal});
      results.appendChild(button);
    }
  } catch(error) {
    if (current.signal.aborted) return;
    status.textContent="Ricerca indirizzo non disponibile. Puoi usare la geolocalizzazione o scegliere sulla mappa.";
  }
}

export async function loadOriginTransit() {
  if (!state.userLoc) return;
  runtime.originRequest?.abort();
  const current=new AbortController(); runtime.originRequest=current;
  const origin=state.userLoc;
  const node=document.getElementById("origin-transit-body");
  node.textContent="Carico fermate e partenze vicine…";
  try {
    const response=await post("/api/preview/transit/origin",{lat:origin.lat,lon:origin.lng},current.signal);
    if (!response.ok) throw Error("unavailable");
    const data=await response.json();
    if (current.signal.aborted || state.userLoc!==origin) return;
    const stops=data.stops || [];
    stops.forEach(g=>g.lines.forEach(line=>line.origin=true));
    node.innerHTML=`<p class="source-note">Dal riferimento: ${escapeHtml(origin.label)}. Distanze in linea d’aria; verifica di poter raggiungere la fermata in tempo.</p><ul class="transit-list">${stops.map((g,i)=>transitStopGroup(g,i,data.alerts)).join("")}</ul>${!stops.length ? "Nessuna fermata nei dati disponibili vicino al punto scelto." : ""}<p class="source-note">${TransportLayer.realtimeNote(data)} Aggiornato alle ${escapeHtml(data.now || "—")}.</p><button type="button" data-refresh-origin>Aggiorna partenze</button>`;
    node.querySelector("[data-refresh-origin]")?.addEventListener("click",loadOriginTransit, {signal: runtime.lifecycle?.signal});
    node.querySelectorAll("[data-focus-route]").forEach(button=>button.addEventListener("click",()=>focusOriginLines(data.lines.filter(row=>row.route_id===button.dataset.focusRoute)), {signal: runtime.lifecycle?.signal}));
    node.querySelectorAll("[data-focus-stop]").forEach(button=>button.addEventListener("click",()=>focusOriginLines(stops[Number(button.dataset.focusStop)].lines), {signal: runtime.lifecycle?.signal}));
  } catch(error) {if (!current.signal.aborted) node.textContent="Mezzi vicini non disponibili al momento. La ricerca servizi resta disponibile.";}
}

export function chooseReferencePoint() {
  state.choosingReference = true;
  closeSheets();
  if (state.view === "list") toggleView();
  document.getElementById("reference-status").textContent = "Tocca un punto sulla mappa come riferimento";
  showToast("Tocca la mappa per scegliere il riferimento");
}
