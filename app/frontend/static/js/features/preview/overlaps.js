/** Retained local overlap decisions; no canonical writes or new moderation journey. */
export function mountOverlapReview({scope,http}){
const LABELS = {same_service: "Stesso servizio", same_place: "Stesso luogo, servizi diversi", different: "Diversi", unsure: "Non so"};
const TAG = {same_service: "d-same", same_place: "d-place", different: "d-diff", unsure: ""};
const KEY = "egi-review-overlaps-v1";
let pairs = [], current = null, decisions = {}, groupOnly = null;
try { decisions = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_e) { decisions = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(decisions)); } catch (_e) {} };
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const map = L.map("map", {zoomControl: true});
scope.own(()=>map.remove());
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 19, attribution: "© OpenStreetMap contributors"}).addTo(map);
map.setView([41.9, 12.5], 11);
const layer = L.layerGroup().addTo(map);

function visible() {
  const tiers = new Set([...document.querySelectorAll("[data-tier]:checked")].map(x => x.dataset.tier));
  const openOnly = document.getElementById("open-only").checked;
  const multi = document.getElementById("multi-only").checked;
  const source = document.getElementById("source-filter").value;
  const proposal = document.getElementById("proposal-filter").value;
  const highOnly = document.getElementById("high-only").checked;
  return pairs.filter(p => tiers.has(p.tier) && (!openOnly || !decisions[p.pair_id])
    && (!proposal || p.proposal.decision === proposal) && (!highOnly || p.proposal.confidence === "alta")
    && (!multi || (p.group && p.group.sources.length > 2))
    && (!source || p.a.source_code === source || p.b.source_code === source)
    && (!groupOnly || (p.group && p.group.id === groupOnly)));
}

function renderList() {
  const list = visible();
  document.getElementById("list").innerHTML = list.map(p => {
    const d = decisions[p.pair_id];
    return `<button class="item${current && current.pair_id === p.pair_id ? " active" : ""}" data-id="${p.pair_id}">
      <span class="tag">${p.tier}</span>${d ? `<span class="tag ${TAG[d.decision]}">${esc(LABELS[d.decision])}</span>` : `<span class="tag" title="proposta">→ ${esc(p.proposal.label)} · ${esc(p.proposal.confidence)}</span>`}
      #${p.number} · ${p.score} pt · ${p.distance_m == null ? "senza posizione" : p.distance_m + " m"}${p.group && p.group.sources.length > 2 ? ` · gruppo ${p.group.sources.length} fonti` : ""}<small>${esc(p.a.source)}: ${esc(p.a.title)}</small><small>${esc(p.b.source)}: ${esc(p.b.title)}</small></button>`;
  }).join("") || '<p class="hint" style="padding:12px">Nessuna coppia con questi filtri.</p>';
  document.querySelectorAll(".item").forEach(b => b.addEventListener("click", () => show(b.dataset.id),{signal:scope.signal}));
  const done = pairs.filter(p => decisions[p.pair_id]).length;
  document.getElementById("progress").textContent = `${done} decise su ${pairs.length} coppie · ${list.length} mostrate`;
  renderExport();
}

function row(label, a, b, key) {
  const va = Array.isArray(a) ? a.join(" · ") : a, vb = Array.isArray(b) ? b.join(" · ") : b;
  const differ = (va || "") !== (vb || "");
  return [`<dt>${label}</dt><dd class="${differ ? "diff" : ""}">${esc(va || "—")}</dd>`, `<dt>${label}</dt><dd class="${differ ? "diff" : ""}">${esc(vb || "—")}</dd>`];
}

function side(p, which) {
  const s = p[which], o = p[which === "a" ? "b" : "a"];
  const rows = [["Tipo", "type"], ["Bisogno", "need"], ["Indirizzo", "address"], ["Contatti", "contacts"], ["Orari", "hours"], ["Posizione", "position"]]
    .map(([l, k]) => row(l, s[k], o[k])[0]).join("");
  return `<div class="side ${which}"><span class="tag">${which.toUpperCase()}</span> <strong>${esc(s.source)}</strong>
    <h3>${esc(s.title)}</h3><div class="hint">${esc(s.facility || "")}</div><dl>${rows}</dl>
    ${s.description ? `<p class="hint">${esc(s.description)}</p>` : ""}</div>`;
}

function show(id) {
  current = pairs.find(p => p.pair_id === id);
  if (!current) return;
  const p = current, d = decisions[p.pair_id]?.decision;
  layer.clearLayers();
  const points = [];
  if (p.a.lat != null) points.push(L.circleMarker([p.a.lat, p.a.lon], {radius: 9, color: "#fff", weight: 2, fillColor: "#c0392b", fillOpacity: .9}).bindTooltip("A").addTo(layer).getLatLng());
  if (p.b.lat != null) points.push(L.circleMarker([p.b.lat, p.b.lon], {radius: 7, color: "#fff", weight: 2, fillColor: "#1f6fb2", fillOpacity: .9}).bindTooltip("B").addTo(layer).getLatLng());
  if (points.length) map.fitBounds(L.latLngBounds(points).pad(.6), {maxZoom: 18});
  const group = p.group ? `<p class="hint">Gruppo di ${p.group.size} schede da ${p.group.sources.length} fonti (${esc(p.group.sources.join(", "))}).
    <button type="button" id="group-btn">${groupOnly ? "Mostra tutte le coppie" : "Mostra solo questo gruppo"}</button>
    <button type="button" id="group-view">Confronta tutto il gruppo</button></p><div id="group-box"></div>` : "";
  document.getElementById("detail").innerHTML = `
    <p class="why"><strong>#${p.number} · fascia ${p.tier} · ${p.score} punti</strong> · ${esc(p.evidence.join(" · "))}${points.length < 2 ? " · una scheda è senza posizione" : ""}. Le celle evidenziate differiscono.</p>${group}
    ${proposalBox(p)}
    <div class="actions">
      <button type="button" id="accept">A · Accetta proposta</button>
      <button class="same${d === "same_service" ? " on" : ""}" data-d="same_service">1 · Stesso servizio</button>
      <button class="place${d === "same_place" ? " on" : ""}" data-d="same_place">2 · Stesso luogo, servizi diversi</button>
      <button class="diff-b${d === "different" ? " on" : ""}" data-d="different">3 · Diversi</button>
      <button data-d="unsure" class="${d === "unsure" ? "on" : ""}">0 · Non so</button>
    </div>
    <div class="compare">${side(p, "a")}${side(p, "b")}</div>`;
  document.querySelectorAll("[data-d]").forEach(btn => btn.addEventListener("click", () => decide(btn.dataset.d),{signal:scope.signal}));
  document.getElementById("accept").addEventListener("click", () => decide(p.proposal.decision, "proposal"),{signal:scope.signal});
  const gv = document.getElementById("group-view");
  if (gv) gv.addEventListener("click", () => renderGroup(p.group.id),{signal:scope.signal});
  const gb = document.getElementById("group-btn");
  if (gb) gb.addEventListener("click", () => { groupOnly = groupOnly ? null : p.group.id;
    document.getElementById("group-filter").textContent = groupOnly ? "Filtro: un gruppo" : ""; show(p.pair_id); },{signal:scope.signal});
  renderList();
}

function renderGroup(groupId) {
  const inGroup = pairs.filter(x => x.group && x.group.id === groupId);
  const members = {};
  inGroup.forEach(x => { members[x.a.id] = x.a; members[x.b.id] = x.b; });
  const list = Object.values(members).sort((x, y) => (x.source || "").localeCompare(y.source || ""));
  const fields = [["Fonte", "source"], ["Nome", "title"], ["Struttura", "facility"], ["Tipo", "type"], ["Bisogno", "need"],
                  ["Indirizzo", "address"], ["Contatti", "contacts"], ["Orari", "hours"], ["Posizione", "position"], ["Descrizione", "description"]];
  const text = v => Array.isArray(v) ? v.join(" · ") : (v || "");
  const rows = fields.map(([label, key]) => {
    const values = list.map(m => text(m[key]));
    const differ = new Set(values.filter(Boolean)).size > 1;
    return `<tr><th>${label}</th>${values.map(v => `<td class="${differ ? "diff" : ""}">${esc(v || "—")}</td>`).join("")}</tr>`;
  }).join("");
  const strong = inGroup.filter(x => x.tier === "A" || x.tier === "B");
  document.getElementById("group-box").innerHTML = `<div class="group-wrap"><table class="group-table">${rows}</table></div>
    <p class="hint">${list.length} schede, ${inGroup.length} coppie nel gruppo (${strong.length} in fascia A/B). Tutti i valori restano: la scheda unica li mostrerà fonte per fonte.</p>
    <p><button type="button" id="group-same">Tutte le coppie A/B del gruppo: stesso servizio</button></p>`;
  document.getElementById("group-same").addEventListener("click", () => {
    strong.forEach(x => { decisions[x.pair_id] = {decision: "same_service", a: x.a.locator, b: x.b.locator, a_source: x.a.source_code, b_source: x.b.source_code, at: new Date().toISOString(), via: "group"}; });
    save(); renderList(); renderGroup(groupId);
  },{signal:scope.signal});
  const layerPoints = list.filter(m => m.lat != null).map(m => L.circleMarker([m.lat, m.lon], {radius: 7, color: "#fff", weight: 2, fillColor: "#7a4fa0", fillOpacity: .85}).bindTooltip(m.source).addTo(layer).getLatLng());
  if (layerPoints.length) map.fitBounds(L.latLngBounds(layerPoints).pad(.6), {maxZoom: 18});
}

function needsText(list) {
  return (list || []).map(n => `${esc(n.need.replace(/_/g, " "))} <span title="${esc(n.basis)}">(${esc(n.basis)})</span>`).join(" · ");
}

function proposalBox(p) {
  const q = p.proposal;
  const primary = q.primary ? (q.primary.id === p.a.id ? "A" : "B") : null;
  return `<div class="proposal"><h4>Proposta: ${esc(q.label)} · <span class="conf-${esc(q.confidence)}">confidenza ${esc(q.confidence)}</span></h4>
    <ul>${q.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
    ${primary ? `<p>Scheda principale proposta: <strong>${primary}</strong> (${esc(q.primary.fields.join(", "))}).${q.enrich.length ? ` L'altra aggiunge: ${esc(q.enrich.join("; "))}.` : " L'altra non aggiunge campi."}</p>` : ""}
    ${q.group ? `<p>Servizio menzionato da <strong>${q.group.mentions} fonti</strong> (${esc(q.group.sources.join(", "))}), ${q.group.size} schede; principale proposta: ${esc(q.group.primary_title)}.</p>` : ""}
    <p class="needs">Bisogni proposti A: ${needsText(q.needs.a)}</p><p class="needs">Bisogni proposti B: ${needsText(q.needs.b)}</p></div>`;
}

function decide(decision, via) {
  if (!current) return;
  decisions[current.pair_id] = {decision, a: current.a.locator, b: current.b.locator, a_source: current.a.source_code, b_source: current.b.source_code, at: new Date().toISOString(),
    ...(via ? {via, proposal: `${current.proposal.decision}/${current.proposal.confidence}`} : {})};
  save();
  step(1);
}

function step(delta) {
  const list = visible();
  const i = current ? list.findIndex(p => p.pair_id === current.pair_id) : -1;
  const next = list[Math.min(list.length - 1, Math.max(0, i + delta))] || list[0];
  if (next) show(next.pair_id); else renderList();
}

function renderExport() {
  const lines = Object.entries(decisions).map(([id, d]) => {
    const p = pairs.find(x => x.pair_id === id);
    return `${id}\t#${p ? p.number : "?"}\t${d.decision}\t${d.a_source}:${d.a}\t${d.b_source}:${d.b}\t${d.via || "manual"}`;
  });
  document.getElementById("export").value = lines.length ? "EGI-DEDUP v1\n" + lines.join("\n") : "";
}

document.getElementById("copy").addEventListener("click", async () => {
  const text = document.getElementById("export").value;
  try { await navigator.clipboard.writeText(text); scope.check();document.getElementById("copied").textContent = "Copiato."; }
  catch (_e) { if(scope.signal.aborted)return;document.getElementById("export").select(); document.getElementById("copied").textContent = "Seleziona e copia a mano."; }
},{signal:scope.signal});
document.querySelectorAll(".filters input, .filters select").forEach(x => x.addEventListener("change", renderList,{signal:scope.signal}));
document.getElementById("accept-high").addEventListener("click", () => {
  const todo = visible().filter(p => !decisions[p.pair_id] && p.proposal.confidence === "alta");
  if (!todo.length || !confirm(`Registrare come tue ${todo.length} proposte ad alta confidenza tra le coppie mostrate?`)) return;
  const at = new Date().toISOString();
  todo.forEach(p => { decisions[p.pair_id] = {decision: p.proposal.decision, a: p.a.locator, b: p.b.locator, a_source: p.a.source_code, b_source: p.b.source_code, at,
    via: "proposal-bulk", proposal: `${p.proposal.decision}/${p.proposal.confidence}`}; });
  save(); renderList(); if (current) show(current.pair_id);
},{signal:scope.signal});
document.addEventListener("keydown", e => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  const map = {"1": "same_service", "2": "same_place", "3": "different", "0": "unsure"};
  if (map[e.key]) decide(map[e.key]);
  if ((e.key === "a" || e.key === "A") && current) decide(current.proposal.decision, "proposal");
  if (e.key === "j" || e.key === "J") step(1);
  if (e.key === "k" || e.key === "K") step(-1);
},{signal:scope.signal});

http.request("/api/preview/review/overlaps").then(r => r.json()).then(data => {
  pairs = data.pairs;
  const names = {};
  pairs.forEach(p => { names[p.a.source_code] = p.a.source_name || p.a.source; names[p.b.source_code] = p.b.source_name || p.b.source; });
  document.getElementById("source-filter").insertAdjacentHTML("beforeend",
    Object.entries(names).sort((x, y) => x[1].localeCompare(y[1])).map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join(""));
  renderList();
  const first = visible().find(p => !decisions[p.pair_id]) || visible()[0];
  if (first) show(first.pair_id);
}).catch(() => { if(!scope.signal.aborted)document.getElementById("progress").textContent = "Dati non disponibili."; });
}
