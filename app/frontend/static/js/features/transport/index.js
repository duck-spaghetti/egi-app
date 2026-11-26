import {isMapLibre,inertLayer} from "../map/engine.js";
import {TransportLayer} from "./layer.js";
import {escapeHtml} from "../../format.js";
/** createTransport owns its behavior; dependencies and snapshots are explicit. */
export function createTransport({scope,http,sites,emit}) {
let state={pois:[],transitByPlace:{}};const runtime={transport:null,originRequest:null};const managedFetch=http.request,post=http.post;
const TRANSIT_NOTE = "Tempi a piedi stimati in linea d’aria (+30%, 4 km/h). Bus, metro e tram: Roma Servizi per la Mobilità; treni: Trenitalia (NeTEx, NAP nazionale); ferrovie senza orari: © OpenStreetMap contributors (ODbL 1.0), servizio odierno non verificato. Le corse soppresse non sono indicate. Accessibilità indicata solo dove la fonte la dichiara.";

async function loadTransitSummaries() {
  try {
    const response = await managedFetch("/api/preview/transit/places");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    scope.check();emit('transit',{availability:data.availability,places:data.places||{}});
  } catch (_error) {
    if(!scope.signal.aborted)emit('transit',{availability:'unavailable',places:{}});
  }

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
    <p class="nearest-stop-name"><strong>${escapeHtml(mode)} ${escapeHtml(g.stop_name)}</strong> · circa ${g.walk_min} min a piedi${g.wheelchair === "yes" ? ' · <span class="wheelchair-tag">accessibile in sedia a rotelle</span>' : ""}</p>
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
    const response = await managedFetch(`/api/preview/transit/places/${encodeURIComponent(poi.place_id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (_error) {
    data = { availability: "unavailable", lines: [] };
  }
  // With a reference position, prefer a stop whose line also serves the user (layout r3).
  let origin = null;
  if (state.userLoc && data.availability === "available") {
    try {
      const response = await post("/api/preview/transit/origin",{lat:state.userLoc.lat,lon:state.userLoc.lng});
      if (response.ok) origin = await response.json();
    } catch (_error) { origin = null; }
  }
  // The sheet may already show another service.
  if (!node.isConnected || node.dataset.transitPlace !== String(poi.place_id)) return;
  if(scope.signal.aborted)return;
  node.innerHTML = renderTransitRows(data, origin);
  node.querySelectorAll("[data-focus-route]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.focusRoute;
    focusTransit(poi, id === "*" ? data.lines : data.lines.filter(row => row.route_id === id));
  }, {signal: scope.signal}));
  node.querySelectorAll("[data-focus-stop]").forEach(button => button.addEventListener("click", () => {
    const group = (data.stops || [])[Number(button.dataset.focusStop)];
    if (group) focusTransit(poi, group.lines, group.stop_name);
  }, {signal: scope.signal}));
}

/** Leave the sheet, show the map and only these lines, highlighting their nearby stops. */

function focusTransit(poi, rows, stopName = null) {
  if (!rows.length || !runtime.transport) return;
  emit("showMap");
  emit("focus",{key:sites.key(poi)});
  const label = rows.length === 1
    ? `${modeName(rows[0].mode)} ${rows[0].code} vicino a ${poi.title}`
    : stopName ? `Linee di ${stopName}` : `${rows.length} linee vicino a ${poi.title}`;
  runtime.transport.focus({
    routeIds: rows.map(row => row.route_id),
    label,
    stopIds: rows.map(row => row.stop_id),
    points: [[poi.latitude, poi.longitude], ...rows.filter(row => row.stop_point).map(row => [row.stop_point[1], row.stop_point[0]])],
    onClear: () => {
      emit("focus",{key:null});
    },
  });
}

function focusOriginLines(lines) {
  const origin=state.userLoc;
  if (!origin || !lines.length) return;
  emit("showMap");
  runtime.transport.focus({routeIds:lines.map(r=>r.route_id),label:`Mezzi vicino a ${origin.label}`,stopIds:lines.flatMap(r=>r.stop_ids),points:[[origin.lat,origin.lng],...lines.map(r=>[r.stop_point[1],r.stop_point[0]])]});
}
async function loadOriginTransit() {
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
    if (current.signal.aborted || state.userLoc?.lat!==origin.lat || state.userLoc?.lng!==origin.lng) return;
    const stops=data.stops || [];
    stops.forEach(g=>g.lines.forEach(line=>line.origin=true));
    node.innerHTML=`<p class="source-note">Dal riferimento: ${escapeHtml(origin.label)}. Distanze in linea d’aria; verifica di poter raggiungere la fermata in tempo.</p><ul class="transit-list">${stops.map((g,i)=>transitStopGroup(g,i,data.alerts)).join("")}</ul>${!stops.length ? "Nessuna fermata nei dati disponibili vicino al punto scelto." : ""}<p class="source-note">${TransportLayer.realtimeNote(data)} Aggiornato alle ${escapeHtml(data.now || "—")}.</p><button type="button" data-refresh-origin>Aggiorna partenze</button>`;
    node.querySelector("[data-refresh-origin]")?.addEventListener("click",loadOriginTransit, {signal: scope.signal});
    node.querySelectorAll("[data-focus-route]").forEach(button=>button.addEventListener("click",()=>focusOriginLines(data.lines.filter(row=>row.route_id===button.dataset.focusRoute)), {signal: scope.signal}));
    node.querySelectorAll("[data-focus-stop]").forEach(button=>button.addEventListener("click",()=>focusOriginLines(stops[Number(button.dataset.focusStop)].lines), {signal: scope.signal}));
  } catch(error) {if (!scope.signal.aborted && !current.signal.aborted) node.textContent="Mezzi vicini non disponibili al momento. La ricerca servizi resta disponibile.";}
}

function mount(attach){runtime.transport=attach(map=>isMapLibre(map)?inertLayer():TransportLayer.create(map,{
 toggle:document.getElementById('transport-toggle'),status:document.getElementById('transport-status'),
 modes:Object.fromEntries(['metro','rail','tram','bus'].map(mode=>[mode,document.getElementById('transport-'+mode)]))}));}
function update(snapshot){state=snapshot;}
function cancelOrigin(){runtime.originRequest?.abort();}
function referenceChanged(){
 cancelOrigin();
 document.getElementById('origin-transit-body').textContent='Apri per caricare fermate e partenze dal punto scelto.';
 if(document.getElementById('origin-transit').open)void loadOriginTransit();
}
function dispose(){cancelOrigin();runtime.transport?.dispose();runtime.transport=null;}

return {mount,update,summaries:loadTransitSummaries,detail:loadTransitDetail,origin:loadOriginTransit,badge:transitBadge,shell:transitSectionShell,referenceChanged,dispose};
}
