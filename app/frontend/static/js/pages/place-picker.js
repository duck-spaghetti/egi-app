/* Moderation: pick a location's point on a map. The latitude and longitude fields
   work without it; the map only fills them in and follows what is typed. */
(function () {
  "use strict";
  if (typeof L === "undefined") return;
  const ROME = [41.9, 12.5];
  document.querySelectorAll("[data-place-picker]").forEach(function (box) {
    const form = box.closest("form");
    const latitude = form.querySelector('[name="location_latitude"]');
    const longitude = form.querySelector('[name="location_longitude"]');
    if (!latitude || !longitude) return;
    box.hidden = false;
    const read = function () {
      const lat = parseFloat(latitude.value.replace(",", "."));
      const lon = parseFloat(longitude.value.replace(",", "."));
      return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    };
    const start = read();
    const map = L.map(box).setView(start || ROME, start ? 17 : 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      referrerPolicy: "strict-origin",
    }).addTo(map);
    let marker = start ? L.circleMarker(start, { radius: 8 }).addTo(map) : null;
    const place = function (point) {
      if (marker) marker.setLatLng(point);
      else marker = L.circleMarker(point, { radius: 8 }).addTo(map);
    };
    map.on("click", function (event) {
      latitude.value = event.latlng.lat.toFixed(6);
      longitude.value = event.latlng.lng.toFixed(6);
      place(event.latlng);
    });
    [latitude, longitude].forEach(function (input) {
      input.addEventListener("change", function () {
        const point = read();
        if (point) { place(point); map.setView(point, Math.max(map.getZoom(), 16)); }
      });
    });
    const details = box.closest("details");
    if (details) details.addEventListener("toggle", function () { map.invalidateSize(); });
  });
})();
