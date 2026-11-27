/** Choose between the current map and the optional 3D mode, and carry state across the switch.
 *
 * The mode is chosen when the page starts: `?vista=3d` (or `2d`) in the URL, else the
 * choice remembered on this device (localStorage), else the current map. The 3D mode is
 * available only with WebGL2 and an active 3D data set. Switching reloads the page; the
 * URL carries at most the view, the language and the selected service, while filters,
 * search text and the reference point cross the reload in sessionStorage (this tab only,
 * read once). Search text and position never enter the URL (ADR 0007).
 */
export const VIEW_KEY = "egi.map.view";
export const HANDOFF_KEY = "egi.map.handoff";

/** True when the browser can create a WebGL2 context. */
export function hasWebGL2(doc = globalThis.document) {
  try { return Boolean(doc?.createElement("canvas").getContext?.("webgl2")); } catch { return false; }
}

/** {mode, available, reason}: reason is "webgl" or "data" when the 3D mode is unavailable. */
export function viewMode({search = "", storage = null, context = {}, webgl2 = false} = {}) {
  const reason = !webgl2 ? "webgl" : !context.map3d ? "data" : null;
  const asked = new URLSearchParams(search).get("vista");
  let wanted = asked === "3d" || asked === "2d" ? asked : null;
  if (!wanted) { try { wanted = storage?.getItem(VIEW_KEY) || null; } catch { wanted = null; } }
  return {mode: wanted === "3d" && !reason ? "3d" : "2d", available: !reason, reason};
}

/** The page state that crosses a switch: filters, search text, reference point. */
export function handoffState(state) {
  const f = state.filters;
  return {filters: {...f, cats: [...f.cats], offersOff: [...f.offersOff]}, userLoc: state.userLoc || null,walkTo:state.pendingWalkId||null};
}

/** Remember the device choice and keep the handoff for the next page in this tab. */
export function saveHandoff({local, session}, view, state) {
  try { local?.setItem(VIEW_KEY, view); } catch { /* storage may be disabled */ }
  try { session?.setItem(HANDOFF_KEY, JSON.stringify(handoffState(state))); } catch { /* idem */ }
}

/** Read and remove the handoff (once), or null. */
export function takeHandoff(session) {
  try {
    const raw = session?.getItem(HANDOFF_KEY);
    session?.removeItem(HANDOFF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch { return null; }
}

/** Apply a handoff to the page state (filters as Sets again). */
export function applyHandoff(state, data) {
  if (!data) return;
  const f = data.filters || {};
  for (const [key, value] of Object.entries(f)) {
    if (!(key in state.filters)) continue;
    state.filters[key] = key === "cats" || key === "offersOff" ? new Set(Array.isArray(value) ? value : []) : value;
  }
  if(typeof data.walkTo==="string"&&data.walkTo.length<100)state.pendingWalkId=data.walkTo;
  const loc = data.userLoc;
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) state.userLoc = {lat: loc.lat, lng: loc.lng, label: String(loc.label || "")};
}

/** URL of the map page in the other view: only view, language, city and selected service. */
export function switchUrl(location, {view, lang, service}) {
  const current = new URLSearchParams(location.search);
  const next = new URLSearchParams();
  if (current.get("city_id")) next.set("city_id", current.get("city_id"));
  if (lang) next.set("lang", lang);
  next.set("vista", view);
  if (service !== null && service !== undefined && service !== "") next.set("servizio", String(service));
  return `${location.pathname}?${next}`;
}
