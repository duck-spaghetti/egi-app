// MediaPanel.html: attribution, lazy images, exclusion and fallback text.
const assert = require("assert");
const MediaPanel = require("../app/frontend/static/js/media-panel.js");

const org = {provider: "organization", url: "/media/a.jpg", is_360: true, author: "anna", licence: "CC BY 4.0"};
let html = MediaPanel.html({enabled: true, excluded: null, primary: org, gallery: [],
  on_request: [{provider: "street_view", label: "Apri Street View (Google)", url: "https://www.google.com/maps/@?api=1", note: "n"}]});
assert(html.includes('loading="lazy"'), "images load lazily");
assert(html.includes("360°") && html.includes("anna") && html.includes("CC BY 4.0"));
assert(html.includes("Apri Street View (Google)"));
html = MediaPanel.html({enabled: true, excluded: "sensitive_service"});
assert(html.includes("tutela del servizio") && !html.includes("Street View"));
assert.strictEqual(MediaPanel.html({enabled: false}), "");
html = MediaPanel.html({enabled: true, excluded: null, primary: null, gallery: [], on_request: []});
assert(html.includes("Nessuna foto disponibile"));
console.log("media panel ok");
