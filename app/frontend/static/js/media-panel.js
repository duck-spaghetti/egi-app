/* "Foto" section of a service card, provider-agnostic.
 *
 * MediaPanel.render(serviceId, container) asks /api/preview/media when the card opens
 * (never before) and shows the chosen representation: organisation or user photos
 * as images, Mapillary through its own viewer loaded only on request, and Google
 * Street View as an on-request link. Attribution and a link to the source are always
 * shown; sensitive services and remote/itinerant services get no image.
 */
const MediaPanel = (() => {
  const PROVIDER = {
    organization: "Foto dell’organizzazione",
    mapillary: "Mapillary",
    user: "Foto inviata da un utente",
  };
  const EXCLUDED = {
    protected_address: "Foto non mostrate: indirizzo protetto.",
    sensitive_audience: "Foto non mostrate per tutela delle persone che si rivolgono al servizio.",
    sensitive_service: "Foto non mostrate per tutela del servizio.",
    no_fixed_site: "",
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }

  function attribution(item) {
    if (item.provider === "mapillary") {
      return `Immagine <a href="${esc(item.page_url)}" target="_blank" rel="noopener">Mapillary</a>${item.author ? ` di ${esc(item.author)}` : ""} · ${esc(item.licence)}${item.distance_m != null ? ` · scattata a ${Math.round(item.distance_m)} m` : ""}${item.age_years != null ? `, ${item.age_years} anni fa` : ""}`;
    }
    return `${esc(PROVIDER[item.provider] || item.provider)}${item.author ? ` · ${esc(item.author)}` : ""}${item.licence ? ` · ${esc(item.licence)}` : ""}`;
  }

  function figure(item, index) {
    const badge = item.is_360 ? '<span class="media-badge">360°</span>' : "";
    if (item.provider === "mapillary") {
      return `<figure class="media-figure" data-index="${index}">${badge}<button type="button" class="media-load" data-embed="${esc(item.embed_url)}">Mostra foto${item.is_360 ? " 360°" : ""} · Mapillary</button><figcaption>${attribution(item)}</figcaption></figure>`;
    }
    return `<figure class="media-figure" data-index="${index}">${badge}<img src="${esc(item.url)}" alt="${esc(item.caption || "Ingresso del servizio")}" loading="lazy"><figcaption>${attribution(item)}</figcaption></figure>`;
  }

  function html(data) {
    if (!data.enabled) return "";
    if (data.excluded) return EXCLUDED[data.excluded] ? `<section class="detail-section media-section"><h3>Foto</h3><p class="source-note">${esc(EXCLUDED[data.excluded])}</p></section>` : "";
    const items = [data.primary, ...(data.gallery || [])].filter(Boolean);
    const main = items.length ? figure(items[0], 0) : '<p class="source-note">Nessuna foto disponibile per questo servizio.</p>';
    const more = items.length > 1 ? `<details class="media-gallery"><summary>Altre ${items.length - 1} foto</summary>${items.slice(1).map((item, i) => figure(item, i + 1)).join("")}</details>` : "";
    const onRequest = (data.on_request || []).map(o => `<p><a class="btn media-request" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.label)}</a><br><small class="source-note">${esc(o.note)}</small></p>`).join("");
    return `<section class="detail-section media-section"><h3>Foto</h3>${main}${more}${onRequest}<p class="source-note">Le foto aiutano a riconoscere l’ingresso; possono non essere aggiornate.</p></section>`;
  }

  /** Fetch and render into container; returns the response (or null when unavailable). */
  async function render(serviceId, container) {
    try {
      const response = await fetch(`/api/preview/media?service=${encodeURIComponent(serviceId)}`);
      if (!response.ok) return null;
      const data = await response.json();
      if (!container.isConnected) return data;
      container.innerHTML = html(data);
      container.querySelectorAll(".media-load").forEach(button => button.addEventListener("click", () => {
        button.outerHTML = `<iframe class="media-embed" title="Foto Mapillary" src="${esc(button.dataset.embed)}" allowfullscreen></iframe>`;
      }));
      return data;
    } catch (_error) {
      return null; // photos are optional; the card works without them
    }
  }

  return {render, html};
})();

if (typeof module !== "undefined") module.exports = MediaPanel;
