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
  const MODES = ["metro", "rail", "tram", "bus"];
  const RAIL_COLOR = "#00704A";
  const TRAM_COLOR = "#7a4fa0";
  const BUS_COLOR = "#3d4a5c";
  const METRO_FALLBACK = "#355c7d";
  // Distinct, dark enough for white text; used when single lines are focused (F2).
  const LINE_PALETTE = ["#b2182b", "#2166ac", "#1b7837", "#762a83", "#b35806", "#01665e", "#8c510a", "#c51b7d", "#4d4d4d", "#35978f"];
  const TRAIN_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 1h6a3 3 0 0 1 3 3v6a2.5 2.5 0 0 1-1.6 2.33l1.3 1.94a.75.75 0 1 1-1.25.83L10.95 13h-5.9l-1.5 2.1a.75.75 0 1 1-1.25-.83l1.3-1.94A2.5 2.5 0 0 1 2 10V4a3 3 0 0 1 3-3Zm-1 3v3h8V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1Zm1 5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>';
  const BUS_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 1.5h8a2 2 0 0 1 2 2V12a1 1 0 0 1-1 1v1.25a.75.75 0 0 1-1.5 0V13h-7v1.25a.75.75 0 0 1-1.5 0V13a1 1 0 0 1-1-1V3.5a2 2 0 0 1 2-2Zm0 2v4h8v-4Zm.75 6.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm6.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>';

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function lineColor(mode, color) {
    if (mode === "metro") return color || METRO_FALLBACK;
    if (mode === "tram") return color || TRAM_COLOR;
    if (mode === "rail") return color || RAIL_COLOR;
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
    if (mode === "rail") return {color: lineColor(mode, color), weight: 4, opacity: 0.7, dashArray: "10 4"};
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
    if (props.transport_type === "rail") {
      return `<span class="tl-station tl-rail${near}"><span class="tl-roundel tl-train">${TRAIN_GLYPH}</span>${lineChips(props.routes)}</span>`;
    }
    if (props.kind === "station" || props.transport_type === "metro") {
      return `<span class="tl-station${near}"><span class="tl-roundel">M</span>${lineChips(props.routes)}</span>`;
    }
    if (props.transport_type === "tram") return `<span class="tl-stop tl-tram${near}">T</span>`;
    return `<span class="tl-stop tl-bus${near}">${BUS_GLYPH}</span>`;
  }

  function wheelchairText(value) {
    if (value === "yes") return "Accessibile in sedia a rotelle (secondo la fonte)";
    if (value === "no") return "Non accessibile in sedia a rotelle (secondo la fonte)";
    return "Accessibilità in sedia a rotelle: non indicata";
  }

  /** "08:00 (tra 10 min)" for the next hour, "(in partenza)" now, plain time later. */
  function timeText(t) {
    if (t.in_min <= 0) return `${t.time} (in partenza)`;
    return t.in_min < 60 ? `${t.time} (tra ${t.in_min} min)` : t.time;
  }

  /** Predicted time: "22:07 (tra 6 min · +4′)". */
  function realtimeText(t) {
    const delay = t.delay_min ? ` · ${t.delay_min > 0 ? "+" : ""}${t.delay_min}′` : "";
    if (t.in_min <= 0) return `${t.time} (in arrivo${delay})`;
    return t.in_min < 60 ? `${t.time} (tra ${t.in_min} min${delay})` : `${t.time}${delay ? ` (${delay.slice(3)})` : ""}`;
  }

  /** Realtime times when available (marked live), plus the scheduled ones.
   * Realtime only covers trips already tracked, so a nearer scheduled trip may
   * have no prediction yet: scheduled times stay visible as a second line. */
  function directionTimes(d) {
    const scheduled = d.times.length ? d.times.map(timeText).join(" · ") : "nessun’altra corsa oggi";
    if (d.realtime?.length) return {live: true, text: d.realtime.map(realtimeText).join(" · "), scheduled};
    return {live: false, text: scheduled, scheduled: null};
  }

  /** Alerts ("⚠ header", description on demand); only lines in `relevant` are named.
   * More than two alerts collapse under one "N avvisi" toggle. */
  function alertsHtml(alerts, relevant = null) {
    if (!alerts?.length) return "";
    const items = alerts.map(a => {
      const lines = (a.routes || []).filter(r => !relevant || relevant.has(r));
      return `<li><details><summary><span aria-hidden="true">⚠</span> ${escapeHtml(a.header || "Avviso di servizio")}${lines.length ? ` <small>(${escapeHtml(lines.join(", "))})</small>` : ""}</summary>${a.description ? `<p>${escapeHtml(a.description)}</p>` : ""}</details></li>`;
    }).join("");
    if (alerts.length <= 2) return `<ul class="tl-alerts">${items}</ul>`;
    return `<details class="tl-alerts-group"><summary><span aria-hidden="true">⚠</span> ${alerts.length} avvisi su queste linee</summary><ul class="tl-alerts">${items}</ul></details>`;
  }

  /** Footnote on what the times are. */
  function realtimeNote(data) {
    const status = data?.realtime?.status;
    if (status === "live") return "<span class=\"tl-live-dot\" aria-hidden=\"true\"></span> = previsione in tempo reale (Atac, Roma TPL); gli altri orari, treni inclusi, sono programmati.";
    if (status === "stale") return "Tempo reale non aggiornato: mostro solo orari programmati.";
    return "Orari programmati, non in tempo reale.";
  }

  /** Next departures per line and direction, for a stop popup. */
  function departuresHtml(data) {
    if (!data || data.availability !== "available") return '<p class="tl-dep-note">Orari non disponibili.</p>';
    if (!data.departures.length) return `${alertsHtml(data.alerts)}<p class="tl-dep-note">Nessuna corsa programmata qui.</p>`;
    // Busy stations list many destinations: keep those with trips left, soonest first.
    const pending = data.departures.filter(d => d.times.length || d.realtime?.length);
    const shownDepartures = (pending.length ? pending : data.departures.slice(0, 1)).slice(0, 8);
    const hidden = data.departures.length - shownDepartures.length;
    const rows = shownDepartures.map(d => {
      const shown = directionTimes(d);
      const times = shown.text;
      const towards = d.headsign ? ` → ${escapeHtml(d.headsign)}` : "";
      return `<li><span class="tl-chip" style="--line-color:${escapeHtml(lineColor(d.mode, d.color))}">${escapeHtml(d.code)}</span>${towards}<br><span class="tl-dep-times${shown.live ? " live" : ""}">${shown.live ? '<span class="tl-live-dot" aria-label="tempo reale"></span>' : ""}${escapeHtml(times)}</span>${shown.scheduled ? `<br><span class="tl-dep-scheduled">orario: ${escapeHtml(shown.scheduled)}</span>` : ""}</li>`;
    }).join("");
    const shownRoutes = new Set(data.departures.map(d => d.route_id));
    const more = hidden > 0 ? `<p class="tl-dep-note">${hidden === 1 ? "1 altra destinazione" : `${hidden} altre destinazioni`} senza corse a breve non ${hidden === 1 ? "mostrata" : "mostrate"}.</p>` : "";
    return `${alertsHtml(data.alerts, shownRoutes)}<ul class="tl-departures">${rows}</ul>${more}<p class="tl-dep-note">${realtimeNote(data)} Aggiornato alle ${escapeHtml(data.now)}.</p>`;
  }

  function popupHtml(props, departures = null) {
    const kind = props.transport_type === "rail" ? "Stazione ferroviaria" : props.kind === "station" || props.transport_type === "metro" ? "Stazione metro" : props.transport_type === "tram" ? "Fermata tram" : "Fermata autobus";
    const code = props.code ? ` · ${escapeHtml(props.code)}` : "";
    return `<strong>${escapeHtml(props.name)}</strong><br><span class="tl-popup-kind">${kind}${code}</span><div class="tl-popup-lines">${lineChips(props.routes)}</div><div class="tl-dep">${departures ?? "Carico i prossimi passaggi…"}</div><small>${escapeHtml(wheelchairText(props.wheelchair_boarding))}<br>Linee in servizio oggi · ${props.transport_type === "rail" ? "Trenitalia (NeTEx, NAP nazionale)" : "Roma Servizi per la Mobilità"}</small>`;
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
    // While a transport popup is open, new data waits: re-rendering would close it
    // (opening a popup pans the map, which triggers a reload).
    let popupOpen = false;
    let held = null;
    const chip = document.createElement("div");
    chip.className = "tl-focus-chip";
    chip.hidden = true;
    map.getContainer().appendChild(chip);
    L.DomEvent.disableClickPropagation(chip);

    function setStatus(text) {
      if (elements.status) elements.status.textContent = text;
    }

    function render() {
      popupOpen = false;
      held = null;
      layer.clearLayers();
      if (!visible) return;
      const labelled = new Set();
      for (const feature of features) {
        const props = feature.properties;
        const geometry = feature.geometry;
        if (geometry.type === "Point") {
          const [lng, lat] = geometry.coordinates;
          const station = props.kind === "station" || props.transport_type === "metro" || props.transport_type === "rail";
          const ids = props.stop_ids || [props.stop_id];
          const near = Boolean(focused && ids.some(id => focused.stopIds.has(id)));
          L.marker([lat, lng], {
            icon: L.divIcon({className: "tl-icon", html: stopIconHtml(props, near), iconSize: null}),
            keyboard: true,
            title: props.name,
            zIndexOffset: near ? 1000 : station ? 500 : 0,
          }).bindPopup(popupHtml(props), {maxWidth: 280})
            .on("popupopen", event => {
              popupOpen = true;
              loadDepartures(event.popup, ids, props);
            })
            .on("popupclose", releasePopup)
            .addTo(layer);
        } else {
          const style = focused ? focusLineStyle(props.transport_type, props.color, props.code) : lineStyle(props.transport_type, props.color);
          if (focused && !labelled.has(props.route_id)) {
            labelled.add(props.route_id);
            const at = lineLabelPoint(geometry, focused.center);
            if (at) L.marker(at, {interactive: false, keyboard: false, icon: L.divIcon({className: "tl-icon", iconSize: null,
              html: `<span class="tl-line-label" style="--line-color:${escapeHtml(style.color)}">${escapeHtml(props.code || props.name)}</span>`})}).addTo(layer);
          }
          L.geoJSON(geometry, {style, interactive: true})
            .bindPopup(`<strong>${escapeHtml({metro: "Metro", rail: "Treno", tram: "Tram"}[props.transport_type] || "Autobus")} ${escapeHtml(props.code || props.name)}</strong><br><small>Percorso programmato · Roma Servizi per la Mobilità</small>`)
            .on("popupopen", () => { popupOpen = true; })
            .on("popupclose", releasePopup)
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
        setStatus(statusText(data));
        if (popupOpen) {
          held = data.features;
          return;
        }
        features = data.features;
        render();
      } catch (error) {
        if (error.name === "AbortError" || current.signal.aborted) return;
        setStatus("Trasporti non raggiungibili. I dati già caricati restano visibili; nuovo tentativo automatico tra un minuto.");
      }
    }

    function releasePopup() {
      popupOpen = false;
      if (held) {
        features = held;
        held = null;
        render();
      }
    }

    /** Fill an open stop popup with the next departures of its (focused) lines. */
    async function loadDepartures(popup, stopIds, props) {
      const params = new URLSearchParams({stops: stopIds.join(","), limit: "3"});
      const routeIds = focused ? focused.routeIds : (props.routes || []).map(r => r.route_id);
      if (routeIds.length) params.set("routes", routeIds.join(","));
      let data = null;
      try {
        const response = await fetch(`/api/preview/transit/departures?${params}`);
        if (response.ok) data = await response.json();
      } catch (_error) { /* shown as unavailable */ }
      if (!popup.isOpen()) return;
      // setContent, not DOM edits: Leaflet's popup.update() re-renders the bound HTML.
      popup.setContent(popupHtml(props, departuresHtml(data)));
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

  return {directionTimes, realtimeText, alertsHtml, realtimeNote, create, statusText, viewportQuery, lineStyle, focusLineStyle, lineLabelPoint, colorForLine, stopIconHtml, popupHtml, lineColor, departuresHtml, timeText, wheelchairText};
})();
