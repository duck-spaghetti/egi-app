/** Pure display, search-text and distance operations reused by actual features. */
export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}


export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


export function normalizeLang(value) {
  return String(value || "it").split("-")[0].toLowerCase();
}


export function folded(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("it");
}


export function categoryCaption(value) {
  // Sentence case: taxonomy labels are written as phrases ("Vestiti e coperte").
  const text = String(value || "Servizio").replaceAll("_", " ");
  return text.charAt(0).toLocaleUpperCase("it") + text.slice(1);
}
