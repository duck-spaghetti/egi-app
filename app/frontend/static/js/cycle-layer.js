/* OpenStreetMap cycle infrastructure layer for the EGI map.
 *
 * CycleLayer.create(map, {toggle, status}) fetches /api/preview/cycleways for the
 * viewport (debounced, stale requests aborted, nothing below zoom 12) and draws the
 * ways by kind. Pure helpers are exposed for tests.
 */
const CycleLayer = (() => {
  const STYLES = {
    separated: {color: "#1b7837", weight: 4, opacity: 0.9},
    track: {color: "#1b7837", weight: 3.5, opacity: 0.9, dashArray: "8 4"},
    lane: {color: "#5aae61", weight: 3, opacity: 0.9, dashArray: "6 6"},
    shared: {color: "#a6dba0", weight: 3, opacity: 0.9, dashArray: "2 6"},
    path: {color: "#2a9d8f", weight: 3, opacity: 0.8, dashArray: "1 5"},
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function style(kind) {
    return STYLES[kind] || STYLES.path;
  }

  function popupHtml(props) {
    const details = [props.surface && `fondo: ${props.surface}`, props.oneway && "senso unico per le bici"].filter(Boolean).join(" · ");
    return `<strong>${escapeHtml(props.name || props.label)}</strong><br><span class="tl-popup-kind">${escapeHtml(props.label)}</span>${details ? `<br><small>${escapeHtml(details)}</small>` : ""}<br><small>© OpenStreetMap contributors (ODbL) · dati non verificati da EGI</small>`;
  }

  function statusText(data, zoom) {
    if (data.availability !== "available") return "Piste ciclabili non disponibili.";
    if (zoom < data.min_zoom) return `Ingrandisci (zoom ${data.min_zoom}+) per vedere le piste ciclabili.`;
    const when = data.osm_base ? new Date(data.osm_base).toLocaleDateString("it-IT") : "data non nota";
    return `${data.features.length} tratti ciclabili in vista · OpenStreetMap al ${when}.`;
  }

  function create(map, elements) {
    let disposed=false;
    const listeners=new AbortController(),cleanup=[];
    const ownMap=(event,callback)=>{map.on(event,callback);cleanup.push(()=>map.off?.(event,callback));};
    const ownOnce=(event,callback)=>{map.once(event,callback);cleanup.push(()=>map.off?.(event,callback));};
    const layer = L.layerGroup().addTo(map);
    let visible = false;
    let request = null;
    let timer = null;

    async function load() {
      request?.abort();
      layer.clearLayers();
      if (disposed || !visible) return;
      const size = map.getSize();
      const b = map.getBounds();
      if (!(size.x > 0 && size.y > 0 && b.getWest() < b.getEast())) return ownOnce("resize", schedule);
      const current = new AbortController();
      request = current;
      const zoom = map.getZoom();
      let west=b.getWest(),south=b.getSouth(),east=b.getEast(),north=b.getNorth();
      const extent=typeof window!=="undefined" && window.EGI_MAP_CONTEXT?.profile?.search_extent;
      if(extent){west=Math.max(west,extent[0]);south=Math.max(south,extent[1]);east=Math.min(east,extent[2]);north=Math.min(north,extent[3]);}
      if(west>=east || south>=north) return;
      const body={west,south,east,north,zoom};
      try {
        const response = await fetch("/api/preview/cycleways",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:current.signal});
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (disposed || current.signal.aborted) return;
        layer.clearLayers();
        for (const feature of data.features) {
          L.geoJSON(feature.geometry, {style: style(feature.properties.kind)}).bindPopup(popupHtml(feature.properties)).addTo(layer);
        }
        if (elements.status) elements.status.textContent = statusText(data, zoom);
      } catch (error) {
        if (error.name === "AbortError" || current.signal.aborted) return;
        if (elements.status) elements.status.textContent = "Piste ciclabili non raggiungibili.";
      }
    }

    function schedule() {
      if(disposed) return;
      clearTimeout(timer);
      timer = setTimeout(load, 200);
    }

    function setVisible(value) {
      if(disposed) return;
      visible = value;
      if (elements.toggle) {
        elements.toggle.classList.toggle("active", visible);
        elements.toggle.setAttribute("aria-pressed", String(visible));
      }
      if (elements.status) elements.status.hidden = !visible;
      schedule();
    }

    elements.toggle?.addEventListener("click", () => setVisible(!visible), {signal:listeners.signal});
    ownMap("moveend", () => visible && schedule());
    setVisible(false);
    return {setVisible, isVisible: () => visible, reload: load, dispose(){disposed=true;visible=false;listeners.abort();request?.abort();clearTimeout(timer);for(const clean of cleanup)clean();layer.off?.();layer.remove?.();}};
  }

  return {create, style, popupHtml, statusText};
})();
