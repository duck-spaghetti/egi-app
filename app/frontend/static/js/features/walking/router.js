/** Indicative pedestrian graph from simplified basemap roads; no server or visitor state.
 * Repairs tile seams within 4 m and free T-junction ends within 6 m. Main-network
 * snapping is capped at 100 m. This is not an accessibility or turn-by-turn router. */
const Z = 15, WALK_KMH = 4.5, MAX_KM = 3;
const NO_WALK = new Set(['highway', 'motorway', 'motorway_link', 'trunk', 'trunk_link', 'rail', 'railway', 'ferry']);
const R = 6371008.8;
const rad = d => d * Math.PI / 180;
function dist([a, b], [c, d]) {
  const x = rad(c - a) * Math.cos(rad((b + d) / 2)), y = rad(d - b);
  return Math.hypot(x, y) * R;
}
function azimuth([a, b], [c, d]) {
  const x = rad(c - a) * Math.cos(rad((b + d) / 2)), y = rad(d - b);
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}
const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const tileY = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2 * 2 ** z);

export async function loadRoads(archive, a, b, {VectorTile, Pbf}, signal) {
  const pad = 0.004;
  const w = Math.min(a[0], b[0]) - pad, e = Math.max(a[0], b[0]) + pad;
  const s = Math.min(a[1], b[1]) - pad, n = Math.max(a[1], b[1]) + pad;
  const lines = [];
  const jobs = [];
  for (let x = tileX(w, Z); x <= tileX(e, Z); x++)
    for (let y = tileY(n, Z); y <= tileY(s, Z); y++)
      jobs.push(archive.getZxy(Z, x, y).then(r => {
        if (!r) return;
        const layer = new VectorTile(new Pbf(r.data)).layers.roads;
        if (!layer) return;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          if (NO_WALK.has(f.properties.kind)) continue;
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const g = f.toGeoJSON(x, y, Z).geometry;
          if (!['LineString','MultiLineString'].includes(g.type)) continue;
          for (const part of g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]) lines.push({ part, kind: f.properties.kind });
        }
      }));
  await Promise.all(jobs);
  return lines;
}
export function buildGraph(lines) {
  const key = ([lon, lat]) => `${Math.round(lon * 1e5)},${Math.round(lat * 1e5)}`;
  const nodes = new Map(), adj = new Map();
  const node = p => { const k = key(p); if (!nodes.has(k)) { nodes.set(k, p); adj.set(k, []); } return k; };
  const link = (k1, k2, d) => { adj.get(k1).push([k2, d]); adj.get(k2).push([k1, d]); };
  for (const { part, kind } of lines)
    if (!NO_WALK.has(kind)) for (let i = 1; i < part.length; i++) {
      const k1 = node(part[i - 1]), k2 = node(part[i]);
      if (k1 !== k2) link(k1, k2, dist(part[i - 1], part[i]));
    }
  const cell = new Map(), C = 4e-5;
  for (const [k, p] of nodes) {
    const c = `${Math.floor(p[0] / C)},${Math.floor(p[1] / C)}`;
    (cell.get(c) || cell.set(c, []).get(c)).push(k);
  }
  for (const [k, p] of nodes) {
    const cx = Math.floor(p[0] / C), cy = Math.floor(p[1] / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const k2 of cell.get(`${cx + i},${cy + j}`) || [])
        if (k2 > k) { const d = dist(p, nodes.get(k2)); if (d < 4) link(k, k2, d); }
  }
  const segs = new Map(), S = 1e-4;
  const segCells = (a, b) => { const out = [];
    for (let x = Math.floor(Math.min(a[0], b[0]) / S); x <= Math.floor(Math.max(a[0], b[0]) / S); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / S); y <= Math.floor(Math.max(a[1], b[1]) / S); y++) out.push(`${x},${y}`);
    return out; };
  for (const [k1, list] of adj) for (const [k2] of list) if (k1 < k2) {
    const a = nodes.get(k1), b = nodes.get(k2);
    for (const c of segCells(a, b)) (segs.get(c) || segs.set(c, []).get(c)).push([k1, k2]);
  }
  for (const [k, p] of nodes) {
    if (adj.get(k).length > 1) continue;
    let best = null;
    const cx = Math.floor(p[0] / S), cy = Math.floor(p[1] / S);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const [k1, k2] of segs.get(`${cx + i},${cy + j}`) || []) {
        if (k1 === k || k2 === k) continue;
        const a = nodes.get(k1), b = nodes.get(k2);
        const kx = Math.cos(rad(p[1])), ax = (b[0] - a[0]) * kx, ay = b[1] - a[1];
        const t = Math.max(0, Math.min(1, (((p[0] - a[0]) * kx) * ax + (p[1] - a[1]) * ay) / ((ax * ax + ay * ay) || 1e-18)));
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = dist(p, q);
        if (d < 6 && (!best || d < best.d)) best = { d, q, k1, k2, a, b };
      }
    if (best) { link(k, best.k1, best.d + dist(best.q, best.a)); link(k, best.k2, best.d + dist(best.q, best.b)); }
  }
  return { nodes, adj };
}
function component(adj, start) {
  const seen = new Set([start]), stack = [start];
  while (stack.length) for (const [v] of adj.get(stack.pop())) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  return seen;
}
function mainNetwork(nodes, adj) {
  let best = new Set(); const visited = new Set();
  for (const k of nodes.keys()) if (!visited.has(k)) { const c = component(adj, k); c.forEach(v => visited.add(v)); if (c.size > best.size) best = c; }
  return best;
}
function nearest(nodes, p, allowed) {
  let best = null, bd = Infinity;
  for (const [k, q] of nodes) { if (allowed && !allowed.has(k)) continue; const d = dist(p, q); if (d < bd) { bd = d; best = k; } }
  return best;
}
export function shortest({ nodes, adj }, from, to) {
  if (!from || !to) return null;
  const d = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]], done = new Set();
  const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [du, u] = pop();
    if (done.has(u)) continue; done.add(u);
    if (u === to) break;
    for (const [v, w] of adj.get(u)) { const nd = du + w; if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); prev.set(v, u); push([nd, v]); } }
  }
  if (!d.has(to)) return null;
  const path = [to]; while (path[0] !== from) path.unshift(prev.get(path[0]));
  return path.map(k => nodes.get(k));
}
/** Short indicative route on local z15 tiles; dependencies and cancellation are explicit. */
export async function walkingRoute(archive, from, to, libraries, signal) {
  if (dist(from, to) > MAX_KM * 1000) throw new Error('too_far');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const g = buildGraph(await loadRoads(archive, from, to, libraries, signal));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const net = mainNetwork(g.nodes, g.adj);
  const start = nearest(g.nodes, from, net), end = nearest(g.nodes, to, net);
  if (!start || !end || dist(from,g.nodes.get(start))>100 || dist(to,g.nodes.get(end))>100) throw new Error('no_route');
  const path = shortest(g, start, end);
  if (!path) throw new Error('no_route');
  return [from, ...path, to];
}
export {dist as distance, azimuth};
