/** EGI map style for the 3D mode, on the slim Rome basemap of the active 3D data set.
 *
 * egiStyle(base) returns a MapLibre style whose sources and glyphs are files of the active
 * data set version (base = "/map3d/<version>"). Only what helps to find one's way: greens
 * with outlines and names, squares, water with a sunken Tiber, roads, railways, buildings
 * and labels by importance. Palette from the app tokens. Layers added by the 3D components
 * (buildings, landmarks, bridges, fountains, trees) are in layers3d.
 */
export const COLORS = {
  land: "#f4f1ea", water: "#b8d4dd", waterLine: "#9cc3cf", hospital: "#f3dfdc", school: "#ece6d6",
  road: "#ffffff", roadCase: "#ddd4c2", major: "#fffaf0", majorCase: "#cdbf9f", highway: "#f6e7c4", highwayCase: "#c9ac70",
  rail: "#a59f94", building: "#e5dfd2", buildingLine: "#d3cbbb",
  park: "#c2dda0", wood: "#a9ca86", grass: "#d5e7bf", cemetery: "#cfdcbd", greenEdge: "#8fb064", greenLabel: "#3f6b2a",
  paving: "#ede4d2", pavingEdge: "#ddd0b8", label: "#4a4a4a", labelSoft: "#7a7366", halo: "#fbf9f3", waterLabel: "#4f7f8f",
  landmarkLabel: "#6b4f2a",
};

export const BASEMAP = "basemap";
const NAME = ["coalesce", ["get", "name:it"], ["get", "name"]];
const GREENS = ["park", "garden", "forest", "wood", "grass", "meadow", "grassland", "nature_reserve", "cemetery",
  "golf_course", "recreation_ground", "playground", "scrub", "village_green"];

/** Opacity or height rising from 0 at z0 to value at z1. */
export const fade = (value, z0, z1) => ["interpolate", ["linear"], ["zoom"], z0, 0, z1, value];
const roadWidth = (minor, major) => ["interpolate", ["exponential", 1.6], ["zoom"], 12, minor, 18, major];

/** Basemap layers, bottom to top, before the 3D layers. */
export function baseLayers(C = COLORS) {
  const src = BASEMAP;
  return [
    {id: "background", type: "background", paint: {"background-color": C.land}},
    {id: "green", type: "fill", source: src, "source-layer": "landuse", filter: ["in", ["get", "kind"], ["literal", GREENS]],
      paint: {"fill-color": ["match", ["get", "kind"], ["forest", "wood", "nature_reserve"], C.wood,
        ["grass", "meadow", "grassland", "scrub"], C.grass, "cemetery", C.cemetery, C.park]}},
    {id: "green-edge", type: "line", source: src, "source-layer": "landuse", minzoom: 13,
      filter: ["in", ["get", "kind"], ["literal", ["park", "garden", "forest", "wood", "nature_reserve", "village_green"]]],
      paint: {"line-color": C.greenEdge, "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.6, 17, 1.6]}},
    {id: "hospital", type: "fill", source: src, "source-layer": "landuse", minzoom: 13,
      filter: ["in", ["get", "kind"], ["literal", ["hospital", "clinic"]]], paint: {"fill-color": C.hospital}},
    {id: "school", type: "fill", source: src, "source-layer": "landuse", minzoom: 13,
      filter: ["in", ["get", "kind"], ["literal", ["school", "university", "college", "kindergarten"]]], paint: {"fill-color": C.school}},
    {id: "pedestrian", type: "fill", source: src, "source-layer": "landuse", minzoom: 13,
      filter: ["in", ["get", "kind"], ["literal", ["pedestrian", "platform"]]],
      paint: {"fill-color": C.paving, "fill-outline-color": C.pavingEdge, "fill-opacity": fade(1, 13, 14)}},
    {id: "water", type: "fill", source: src, "source-layer": "water", filter: ["==", ["geometry-type"], "Polygon"],
      paint: {"fill-color": C.water}},
    // Sunken river: a blurred shadow along the inner edge of the water, wider when close.
    {id: "water-shadow", type: "line", source: src, "source-layer": "water", minzoom: 13,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["in", ["get", "kind"], ["literal", ["river", "water", "riverbank"]]]],
      paint: {"line-color": "#4d7383", "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.15, 16, 0.35],
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 8, 18, 22],
        "line-offset": ["interpolate", ["linear"], ["zoom"], 13, 1, 16, 4, 18, 11],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 13, 1, 16, 5, 18, 14]}},
    {id: "waterway", type: "line", source: src, "source-layer": "water", filter: ["==", ["geometry-type"], "LineString"],
      paint: {"line-color": C.waterLine, "line-width": ["match", ["get", "kind"], "river", 3, 1]}},
    {id: "rail", type: "line", source: src, "source-layer": "roads", minzoom: 11,
      filter: ["all", ["==", ["get", "kind"], "rail"], ["!", ["to-boolean", ["get", "is_tunnel"]]]],
      paint: {"line-color": C.rail, "line-width": 1.4, "line-dasharray": [3, 2]}},
    {id: "path", type: "line", source: src, "source-layer": "roads", minzoom: 15,
      filter: ["==", ["get", "kind"], "path"], paint: {"line-color": "#b9ae98", "line-width": 1, "line-dasharray": [2, 1.5]}},
    {id: "minor-case", type: "line", source: src, "source-layer": "roads", minzoom: 13,
      filter: ["==", ["get", "kind"], "minor_road"], layout: {"line-cap": "round", "line-join": "round"},
      paint: {"line-color": C.roadCase, "line-width": roadWidth(1.5, 16)}},
    {id: "minor", type: "line", source: src, "source-layer": "roads", minzoom: 13,
      filter: ["==", ["get", "kind"], "minor_road"], layout: {"line-cap": "round", "line-join": "round"},
      paint: {"line-color": C.road, "line-width": roadWidth(0.8, 13)}},
    {id: "major-case", type: "line", source: src, "source-layer": "roads", minzoom: 9,
      filter: ["in", ["get", "kind"], ["literal", ["major_road", "highway"]]], layout: {"line-cap": "round", "line-join": "round"},
      paint: {"line-color": ["match", ["get", "kind"], "highway", C.highwayCase, C.majorCase], "line-width": roadWidth(2.5, 24)}},
    {id: "major", type: "line", source: src, "source-layer": "roads", minzoom: 9,
      filter: ["in", ["get", "kind"], ["literal", ["major_road", "highway"]]], layout: {"line-cap": "round", "line-join": "round"},
      paint: {"line-color": ["match", ["get", "kind"], "highway", C.highway, C.major], "line-width": roadWidth(1.5, 20)}},
    {id: "buildings", type: "fill", source: src, "source-layer": "buildings", minzoom: 13,
      filter: ["==", ["get", "kind"], "building"],
      paint: {"fill-color": C.building, "fill-outline-color": C.buildingLine, "fill-opacity": fade(1, 13, 14)}},
  ];
}

/** Labels, drawn above every other layer. */
export function labelLayers(C = COLORS) {
  const src = BASEMAP;
  return [
    {id: "water-label", type: "symbol", source: src, "source-layer": "water", minzoom: 13,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "kind"], "river"]],
      layout: {"symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 13},
      paint: {"text-color": C.waterLabel, "text-halo-color": C.halo, "text-halo-width": 1.2}},
    {id: "road-label", type: "symbol", source: src, "source-layer": "roads", minzoom: 14,
      filter: ["all", ["has", "name"], ["!", ["to-boolean", ["get", "is_bridge"]]],
        ["any", ["in", ["get", "kind"], ["literal", ["major_road", "highway"]]],
          ["all", ["==", ["get", "kind"], "minor_road"], [">=", ["zoom"], 16]]]],
      layout: {"symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Regular"], "symbol-spacing": 400,
        "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 18, 14]},
      paint: {"text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.5}},
    {id: "park-label", type: "symbol", source: src, "source-layer": "pois", minzoom: 13,
      filter: ["all", ["has", "name"], [">=", ["zoom"], ["+", ["get", "min_zoom"], 1]],
        ["in", ["get", "kind"], ["literal", ["park", "garden", "nature_reserve", "zoo"]]]],
      layout: {"text-field": NAME, "text-font": ["Noto Sans Italic"], "text-max-width": 8,
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 11, 17, 14]},
      paint: {"text-color": C.greenLabel, "text-halo-color": C.halo, "text-halo-width": 1.4}},
    {id: "fountain-label", type: "symbol", source: src, "source-layer": "pois", minzoom: 18,
      filter: ["all", ["==", ["get", "kind"], "fountain"], ["has", "name"]],
      layout: {"text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top"},
      paint: {"text-color": C.waterLabel, "text-halo-color": C.halo, "text-halo-width": 1.2}},
    {id: "monument-label", type: "symbol", source: src, "source-layer": "pois", minzoom: 15,
      filter: ["all", ["has", "name"], [">=", ["zoom"], ["+", ["get", "min_zoom"], 1]],
        ["in", ["get", "kind"], ["literal", ["monument", "archaeological_site", "castle", "attraction"]]]],
      layout: {"text-field": NAME, "text-font": ["Noto Sans Medium"], "text-size": 12, "text-max-width": 9, "text-padding": 8},
      paint: {"text-color": C.landmarkLabel, "text-halo-color": C.halo, "text-halo-width": 1.6}},
    {id: "poi-label", type: "symbol", source: src, "source-layer": "pois", minzoom: 16,
      filter: ["all", ["has", "name"], ["in", ["get", "kind"], ["literal", ["pharmacy", "hospital", "clinic", "police", "post_office"]]]],
      layout: {"text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 11, "text-max-width": 8, "text-padding": 8},
      paint: {"text-color": C.labelSoft, "text-halo-color": C.halo, "text-halo-width": 1.2}},
    {id: "place-label", type: "symbol", source: src, "source-layer": "places",
      filter: ["all", ["in", ["get", "kind"], ["literal", ["locality", "neighbourhood", "macrohood"]]], [">=", ["zoom"], ["get", "min_zoom"]]],
      layout: {"text-field": NAME, "text-font": ["Noto Sans Medium"], "text-transform": "uppercase", "text-letter-spacing": 0.06,
        "text-size": ["match", ["get", "kind"], "locality", 15, 12]},
      paint: {"text-color": C.labelSoft, "text-halo-color": C.halo, "text-halo-width": 1.5}},
  ];
}

/** Sources and layers of the 3D components; empty until they are added. */
export function layers3d() { return {sources: {}, layers: [], labels: []}; }

/** Complete style for the active data set version. */
export function egiStyle(base) {
  const extra = layers3d(base);
  return {
    version: 8,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      [BASEMAP]: {type: "vector", url: `pmtiles://${base}/basemap.pmtiles`,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Protomaps'},
      ...extra.sources,
    },
    layers: [...baseLayers(), ...extra.layers, ...labelLayers(), ...extra.labels],
  };
}
