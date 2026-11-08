/* Scheduled metro/tram/bus layer for the EGI map.
 *
 * TransportLayer.create(map, elements) owns everything about transport on the map:
 * fetching /api/preview/transport for the viewport (debounced, stale requests
 * aborted, no request while the map has no size), drawing stations/stops above
 * lines, the on/off toggle, mode checkboxes and the status line. The rest of the
 * page only creates it, and may call focus() to show only some lines (the
 * "Mostra linee" button of a service) until the user closes the focus chip.
 * Pure helpers are exposed for tests.
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

  /** Focus view: every line strong; bus lines get distinct palette colours. */
  function focusLineStyle(mode, color, code) {
    if (mode === "bus") return {color: colorForLine(code), weight: 4.5, opacity: 0.95};
    return {color: lineColor(mode, color), weight: 6, opacity: 0.95};
  }

  /** Vertex for a line's code label, as [lat, lng]: closest to near ([lat, lng]) or the middle one. */
  function lineLabelPoint(geometry, near = null) {
    const coords = geometry.type === "MultiLineString" ? geometry.coordinates.flat() : geometry.coordinates;
    if (!coords?.length) return null;
    let best = coords[Math.floor(coords.length / 2)];
    if (near) {
      const kx = Math.cos(near[0] * Math.PI / 180);
      let bestDistance = Infinity;
      for (const point of coords) {
        const d = ((point[0] - near[1]) * kx) ** 2 + (point[1] - near[0]) ** 2;
        if (d < bestDistance) [bestDistance, best] = [d, point];
      }
    }
    return [best[1], best[0]];
  }

  function lineChips(routes) {
    return (routes || []).map(route => {
      const code = route.display_code || route.code;
      return `<span class="tl-chip" style="--line-color:${escapeHtml(lineColor(route.mode, route.color))}">${escapeHtml(code)}</span>`;
    }).join("");
  }

  /** Marker HTML: M roundel with line letters for stations, glyph squares for stops. */
  function stopIconHtml(props, highlighted = false) {
    const near = highlighted ? " tl-near" : "";
    if (props.kind === "station" || props.transport_type === "metro") {
      return `<span class="tl-station${near}"><span class="tl-roundel">M</span>${lineChips(props.routes)}</span>`;
    }
    if (props.transport_type === "tram") return `<span class="tl-stop tl-tram${near}">T</span>`;
    return `<span class="tl-stop tl-bus${near}">${BUS_GLYPH}</span>`;
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
    let focused = null; // {routeIds, label, stopIds:Set}
    const chip = document.createElement("div");
    chip.className = "tl-focus-chip";
    chip.hidden = true;
    map.getContainer().appendChild(chip);
    L.DomEvent.disableClickPropagation(chip);

    function setStatus(text) {
      if (elements.status) elements.status.textContent = text;
    }

    function render() {
      layer.clearLayers();
      if (!visible) return;
      const labelled = new Set();
      for (const feature of features) {
        const props = feature.properties;
        const geometry = feature.geometry;
        if (geometry.type === "Point") {
          const [lng, lat] = geometry.coordinates;
          const station = props.kind === "station" || props.transport_type === "metro";
          const ids = props.stop_ids || [props.stop_id];
          const near = Boolean(focused && ids.some(id => focused.stopIds.has(id)));
          L.marker([lat, lng], {
            icon: L.divIcon({className: "tl-icon", html: stopIconHtml(props, near), iconSize: null}),
            keyboard: true,
            title: props.name,
            zIndexOffset: near ? 1000 : station ? 500 : 0,
          }).bindPopup(popupHtml(props)).addTo(layer);
        } else {
          const style = focused ? focusLineStyle(props.transport_type, props.color, props.code) : lineStyle(props.transport_type, props.color);
          if (focused && !labelled.has(props.route_id)) {
            labelled.add(props.route_id);
            const at = lineLabelPoint(geometry, focused.center);
            if (at) L.marker(at, {interactive: false, keyboard: false, icon: L.divIcon({className: "tl-icon", iconSize: null,
              html: `<span class="tl-line-label" style="--line-color:${escapeHtml(style.color)}">${escapeHtml(props.code || props.name)}</span>`})}).addTo(layer);
          }
          L.geoJSON(geometry, {style, interactive: true})
            .bindPopup(`<strong>${escapeHtml(props.transport_type === "metro" ? "Metro" : props.transport_type === "tram" ? "Tram" : "Autobus")} ${escapeHtml(props.code || props.name)}</strong><br><small>Percorso programmato · Roma Servizi per la Mobilità</small>`)
            .addTo(layer);
        }
      }
    }

    async function load() {
      request?.abort();
      if (!modes.size && !focused) {
        features = [];
        render();
        return setStatus("Seleziona almeno una modalità di trasporto.");
      }
      const query = viewportQuery(map.getSize(), map.getBounds(), map.getZoom(), modes.size ? modes : new Set(MODES));
      if (!query) {
        // The map container has no size yet (first paint, hidden view): retry on resize.
        map.once("resize", schedule);
        return;
      }
      if (focused) query.set("routes", focused.routeIds.join(","));
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
      if (!visible && focused) clearFocus(false);
      if (elements.toggle) {
        elements.toggle.hidden = false;
        elements.toggle.classList.toggle("active", visible);
        elements.toggle.setAttribute("aria-pressed", String(visible));
      }
      render();
      schedule();
    }

    /** Show only routeIds; highlight stopIds; fit the map to points ([lat, lng]); onClear runs when the focus ends. */
    function focus({routeIds, label, stopIds = [], points = [], onClear = null}) {
      focused = {routeIds: [...new Set(routeIds)].slice(0, 80), label, stopIds: new Set(stopIds), center: points[0] || null, onClear};
      chip.innerHTML = `<span>${escapeHtml(label)}</span><button type="button" aria-label="Chiudi vista linee e mostra tutta la rete">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => clearFocus());
      chip.hidden = false;
      features = [];
      if (points.length) map.fitBounds(L.latLngBounds(points).pad(0.25), {maxZoom: 16});
      setVisible(true); // schedules the focused request
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
    return {setVisible, isVisible: () => visible, reload: load, focus, clearFocus, focusedRoutes: () => focused?.routeIds || null};
  }

  return {create, statusText, viewportQuery, lineStyle, focusLineStyle, lineLabelPoint, colorForLine, stopIconHtml, popupHtml, lineColor};
})();
