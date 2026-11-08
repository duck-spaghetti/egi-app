/* Scheduled metro/tram/bus layer for the EGI map.
 *
 * TransportLayer.create(map, elements) owns everything about transport on the map:
 * fetching /api/preview/transport for the viewport (debounced, stale requests
 * aborted, no request while the map has no size), drawing stations/stops above
 * lines, the on/off toggle, mode checkboxes and the status line. The rest of the
 * page only creates it. Pure helpers are exposed for tests.
 */
const TransportLayer = (() => {
  const MODES = ["metro", "tram", "bus"];
  const TRAM_COLOR = "#7a4fa0";
  const BUS_COLOR = "#3d4a5c";
  const METRO_FALLBACK = "#355c7d";
  // Distinct, dark enough for white text; used when single lines are focused (F2).
  const LINE_PALETTE = ["#b2182b", "#2166ac", "#1b7837", "#762a83", "#b35806", "#01665e", "#8c510a", "#c51b7d", "#4d4d4d", "#35978f"];
  const BUS_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 1.5h8a2 2 0 0 1 2 2V12a1 1 0 0 1-1 1v1.25a.75.75 0 0 1-1.5 0V13h-7v1.25a.75.75 0 0 1-1.5 0V13a1 1 0 0 1-1-1V3.5a2 2 0 0 1 2-2Zm0 2v4h8v-4Zm.75 6.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm6.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>';

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function lineColor(mode, color) {
    if (mode === "metro") return color || METRO_FALLBACK;
    if (mode === "tram") return color || TRAM_COLOR;
    return BUS_COLOR;
  }

  /** Stable palette colour for a line code, for focused single-line views. */
  function colorForLine(code) {
    let hash = 0;
    for (const char of String(code)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return LINE_PALETTE[hash % LINE_PALETTE.length];
  }

  /** Leaflet path options: metro bold and coloured, tram medium, bus thin and muted. */
  function lineStyle(mode, color) {
    if (mode === "metro") return {color: lineColor(mode, color), weight: 5, opacity: 0.9};
    if (mode === "tram") return {color: lineColor(mode, color), weight: 3.5, opacity: 0.8};
    return {color: BUS_COLOR, weight: 2, opacity: 0.4};
  }

  function lineChips(routes) {
    return (routes || []).map(route => {
      const code = route.display_code || route.code;
      return `<span class="tl-chip" style="--line-color:${escapeHtml(lineColor(route.mode, route.color))}">${escapeHtml(code)}</span>`;
    }).join("");
  }

  /** Marker HTML: M roundel with line letters for stations, glyph squares for stops. */
  function stopIconHtml(props) {
    if (props.kind === "station" || props.transport_type === "metro") {
      return `<span class="tl-station"><span class="tl-roundel">M</span>${lineChips(props.routes)}</span>`;
    }
    if (props.transport_type === "tram") return '<span class="tl-stop tl-tram">T</span>';
    return `<span class="tl-stop tl-bus">${BUS_GLYPH}</span>`;
  }

  function popupHtml(props) {
    const kind = props.kind === "station" || props.transport_type === "metro" ? "Stazione metro" : props.transport_type === "tram" ? "Fermata tram" : "Fermata autobus";
    const code = props.code ? ` · ${escapeHtml(props.code)}` : "";
    return `<strong>${escapeHtml(props.name)}</strong><br><span class="tl-popup-kind">${kind}${code}</span><div class="tl-popup-lines">${lineChips(props.routes)}</div><small>Linee in servizio oggi (orario programmato) · Roma Servizi per la Mobilità</small>`;
  }

  /** Status line for the transport panel. */
  function statusText(data) {
    if (data.availability === "unavailable") return "Dati trasporti non disponibili. Nuovo controllo automatico; i servizi EGI restano consultabili.";
    if (data.availability === "outside_calendar") return "Il feed disponibile non contiene servizio programmato per oggi. In attesa di aggiornamento.";
    const format = value => value ? new Date(value).toLocaleString("it-IT", {timeZone:"Europe/Rome"}) : "non disponibile";
    const refresh = data.refresh || {};
    let warning = refresh.result === "failed" ? " Ultimo tentativo fallito: uso l’ultima versione valida." : "";
    if (data.refresh_stale) warning += " Nessun controllo automatico nelle ultime 24 ore: verificare il job di aggiornamento.";
    return `Rete programmata per ${data.service_date}. Ultimo controllo riuscito: ${format(refresh.last_checked_at)}. Dati aggiornati: ${format(data.manifest?.updated_at)}.${warning}`;
  }

  /** Query for the viewport, or null while the map has no usable size or bounds. */
  function viewportQuery(size, bounds, zoom, modes) {
    const west = bounds.getWest(), south = bounds.getSouth(), east = bounds.getEast(), north = bounds.getNorth();
    if (!(size.x > 0 && size.y > 0 && west < east && south < north)) return null;
    return new URLSearchParams({west, south, east, north, zoom, modes: [...modes].join(",")});
  }

  function create(map, elements) {
    const layer = L.layerGroup().addTo(map);
    const modes = new Set(MODES);
    let visible = false;
    let features = [];
    let request = null;
    let timer = null;

    function setStatus(text) {
      if (elements.status) elements.status.textContent = text;
    }

    function render() {
      layer.clearLayers();
      if (!visible) return;
      for (const feature of features) {
        const props = feature.properties;
        const geometry = feature.geometry;
        if (geometry.type === "Point") {
          const [lng, lat] = geometry.coordinates;
          const station = props.kind === "station" || props.transport_type === "metro";
          L.marker([lat, lng], {
            icon: L.divIcon({className: "tl-icon", html: stopIconHtml(props), iconSize: null}),
            keyboard: true,
            title: props.name,
            zIndexOffset: station ? 500 : 0,
          }).bindPopup(popupHtml(props)).addTo(layer);
        } else {
          L.geoJSON(geometry, {style: lineStyle(props.transport_type, props.color), interactive: true})
            .bindPopup(`<strong>${escapeHtml(props.transport_type === "metro" ? "Metro" : props.transport_type === "tram" ? "Tram" : "Autobus")} ${escapeHtml(props.code || props.name)}</strong><br><small>Percorso programmato · Roma Servizi per la Mobilità</small>`)
            .addTo(layer);
        }
      }
    }

    async function load() {
      request?.abort();
      if (!modes.size) {
        features = [];
        render();
        return setStatus("Seleziona almeno una modalità di trasporto.");
      }
      const query = viewportQuery(map.getSize(), map.getBounds(), map.getZoom(), modes);
      if (!query) {
        // The map container has no size yet (first paint, hidden view): retry on resize.
        map.once("resize", schedule);
        return;
      }
      const current = new AbortController();
      request = current;
      try {
        const response = await fetch(`/api/preview/transport?${query}`, {signal: current.signal});
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (current.signal.aborted) return;
        features = data.features;
        setStatus(statusText(data));
        render();
      } catch (error) {
        if (error.name === "AbortError" || current.signal.aborted) return;
        setStatus("Trasporti non raggiungibili. I dati già caricati restano visibili; nuovo tentativo automatico tra un minuto.");
      }
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(load, 180);
    }

    function setVisible(value) {
      visible = value;
      if (elements.toggle) {
        elements.toggle.hidden = false;
        elements.toggle.classList.toggle("active", visible);
        elements.toggle.setAttribute("aria-pressed", String(visible));
      }
      render();
      schedule();
    }

    elements.toggle?.addEventListener("click", () => setVisible(!visible));
    for (const mode of MODES) {
      elements.modes?.[mode]?.addEventListener("change", event => {
        if (event.target.checked) modes.add(mode); else modes.delete(mode);
        features = [];
        render();
        schedule();
      });
    }
    map.on("moveend", schedule);
    setInterval(load, 60000);
    setVisible(false);
    return {setVisible, isVisible: () => visible, reload: load};
  }

  return {create, statusText, viewportQuery, lineStyle, colorForLine, stopIconHtml, popupHtml, lineColor};
})();
