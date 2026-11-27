import {CycleLayer} from "./layer.js";
import {leafletZoom, viewport} from "../transport/layer-gl.js";
/* Cycleways layer of the 3D mode, on MapLibre: same endpoint, debounce, zoom gate, toggle and
 * status as CycleLayer.create on the current map; one line layer per kind with the same
 * colours and dashes, popups with the same text. Zoom sent as the Leaflet equivalent.
 */
export const SOURCE = "egi-cycleways";
const KINDS = ["separated", "track", "lane", "shared", "path"];

/** MapLibre dash pattern (in line widths) for a Leaflet dashArray in pixels. */
export function dashes(style) {
  return style.dashArray ? style.dashArray.split(" ").map(n => Math.max(Number(n) / style.weight, 0.1)) : null;
}

function create(map, elements, maplibre) {
  let disposed = false, visible = false, request = null, timer = null, popup = null;
  const listeners = new AbortController(), cleanup = [];
  const ownMap = (event, ...args) => { map.on(event, ...args); cleanup.push(() => map.off?.(event, ...args)); };
  const layers = KINDS.map(kind => `${SOURCE}-${kind}`);

  function ready(fn) {
    if (map.isStyleLoaded?.() !== false) fn(); else { map.once("load", fn); cleanup.push(() => map.off?.("load", fn)); }
  }
  ready(() => {
    if (disposed || map.getSource?.(SOURCE)) return;
    map.addSource(SOURCE, {type: "geojson", data: {type: "FeatureCollection", features: []}});
    const before = map.getStyle?.().layers?.find(l => l.type === "symbol")?.id;
    KINDS.forEach((kind, i) => {
      const style = CycleLayer.style(kind);
      const paint = {"line-color": style.color, "line-width": style.weight, "line-opacity": style.opacity};
      const dash = dashes(style);
      if (dash) paint["line-dasharray"] = dash;
      map.addLayer({id: layers[i], type: "line", source: SOURCE, filter: kind === "path"
        ? ["!", ["in", ["get", "kind"], ["literal", KINDS.slice(0, 4)]]] : ["==", ["get", "kind"], kind],
        layout: {"line-cap": "round"}, paint}, before);
      ownMap("click", layers[i], event => {
        const props = event.features?.[0]?.properties;
        if (!props) return;
        popup?.remove();
        popup = new maplibre.Popup({maxWidth: "280px"}).setLngLat(event.lngLat).setHTML(CycleLayer.popupHtml(props)).addTo(map);
      });
    });
  });

  function draw(features) { map.getSource?.(SOURCE)?.setData({type: "FeatureCollection", features}); }

  async function load() {
    request?.abort();
    draw([]);
    if (disposed || !visible) return;
    const {size, bounds} = viewport(map);
    if (!(size.x > 0 && size.y > 0 && bounds.getWest() < bounds.getEast())) { map.once("resize", schedule); return; }
    const zoom = leafletZoom(map);
    let west = bounds.getWest(), south = bounds.getSouth(), east = bounds.getEast(), north = bounds.getNorth();
    const extent = typeof window !== "undefined" && window.EGI_MAP_CONTEXT?.profile?.search_extent;
    if (extent) { west = Math.max(west, extent[0]); south = Math.max(south, extent[1]); east = Math.min(east, extent[2]); north = Math.min(north, extent[3]); }
    if (west >= east || south >= north) return;
    const current = new AbortController();
    request = current;
    try {
      const response = await fetch("/api/preview/cycleways", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({west, south, east, north, zoom}), signal: current.signal});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (disposed || current.signal.aborted) return;
      draw(data.features);
      if (elements.status) elements.status.textContent = CycleLayer.statusText(data, zoom);
    } catch (error) {
      if (error.name === "AbortError" || current.signal.aborted) return;
      if (elements.status) elements.status.textContent = "Piste ciclabili non raggiungibili.";
    }
  }

  function schedule() { if (disposed) return; clearTimeout(timer); timer = setTimeout(load, 200); }

  function setVisible(value) {
    if (disposed) return;
    visible = value;
    if (elements.toggle) {
      elements.toggle.classList.toggle("active", visible);
      elements.toggle.setAttribute("aria-pressed", String(visible));
    }
    if (elements.status) elements.status.hidden = !visible;
    schedule();
  }

  elements.toggle?.addEventListener("click", () => setVisible(!visible), {signal: listeners.signal});
  ownMap("moveend", () => visible && schedule());
  setVisible(false);
  return {setVisible, isVisible: () => visible, reload: load, dispose() {
    disposed = true; visible = false; listeners.abort(); request?.abort(); clearTimeout(timer);
    for (const clean of cleanup) clean();
    popup?.remove();
    for (const id of layers) if (map.getLayer?.(id)) map.removeLayer(id);
    if (map.getSource?.(SOURCE)) map.removeSource(SOURCE);
  }};
}

export const CycleLayerGL = {create, dashes};
