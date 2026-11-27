import {createPaline,nativeMode,nativeProgress,stopKey} from './paline-gl.js';
import {createStopNames} from './stop-names.js';
import {TransportLayer} from "./layer.js";
/* Transit layer of the 3D mode: the scheduled metro/rail/tram/bus layer on MapLibre.
 *
 * TransportLayerGL.create(map, elements, maplibre) behaves like TransportLayer.create on the
 * current map: same endpoint, viewport query, debounce, modes, toggle, status, focus chip and
 * popups with departures. Lines use a GeoJSON source under labels; close paline are native metre-sized
 * extrusions. Compact symbols and keyboard access remain retained HTML markers. Presentation helpers come from TransportLayer (single source).
 * MapLibre zoom z shows the scale of Leaflet zoom z + 1 (512 px tiles): requests and detail
 * thresholds use that equivalent zoom, so they match the current map.
 */
export const LINES = "egi-transport-lines";
const LINE_LAYERS = [`${LINES}-solid`, `${LINES}-dashed`];

/** Leaflet-equivalent zoom, capped at the existing viewport API maximum. */
export function leafletZoom(map) { return Math.min(19,Math.floor(map.getZoom() + 1)); }

/** Viewport adapters for TransportLayer.viewportQuery. */
export function viewport(map) {
  const container = map.getContainer();
  return {size: {x: container.clientWidth, y: container.clientHeight}, bounds: map.getBounds()};
}

/** Line feature with its drawing properties (colour, width, opacity, dashed) precomputed. */
export function lineFeature(feature, focused) {
  const p = feature.properties;
  const style = focused ? TransportLayer.focusLineStyle(p.transport_type, p.color, p.code) : TransportLayer.lineStyle(p.transport_type, p.color);
  return {type: "Feature", geometry: feature.geometry,
    properties: {...p, routes: undefined, _color: style.color, _width: style.weight, _opacity: style.opacity, _dashed: Boolean(style.dashArray)}};
}

/** First label layer of the style: transit lines go below it. */
function beforeLabels(map) {
  return map.getStyle?.().layers?.find(l => l.type === "symbol")?.id;
}

function create(map, elements, maplibre) {
  let disposed = false;
  const listeners = new AbortController(), cleanup = [];
  const ownMap = (event, ...args) => { map.on(event, ...args); cleanup.push(() => map.off?.(event, ...args)); };
  const modes = new Set(elements.modes ? ["metro", "rail", "tram", "bus"].filter(mode => elements.modes[mode]?.checked) : ["metro", "rail", "tram", "bus"]);
  let visible = false, features = [], request = null, timer = null, focused = null, popup = null, held = null;
  let markers = new Map(),lineData=null;
  const paline=createPaline(map,key=>{const entry=markers.get(key);if(entry)selectStop(entry);});
  const names=createStopNames(map.getContainer());
  const refreshNames=()=>names.refresh(leafletZoom(map));
  const scale=()=>{
    const root=map.getContainer(),zoom=map.getZoom();TransportLayer.scalePaline(root,zoom+1);
    for(const [mode,group] of [['metro','metro'],['bus','road']]){
      const progress=nativeProgress(mode,zoom);root.style.setProperty(`--tl-${group}-progress`,progress);
      root.style.setProperty(`--tl-native-${group}-pointer`,progress>=1?'none':'auto');
    }
  };
  ownMap("zoom",scale);
  const chip = document.createElement("div");
  chip.className = "tl-focus-chip"; chip.hidden = true;
  map.getContainer().appendChild(chip);

  function ready(fn) {
    if (map.isStyleLoaded?.() !== false) fn(); else { map.once("load", fn); cleanup.push(() => map.off?.("load", fn)); }
  }
  ready(() => {
    if (disposed || map.getSource?.(LINES)) return;
    map.addSource(LINES, {type: "geojson", data: {type: "FeatureCollection", features: []}});
    const before = beforeLabels(map);
    const paint = {"line-color": ["get", "_color"], "line-width": ["get", "_width"], "line-opacity": ["get", "_opacity"]};
    map.addLayer({id: LINE_LAYERS[0], type: "line", source: LINES, filter: ["!", ["get", "_dashed"]],
      layout: {"line-cap": "round", "line-join": "round"}, paint}, before);
    map.addLayer({id: LINE_LAYERS[1], type: "line", source: LINES, filter: ["get", "_dashed"],
      paint: {...paint, "line-dasharray": [3, 1.5]}}, before);
    for (const id of LINE_LAYERS) ownMap("click", id, event => {
      if(event.egiReferencePicked||event.egiStopPicked)return;
      const p = event.features?.[0]?.properties;
      if (p) openPopup(event.lngLat, TransportLayer.routePopupHtml(p));
    });
    paline.ensure();render();
  });

  function setStatus(text) { if (elements.status) elements.status.textContent = text; }

  function syncDetail() {
    map.getContainer().classList.toggle("tl-detail", leafletZoom(map) >= TransportLayer.DETAIL_ZOOM || Boolean(focused));
    map.getContainer().classList.toggle("tl-focused", Boolean(focused));
  }

  function openPopup(lngLat, html, onOpen) {
    popup?.remove();
    popup = new maplibre.Popup({maxWidth: "280px", focusAfterOpen: true}).setLngLat(lngLat).setHTML(html).addTo(map);
    const current = popup;
    current.on?.("close", () => { if (popup === current) { popup = null; release(); } });
    refreshNames();onOpen?.(current);
  }

  function selectStop(entry){openPopup(entry.lngLat,TransportLayer.popupHtml(entry.props),current=>{if(!entry.props.untimed)loadDepartures(current,entry.ids,entry.props);});}

  function release() {
    if(disposed)return;
    if (held) { features = held; held = null; render(); }else refreshNames();
  }

  function render() {
    const previous=markers,next=new Map();
    syncDetail();scale();
    const source = map.getSource?.(LINES);
    const shown = disposed || !visible ? [] : features;
    const lines={type:"FeatureCollection",features:shown.filter(f=>f.geometry.type!=="Point").map(f=>lineFeature(f,focused))};
    const encoded=JSON.stringify(lines);
    if(source&&encoded!==lineData){source.setData(lines);lineData=encoded;}
    const labelled = new Set(),stops=[];
    for (const feature of shown) {
      const props = feature.properties;
      if (feature.geometry.type !== "Point") {
        if (focused && !labelled.has(props.route_id)) {
          labelled.add(props.route_id);
          const at = TransportLayer.lineLabelPoint(feature.geometry, focused.center);
          const style = TransportLayer.focusLineStyle(props.transport_type, props.color, props.code);
          if (at) {
            const key=`line:${props.route_id}`,html=`<span class="tl-line-label" style="--line-color:${style.color}">${escape(props.code || props.name)}</span>`;
            let entry=previous.get(key);
            if(!entry){const element=document.createElement('span');element.className='tl-icon';entry={element,marker:new maplibre.Marker({element,anchor:'center'}).setLngLat([at[1],at[0]]).addTo(map)};}
            if(entry.html!==html){entry.element.innerHTML=html;entry.html=html;}
            const position=JSON.stringify(at);if(entry.position!==position){entry.marker.setLngLat([at[1],at[0]]);entry.position=position;}
            next.set(key,entry);
          }
        }
        continue;
      }
      const [lng, lat] = feature.geometry.coordinates;
      const ids = props.stop_ids || [props.stop_id];
      const near = Boolean(focused && ids.some(id => focused.stopIds.has(id)));
      const anchored=TransportLayer.pointDetail(props,leafletZoom(map));
      const key=stopKey(feature),native=nativeMode(props);
      let entry=previous.get(key);
      if(!entry){
        const el=document.createElement('button');el.type='button';
        entry={element:el,marker:new maplibre.Marker({element:el,anchor:'center'}).setLngLat([lng,lat]).addTo(map)};
        el.addEventListener('click',event=>{
          event.stopPropagation?.();
          selectStop(entry);
        });
      }
      const el=entry.element,signature=JSON.stringify([props,near,native?null:anchored]);
      entry.props=props;entry.ids=ids;entry.lngLat=[lng,lat];
      if(entry.signature!==signature){
        el.className=`tl-icon tl-gl-stop${anchored||native?' tl-point-detail':''}${native?` tl-native-stop tl-native-${props.transport_type==='metro'?'metro':'road'}-stop`:''}`;el.title=props.name;el.setAttribute('aria-label',props.name);
        el.innerHTML=native?`<span class="tl-compact" style="--tl-progress:var(--tl-${props.transport_type==='metro'?'metro':'road'}-progress,0)">${TransportLayer.stopIconHtml(props,near,false)}</span>`:TransportLayer.stopIconHtml(props,near,anchored);entry.signature=signature;
      }
      const position=JSON.stringify([lng,lat]);if(entry.position!==position){entry.marker.setLngLat([lng,lat]);entry.position=position;}
      stops.push({element:el,props,near});next.set(key,entry);
    }
    for(const [key,entry] of previous)if(!next.has(key))entry.marker.remove();
    markers=next;paline.update(shown,map.getZoom(),focused);
    names.update(stops,leafletZoom(map));
  }

  async function load() {
    request?.abort();
    if (disposed || !visible) return;
    if (!modes.size && !focused) { features = []; render(); return setStatus("Seleziona almeno una modalità di trasporto."); }
    const {size, bounds} = viewport(map);
    const query = TransportLayer.viewportQuery(size, bounds, leafletZoom(map), modes.size ? modes : new Set(["metro", "rail", "tram", "bus"]));
    if (!query) { map.once("resize", schedule); return; }
    if (focused) query.set("routes", focused.routeIds.join(","));
    const current = new AbortController();
    request = current;
    try {
      const response = await fetch("/api/preview/transport", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({...Object.fromEntries(query), west: Number(query.get("west")), south: Number(query.get("south")),
          east: Number(query.get("east")), north: Number(query.get("north")), zoom: Number(query.get("zoom"))}), signal: current.signal});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (disposed || current.signal.aborted) return;
      setStatus(TransportLayer.statusText(data));
      if (popup) { held = data.features; return; }
      features = data.features;
      render();
    } catch (error) {
      if (error.name === "AbortError" || current.signal.aborted) return;
      setStatus("Trasporti non raggiungibili. I dati già caricati restano visibili; nuovo tentativo automatico tra un minuto.");
    }
  }

  async function loadDepartures(current, stopIds, props) {
    const params = new URLSearchParams({stops: stopIds.join(","), limit: "3"});
    const routeIds = (props.routes || []).map(r => r.route_id).filter(id => !focused || focused.routeIds.includes(id));
    if (routeIds.length) params.set("routes", routeIds.join(","));
    let data = null;
    try {
      const response = await fetch(`/api/preview/transit/departures?${params}`, {signal: listeners.signal});
      if (response.ok) data = await response.json();
    } catch (_error) { /* shown as unavailable */ }
    if (disposed || listeners.signal.aborted || popup !== current) return;
    current.setHTML(TransportLayer.popupHtml(props, TransportLayer.departuresHtml(data)));refreshNames();
  }

  function schedule() { if (disposed) return; clearTimeout(timer); timer = setTimeout(load, 180); }

  function setVisible(value) {
    if (disposed) return;
    visible = value;
    if (!visible && focused) clearFocus(false);
    if (elements.toggle) {
      elements.toggle.hidden = false;
      elements.toggle.classList.toggle("active", visible);
      elements.toggle.setAttribute("aria-pressed", String(visible));
    }
    render();
    schedule();
  }

  function focus({routeIds, label, stopIds = [], points = [], onClear = null}) {
    focused = {routeIds: [...new Set(routeIds)].slice(0, 80), label, stopIds: new Set(stopIds), center: points[0] || null, onClear};
    chip.innerHTML = `<span>${escape(label)}</span><button type="button" aria-label="Chiudi vista linee e mostra tutta la rete">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => clearFocus(), {signal: listeners.signal});
    chip.hidden = false;
    features = [];
    if (points.length) {
      const lngs = points.map(p => p[1]), lats = points.map(p => p[0]);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {padding: 60, maxZoom: 15});
    }
    setVisible(true);
  }

  function clearFocus(reload = true) {
    const onClear = focused?.onClear;
    focused = null;
    onClear?.();
    chip.hidden = true;
    features = [];
    render();
    if (reload) schedule();
  }

  elements.toggle?.addEventListener("click", () => {
    const next = !visible;
    modes.clear();
    for (const mode of ["metro", "rail", "tram", "bus"]) {
      if (next) modes.add(mode);
      if (elements.modes?.[mode]) elements.modes[mode].checked = next;
    }
    setVisible(next);
  }, {signal: listeners.signal});
  for (const mode of ["metro", "rail", "tram", "bus"]) {
    elements.modes?.[mode]?.addEventListener("change", event => {
      if (event.target.checked) modes.add(mode); else modes.delete(mode);
      features = []; render();
      if (focused) clearFocus(false);
      setVisible(modes.size > 0);
    }, {signal: listeners.signal});
  }
  ownMap("moveend", refreshNames);
  ownMap("resize", refreshNames);
  ownMap("moveend", schedule);
  ownMap("zoomend", ()=>{syncDetail();refreshNames();});
  const interval = setInterval(load, 60000);
  setVisible(false);
  return {setVisible, isVisible: () => visible, reload: load, focus, clearFocus, focusedRoutes: () => focused?.routeIds || null,
    dispose() {
      disposed = true; visible = false; listeners.abort(); request?.abort(); clearTimeout(timer); clearInterval(interval);
      for (const clean of cleanup) clean();
      for (const entry of markers.values()) entry.marker.remove();
      paline.dispose();names.dispose();markers.clear(); popup?.remove(); popup = null; chip.remove?.();
      for (const id of LINE_LAYERS) if (map.getLayer?.(id)) map.removeLayer(id);
      if (map.getSource?.(LINES)) map.removeSource(LINES);
    }};
}

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

export const TransportLayerGL = {create, leafletZoom, lineFeature, viewport};
