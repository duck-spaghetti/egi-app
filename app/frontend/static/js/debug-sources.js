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
      <div class="dbg-legend"></div><div class="dbg-missing"></div>
      <details class="dbg-photos"><summary>Test foto Mapillary</summary><div class="dbg-photo-list">Caricamento…</div></details></div>`;
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
    const collapse = () => {
      panel.classList.add("collapsed");
      const button = panel.querySelector(".dbg-collapse");
      button.textContent = "+";
      button.setAttribute("aria-expanded", "false");
    };
    panel.addEventListener("click", event => {
      if (event.target.matches(".dbg-open")) { collapse(); openDetail(event.target.dataset.id); }
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

    const cameras = L.layerGroup().addTo(map);
    let photos = {};
    fetch("/api/preview/debug/mapillary").then(r => r.json()).then(data => {
      photos = data.pois || {};
      const list = panel.querySelector(".dbg-photo-list");
      if (!data.available) { list.textContent = "Nessun test: eseguire .scratch/mapillary/coverage.py"; return; }
      const rows = Object.entries(photos).sort((a, b) => (b[1].best[0]?.score ?? -1) - (a[1].best[0]?.score ?? -1));
      const withImages = rows.filter(([, v]) => v.best.length).length;
      list.innerHTML = `<p class="dbg-note">${rows.length} servizi del campione · ${withImages} con immagini entro ~100 m. Apri la scheda per vedere le candidate.</p><ol>${rows.map(([id, v]) => `<li><button type="button" class="dbg-open" data-id="${esc(id)}">${esc(v.name)}</button> <small>${v.best.length ? `${v.best[0].distance_m} m · ${v.best[0].facing ? "verso il servizio" : "di lato"} · punteggio ${v.best[0].score}` : "nessuna immagine"}</small></li>`).join("")}</ol>`;
    });

    /** Photo-test section for a service card; draws candidate cameras on the map. */
    function photoSection(poi) {
      cameras.clearLayers();
      const entry = photos[poi.id];
      if (!entry) return "";
      if (!entry.best.length) return `<section class="detail-section dbg-photo"><h3>Foto Mapillary (test)</h3><p>Nessuna immagine entro ~100 m.</p></section>`;
      entry.best.forEach((c, i) => {
        const color = c.facing ? "#1a9850" : "#888";
        L.circleMarker([c.lat, c.lon], {pane: "debugPoints", radius: 6, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 1})
          .bindTooltip(`${i + 1} · ${c.distance_m} m`).addTo(cameras);
        if (Number.isFinite(c.bearing) && !c.pano) {
          const k = 0.00025, rad = c.bearing * Math.PI / 180;
          L.polyline([[c.lat, c.lon], [c.lat + k * Math.cos(rad), c.lon + k * Math.sin(rad) / Math.cos(c.lat * Math.PI / 180)]],
            {pane: "debugPoints", color, weight: 3, interactive: false}).addTo(cameras);
        }
      });
      return `<section class="detail-section dbg-photo"><h3>Foto Mapillary (test)</h3>
        <p class="dbg-note">Candidate ordinate per distanza, direzione della camera, età e panorama. Sulla mappa: punti numerati con la direzione di scatto (verde = rivolta verso il servizio).</p>
        <ol class="dbg-cands">${entry.best.map((c, i) => `<li><button type="button" class="dbg-cand" data-image="${esc(c.id)}">${i + 1}. ${c.distance_m} m · ${c.pano ? "360°" : c.angle_off == null ? "direzione ignota" : `${c.angle_off}° dal servizio`} · ${c.age_years ?? "?"} anni · ${esc(c.score)}</button></li>`).join("")}</ol>
        <div class="dbg-viewer"></div>
        <p class="dbg-attrib">Immagini <a href="https://www.mapillary.com" target="_blank" rel="noopener">Mapillary</a>, CC BY-SA 4.0 · visualizzatore ufficiale, nessuna copia salvata da EGI.</p></section>`;
    }

    /** Load Mapillary's own viewer only when a candidate is chosen. */
    function bindPhotoSection(root) {
      root.querySelectorAll(".dbg-cand").forEach(button => button.addEventListener("click", () => {
        const id = button.dataset.image;
        const entry = Object.values(photos).flatMap(v => v.best).find(c => c.id === id);
        root.querySelectorAll(".dbg-cand").forEach(b => b.classList.toggle("active", b === button));
        root.querySelector(".dbg-viewer").innerHTML = `<iframe title="Immagine Mapillary ${esc(id)}" src="https://www.mapillary.com/embed?image_key=${encodeURIComponent(id)}&style=photo" loading="lazy" allowfullscreen></iframe>
          <p class="dbg-note">Autore: ${esc(entry?.creator || "sconosciuto")} · <a href="https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}&focus=photo" target="_blank" rel="noopener">apri su Mapillary</a></p>`;
        if (entry) map.panTo([entry.lat, entry.lon]);
      }));
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
    return {panel, photoSection, bindPhotoSection, clearCameras: () => cameras.clearLayers()};
  }

  return {create, STATUS, popupHtml};
})();

if (typeof module !== "undefined") module.exports = DebugSources;
