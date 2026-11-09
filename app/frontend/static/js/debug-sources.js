/* Local position-check view: the points of one source only (map ?debug=1).
 *
 * DebugSources.create(map, {setServicesVisible, openDetail}) adds a small panel.
 * Choosing a source hides the normal service markers and draws every position
 * candidate of that source from /api/preview/debug/positions, unclustered and
 * coloured by geocoding status, including candidates that the normal map does not
 * show (CAP area, municipality, ambiguous). Popups give the raw address, the OSM
 * match, score and alternatives. Nothing is written anywhere.
 */
const DebugSources = (() => {
  const STATUS = {
    matched_house: {color: "#1a9850", label: "Civico"},
    matched_street: {color: "#2c7bb6", label: "Via"},
    postcode_area: {color: "#f39c12", label: "Area CAP"},
    locality_only: {color: "#d7191c", label: "Solo comune"},
    source_point: {color: "#7b3294", label: "Coordinate della fonte"},
    unresolved: {color: "#777", label: "Non trovato"},
    no_address: {color: "#777", label: "Senza indirizzo"},
    no_position: {color: "#777", label: "Senza coordinate"},
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }

  /** Popup body for one candidate. */
  function popupHtml(p) {
    const osm = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`;
    const alternatives = (p.alternatives || []).slice(1).map(a => `<li>${esc(a.level)} · ${esc(a.score)} · ${esc(a.display_name)}</li>`).join("");
    return `<div class="dbg-popup"><strong>${esc(p.name)}</strong><br><small>${esc(p.layer || "")}</small>
      <p><b>Indirizzo fonte:</b> ${esc(p.address || "—")}</p>
      <p><b>Stato:</b> ${esc(STATUS[p.status]?.label || p.status)}${p.ambiguous ? " · <b>ambiguo</b>" : ""}${p.shown_on_map ? " · sulla mappa" : " · solo lista"}${p.score != null ? ` · punteggio ${esc(p.score)}` : ""}${p.step ? ` · ${esc(p.step)}` : ""}</p>
      ${p.match ? `<p><b>OSM:</b> ${esc(p.match)}</p>` : ""}
      ${(p.reasons || []).length ? `<p><small>${esc(p.reasons.join(", "))}</small></p>` : ""}
      ${alternatives ? `<details><summary>Alternative</summary><ul>${alternatives}</ul></details>` : ""}
      <p><a href="${osm}" target="_blank" rel="noopener">Apri in OpenStreetMap</a> · <button type="button" class="dbg-open" data-id="${esc(p.id)}">Scheda</button></p>
      <p><small>${esc(p.locator)}</small></p></div>`;
  }

  function create(map, {setServicesVisible, openDetail}) {
    if (!map.getPane("debugPoints")) map.createPane("debugPoints").style.zIndex = 640;
    const layer = L.layerGroup().addTo(map);
    const panel = document.createElement("section");
    panel.className = "dbg-panel";
    panel.setAttribute("aria-label", "Debug: punti di una fonte");
    panel.innerHTML = `<header><strong>Debug fonti</strong><button type="button" class="dbg-collapse" aria-expanded="true">–</button></header>
      <div class="dbg-body"><label>Fonte <select class="dbg-source"><option value="">— servizi normali —</option></select></label>
      <label class="dbg-check"><input type="checkbox" class="dbg-anchor"> Linea verso il centro del CAP</label>
      <div class="dbg-legend"></div><div class="dbg-missing"></div></div>`;
    document.body.appendChild(panel);
    const select = panel.querySelector(".dbg-source");
    const legend = panel.querySelector(".dbg-legend");
    const missing = panel.querySelector(".dbg-missing");
    const anchor = panel.querySelector(".dbg-anchor");
    const hidden = new Set();
    let data = null;

    panel.querySelector(".dbg-collapse").addEventListener("click", event => {
      const open = panel.classList.toggle("collapsed") === false;
      event.target.setAttribute("aria-expanded", String(open));
      event.target.textContent = open ? "–" : "+";
    });
    panel.addEventListener("click", event => {
      if (event.target.matches(".dbg-open")) openDetail(event.target.dataset.id);
    });
    map.getContainer().addEventListener("click", event => {
      if (event.target.matches(".dbg-open")) openDetail(event.target.dataset.id);
    });

    fetch("/api/preview/debug/sources").then(r => r.json()).then(sources => {
      select.innerHTML += sources.map(s => `<option value="${esc(s.code)}">${esc(s.name)} (${s.services})</option>`).join("");
    });

    function draw(fit) {
      layer.clearLayers();
      if (!data) return;
      const located = data.points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !hidden.has(p.status));
      located.forEach(p => {
        const color = STATUS[p.status]?.color || "#333";
        L.circleMarker([p.lat, p.lon], {pane: "debugPoints", radius: p.shown_on_map ? 7 : 6, color: p.ambiguous ? "#000" : "#fff",
          weight: p.ambiguous ? 2.5 : 1.5, dashArray: p.ambiguous ? "3 2" : null, fillColor: color, fillOpacity: .9})
          .bindPopup(popupHtml(p), {maxWidth: 320}).addTo(layer);
        if (anchor.checked && p.postcode_anchor) {
          L.polyline([[p.lat, p.lon], [p.postcode_anchor.lat, p.postcode_anchor.lon]], {pane: "debugPoints", color, weight: 1, opacity: .6, dashArray: "4 3", interactive: false}).addTo(layer);
        }
      });
      if (fit && located.length) map.fitBounds(L.latLngBounds(located.map(p => [p.lat, p.lon])), {padding: [30, 30]});
    }

    function renderLegend() {
      const counts = data.status_counts;
      const ambiguous = data.points.filter(p => p.ambiguous).length;
      legend.innerHTML = Object.keys(counts).sort().map(status => `<label class="dbg-check"><input type="checkbox" data-status="${esc(status)}" ${hidden.has(status) ? "" : "checked"}>
        <span class="dbg-dot" style="background:${STATUS[status]?.color || "#333"}"></span>${esc(STATUS[status]?.label || status)} <b>${counts[status]}</b></label>`).join("")
        + `<p class="dbg-note">${data.total} servizi · ${ambiguous} ambigui (bordo tratteggiato) · ${data.points.filter(p => p.shown_on_map).length} visibili sulla mappa normale</p>`;
      legend.querySelectorAll("[data-status]").forEach(box => box.addEventListener("change", () => {
        box.checked ? hidden.delete(box.dataset.status) : hidden.add(box.dataset.status);
        draw(false);
      }));
      const none = data.points.filter(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon));
      missing.innerHTML = none.length ? `<details><summary>Senza posizione: ${none.length}</summary><ul>${none.map(p => `<li><button type="button" class="dbg-open" data-id="${esc(p.id)}">${esc(p.name)}</button> · ${esc(p.address || "—")}</li>`).join("")}</ul></details>` : "";
    }

    select.addEventListener("change", async () => {
      hidden.clear();
      data = null;
      legend.innerHTML = missing.innerHTML = "";
      if (!select.value) { draw(false); setServicesVisible(true); return; }
      setServicesVisible(false);
      const response = await fetch(`/api/preview/debug/positions?source=${encodeURIComponent(select.value)}`);
      if (!response.ok) { legend.textContent = `Errore ${response.status}`; return; }
      data = await response.json();
      renderLegend();
      draw(true);
    });
    anchor.addEventListener("change", () => draw(false));
    return {panel};
  }

  return {create, STATUS, popupHtml};
})();

if (typeof module !== "undefined") module.exports = DebugSources;
