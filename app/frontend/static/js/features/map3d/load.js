/** Load the 3D mode's vendored libraries (MapLibre GL JS module, PMTiles reader, stylesheet).
 * Called only when the page starts in 3D mode: the current map never requests them.
 */
export const VENDOR = {
  maplibre: "/static/vendor/maplibre-gl-6.19.0/maplibre-gl.mjs",
  css: "/static/vendor/maplibre-gl-6.19.0/maplibre-gl.css",
  pmtiles: "/static/vendor/pmtiles-4.3.0/pmtiles.js",
};

function script(doc, src) {
  return new Promise((resolve, reject) => {
    const el = doc.createElement("script");
    el.src = src; el.onload = resolve; el.onerror = () => reject(Error(`Cannot load ${src}`));
    doc.head.append(el);
  });
}

export async function loadMap3dLibraries(doc = document, importer = url => import(url), host = globalThis) {
  const link = doc.createElement("link");
  link.rel = "stylesheet"; link.href = VENDOR.css; doc.head.append(link);
  const [maplibre] = await Promise.all([importer(VENDOR.maplibre), script(doc, VENDOR.pmtiles)]);
  if (!host.pmtiles?.Protocol) throw Error("PMTiles reader unavailable");
  return {maplibre, pmtiles: host.pmtiles};
}
