// MediaPanel.html: attribution, lazy Mapillary viewer, exclusion and fallback text.
const assert = require("assert");
const MediaPanel = require("../app/frontend/static/js/media-panel.js");

const mly = {provider: "mapillary", image_id: "9", is_360: true, author: "anna", licence: "CC BY-SA 4.0",
  distance_m: 12.4, age_years: 2, embed_url: "https://www.mapillary.com/embed?image_key=9&style=photo",
  page_url: "https://www.mapillary.com/app/?pKey=9&focus=photo"};
let html = MediaPanel.html({enabled: true, excluded: null, primary: mly, gallery: [],
  on_request: [{provider: "street_view", label: "Apri Street View (Google)", url: "https://www.google.com/maps/@?api=1", note: "n"}]});
assert(html.includes("media-load"), "Mapillary viewer waits for a click");
assert(!html.includes("<iframe"), "no iframe before the request");
assert(html.includes("360°") && html.includes("anna") && html.includes("CC BY-SA 4.0"));
assert(html.includes("Apri Street View (Google)"));
html = MediaPanel.html({enabled: true, excluded: "sensitive_service"});
assert(html.includes("tutela del servizio") && !html.includes("Street View"));
assert.strictEqual(MediaPanel.html({enabled: false}), "");
html = MediaPanel.html({enabled: true, excluded: null, primary: null, gallery: [], on_request: []});
assert(html.includes("Nessuna foto disponibile"));
console.log("media panel ok");
