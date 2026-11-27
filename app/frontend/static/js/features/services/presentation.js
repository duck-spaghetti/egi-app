import {escapeHtml,categoryCaption,folded,distanceKm,normalizeLang} from "../../format.js";

/** createPresentation owns its behavior; dependencies and snapshots are explicit. */
export function createPresentation({snapshot, context, translate}) {

function t(key, params = {}, fallback = "") {
  return translate(key, params, fallback);
}

function normalizeExternalHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(raw)) return `https://${raw}`;
  return null;
}

function normalizePublicService(service) {
  const place = service.place || {};
  const point = pointLatLng(place.geometry);
  const primarySource = (service.sources || []).find((source) => source.is_primary)
    || (service.sources || [])[0]
    || (place.sources || [])[0]
    || null;

  return {
    id: service.id,
    place_id: service.place_id || place.id,
    category_id: service.category?.id || service.category_id,
    subcategory_id: service.subcategory?.id || service.subcategory_id,
    title: service.service_title || service.name || place.name || "Servizio",
    notes: service.description || "",
    cost_tag: service.cost_tag,
    cost_note: service.cost_note,
    valid_from: service.valid_from,
    valid_until: service.valid_until,
    address: place.is_protected_address ? t("common.not_available") : place.address,
    latitude: point.lat,
    longitude: point.lng,
    category: service.category || null,
    subcategory: service.subcategory || null,
    subcategories: service.subcategories || [],
    hours: service.hours || [],
    contacts: service.contacts || [],
    place_contacts: place.contacts || [],
    tags: service.tags || [],
    sources: service.sources || [],
    place_sources: place.sources || [],
    source_url: primarySource?.source_url || null,
    original_language: null,
    translations: [],
    raw: service,
  };
}

function mergeServiceCategories(categories, services) {
  const byId = new Map(categories.map((category) => [Number(category.id), category]));
  services.forEach((service) => {
    const embedded = normalizeEmbeddedCategory(service.category);
    if (!embedded) return;

    const current = byId.get(Number(embedded.id));
    byId.set(Number(embedded.id), {
      ...embedded,
      ...current,
      label: embedded.label || current?.label || embedded.slug,
    });
  });
  return Array.from(byId.values()).sort((a, b) => (a.sort_order || 100) - (b.sort_order || 100));
}

function normalizeEmbeddedCategory(category) {
  if (!category || category.id == null) return null;
  return {
    id: Number(category.id),
    area_id: null,
    slug: category.slug,
    label: category.label || category.slug,
    color: category.color,
    icon_path: category.icon_path,
    sort_order: category.sort_order || 100,
  };
}

function normalizeArea(area) {
  const center = pointLatLng(area.default_center);
  const bbox = bboxFromPolygon(area.geometry_bbox);
  return {
    id: area.id,
    slug: area.slug,
    name: area.name,
    countryCode: area.country_code,
    isDefault: area.slug === "roma" || area.name.toLowerCase() === "roma",
    centerLat: center.lat,
    centerLng: center.lng,
    bboxNorth: bbox.north,
    bboxSouth: bbox.south,
    bboxEast: bbox.east,
    bboxWest: bbox.west,
  };
}

function normalizeCategory(category) {
  return {
    id: category.id,
    area_id: category.area_id,
    slug: category.slug,
    label: category.label || category.slug,
    color: category.color,
    icon_path: category.icon_path,
    sort_order: category.sort_order,
  };
}

function applyCategoryLabels(categories) {
  const languageId = snapshot().languages.find((language) => normalizeLang(language.code) === normalizeLang(snapshot().lang))?.id
    || snapshot().languages.find((language) => normalizeLang(language.code) === "it")?.id
    || null;
  return categories.map((category) => {
    const translation = snapshot().categoryTranslations.find(
      (item) => item.category_id === category.id && item.language_id === languageId
    ) || snapshot().categoryTranslations.find((item) => item.category_id === category.id);
    return {
      ...category,
      label: translation?.label || category.label || category.slug,
    };
  });
}

function pointLatLng(geojson) {
  if (!geojson || geojson.type !== "Point" || !Array.isArray(geojson.coordinates)) {
    return { lat: null, lng: null };
  }
  const [lng, lat] = geojson.coordinates;
  return { lat: Number(lat), lng: Number(lng) };
}

function bboxFromPolygon(geojson) {
  const ring = geojson?.type === "Polygon" && Array.isArray(geojson.coordinates)
    ? geojson.coordinates.flat(1)
    : [];
  const lngs = ring.map((point) => Number(point?.[0])).filter(Number.isFinite);
  const lats = ring.map((point) => Number(point?.[1])).filter(Number.isFinite);
  if (!lngs.length || !lats.length) {
    return { north: null, south: null, east: null, west: null };
  }
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

function normalizeCategoryIconPath(iconPath) {
  const raw = String(iconPath || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^\/+/, "");
  if (!cleaned.endsWith(".svg")) return null;
  if (/^static\/assets\/icons\/[a-zA-Z0-9_ /-]+\.svg$/.test(cleaned)) return `/${cleaned}`;
  if (cleaned.startsWith("icons/")) return `/static/assets/${cleaned}`;
  if (cleaned.startsWith("assets/icons/")) return `/static/${cleaned}`;
  return null;
}
const SERVICE_SECTIONS=[["info","Informazioni"],["orari","Orari"],["contatti","Contatti"],["arrivare","Come arrivare"]];

/** Title (layout r4): the facility name; the service type goes beside it (`serviceKind`). */

function serviceTitle(poi) {
  return poi.raw?.facility_name || poi.raw?.name || serviceKind(poi);
}

function formatDistance(km) {
  return km<1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1).replace(".", ",")} km`;
}

/** Distance from the reference position, when one is set and the service has a fixed point. */

function serviceDistance(poi) {
  if (!snapshot().userLoc || poi.raw?.placement?.section==="directory" || !Number.isFinite(poi.latitude) || !Number.isFinite(poi.longitude)) return "";
  return formatDistance(distanceKm(snapshot().userLoc,{lat:poi.latitude,lng:poi.longitude}));
}

/** Organiser line only when it says more than the facility name. */

function serviceOrganiser(poi) {
  const org=String(poi.raw?.organization_raw || "").trim();
  return org && org.toLowerCase()!==String(serviceTitle(poi)).trim().toLowerCase() ? org : "";
}

/** Service type: main offer cluster of the card's primary need, else the source's service name. */

function serviceKind(poi) {
  const raw=poi.raw || {};
  const primary=raw.category?.slug || raw.needs?.[0];
  const offer=(raw.offers || []).find(o=>o.need===primary && o.code!=="associazioni") || (raw.offers || []).find(o=>o.code!=="associazioni");
  return offer?.label || poi.title;
}

/** Today's declared intervals in Rome time, e.g. "Oggi 19:00 – 08:00 (del giorno dopo)". */

function sourceNames(poi) {
  const names=(poi.raw?.sources || []).map(s=>s.source_name).filter(Boolean);
  return names.length ? [...new Set(names)] : [sourceName(poi)];
}

/** Course-site flags in the header: old page (decision 5) and stated summer closure. */

function courseFlags(raw) {
  if (!raw.site_page_url) return "";
  return `${raw.freshness?.stale ? '<span class="flag-hours">dato da verificare · pagina non aggiornata da oltre 12 mesi</span>' : ""}${raw.summer_closure ? '<span class="flag-hours">chiusa in estate</span>' : ""}`;
}

function renderServiceHeader(poi, {actions="",notice=""} = {}) {
  const raw=poi.raw || {};
  const cat=resolveCategory(poi) || {};
  const address=poi.address || "";
  const status=sourceOpeningStatus(raw.hours_display);
  const today=todayHours(raw.hours_display);
  const report=reportErrorAction(poi);
  const stillValid=stillValidHref(poi);
  const distance=serviceDistance(poi);
  const organiser=serviceOrganiser(poi);
  return `<header class="service-head">
    <div class="service-head-row">${categoryBadge(cat)}${distance ? `<span class="service-distance">${escapeHtml(distance)}</span>` : ""}<div class="service-head-actions">${actions}<button type="button" class="service-close" data-close-service aria-label="Chiudi la scheda">Chiudi</button></div></div>
    <h2 class="service-title">${escapeHtml(serviceTitle(poi))}</h2>
    <p class="service-kind">${escapeHtml(serviceKind(poi))}</p>
    <p class="service-where">${escapeHtml(address || raw.placement?.label || "")}</p>
    <p class="service-status ${status.kind}" data-opening-service="${escapeHtml(poi.id)}"><strong>${escapeHtml(status.label)}</strong>${today ? `<span class="service-today">${escapeHtml(today)}</span>` : ""}${hoursNeedReview(raw.hours_display) ? '<span class="flag-hours">orari da verificare</span>' : ""}${courseFlags(raw)}<small hidden></small></p>
    <div class="service-extra">
      ${organiser ? `<p class="service-line"><span class="service-key">Organizzato da</span> ${escapeHtml(organiser)}</p>` : ""}
      <p class="service-line service-sources"><span class="service-key">Fonti</span> ${sourceNames(poi).map(n=>`<span class="source-chip">${escapeHtml(n)}</span>`).join("")}<button type="button" class="flag-data" data-jump="fonti">da verificare</button>${report ? `<a class="service-report" href="${escapeHtml(report.href)}" aria-label="Segnala un errore" title="Segnala un errore"><img src="/static/assets/icons/default/report.svg" alt="" aria-hidden="true"></a>` : ""}${stillValid ? `<a class="service-still-valid" href="${escapeHtml(stillValid)}">${escapeHtml(t("map.still_valid_action", {}, "Ancora valido?"))}</a>` : ""}</p>
    </div>
    ${notice}
  </header>
  <nav class="service-anchors" aria-label="Sezioni della scheda">${SERVICE_SECTIONS.map(([id,label],i)=>`<button type="button" data-jump="${id}" class="${i===0 ? "on" : ""}">${label}</button>`).join("")}</nav>`;
}

function chipList(items, interpreted=new Set()) {
  return `<div class="service-chips">${items.map(x=>`<span class="service-chip${interpreted.has(x) ? " interpreted" : ""}">${escapeHtml(x)}</span>`).join("")}</div>`;
}

/** Labels in order, without repeats (case-insensitive). */

function uniqueLabels(labels) {
  const seen=new Set();
  return labels.filter(x=>{const k=String(x || "").toLowerCase().trim(); if (!k || seen.has(k)) return false; seen.add(k); return true;});
}

/** Source prestazioni not already shown as an offer ("Doccia" is covered by "Docce"). */

function uncoveredPrestazioni(raw) {
  const offers=raw.offers || [];
  const covered=new Set(offers.flatMap(o=>[o.label,String(o.basis || "").replace(/^(prestazione|tipo) della fonte: /,"")]).map(x=>String(x).toLowerCase()));
  const levels=(raw.course_facts?.levels || []).map(l=>String(l).toLowerCase());  // shown as "Livelli dei corsi"
  return uniqueLabels((raw.native_classifications?.prestazioni || []).map(p=>p.nome))
    .filter(n=>!covered.has(n.toLowerCase()) && !levels.some(l=>n.toLowerCase().includes(l)));
}

function renderInfoSection(poi) {
  if (poi.raw?.data_status === "approved_canonical_local") return renderCanonicalInfo(poi);
  const raw=poi.raw || {};
  const interpreted=new Set([...(raw.offers || []),...(raw.audiences || []),...(raw.access_tags || [])].filter(x=>x.interpreted).map(x=>x.label));
  const offers=uniqueLabels((raw.offers || []).filter(o=>o.code!=="associazioni" || raw.offers.length===1).map(o=>o.label));
  const extra=uncoveredPrestazioni(raw).filter(n=>!offers.some(o=>o.toLowerCase()===n.toLowerCase()));
  const sections=raw.access_display?.sections || [];
  const entries=code=>(sections.find(s=>s.code===code)?.entries || []).map(e=>e.label);
  const forWhom=uniqueLabels([...entries("audience"),...(raw.audiences || []).map(a=>a.label)]);
  const access=uniqueLabels([...entries("procedure"),...entries("documents"),...entries("cost"),...(raw.access_tags || []).map(a=>a.label)]);
  const texts=raw.access_display?.texts || [];
  const levels=raw.course_facts?.levels || [];
  const description=raw.description || "";
  const printed=raw.sources?.[0]?.source_kind==="document" ? ' class="source-printed-text"' : "";
  return `<section class="detail-section service-section" id="sec-info"><h3>Informazioni</h3>
    ${offers.length || extra.length ? `<h4>Cosa offre</h4><div class="service-chips">${offers.map(x=>`<span class="service-chip${interpreted.has(x) ? " interpreted" : ""}">${escapeHtml(x)}</span>`).join("")}${extra.map(x=>`<span class="service-chip from-source" title="Voce della fonte">${escapeHtml(x)}</span>`).join("")}</div>` : ""}
    ${forWhom.length ? `<h4>Per chi</h4>${chipList(forWhom, interpreted)}` : ""}
    ${access.length ? `<h4>Come si accede</h4>${chipList(access, interpreted)}` : ""}
    ${texts.map(t=>`<h4>${escapeHtml(t.title)}</h4><p class="source-hours-text">${escapeHtml(t.text)}</p>`).join("")}
    ${levels.length ? `<h4>Livelli dei corsi</h4>${chipList(levels)}` : ""}
    ${description ? (description.length > 260
      ? `<details class="service-description"><summary><span class="service-key">Descrizione della fonte</span> ${escapeHtml(description.slice(0,160))}…</summary><p${printed}>${escapeHtml(description)}</p></details>`
      : `<h4>Descrizione della fonte</h4><p${printed}>${escapeHtml(description)}</p>`) : ""}
  </section>`;
}

/** Lesson times by level, enrolment, reception hours and summer closure of a course site. */

function renderContactsSection(poi) {
  const contacts=(poi.contacts || []).filter(c=>c?.is_active!==false);
  return `<section class="detail-section service-section" id="sec-contatti"><h3>Contatti</h3>
    ${contactActions(contacts).length ? renderContacts(contacts) : "<p>La fonte non indica contatti.</p>"}
  </section>`;
}

function renderSourcesSection(poi) {
  if (poi.raw?.data_status === "approved_canonical_local") return renderCanonicalSources(poi);
  const raw=poi.raw || {};
  const interpreted=[...(raw.offers || []),...(raw.audiences || []),...(raw.access_tags || [])].filter(x=>x.interpreted);
  const items=[
    raw.freshness?.label,
    raw.placement?.label ? `Posizione: ${raw.placement.label}.` : "",
    raw.position?.match ? `Posizione ricavata dall’indirizzo con Nominatim (© OpenStreetMap contributors): ${raw.position.match}.` : "",
    sourceCode(poi)==="helpinet" ? "Ruolo dell’organizzazione indicata non verificato." : "",
    raw.hours_display?.note ? `Orari: ${raw.hours_display.note}` : "",
    raw.merged_from?.length ? `Scheda composta da ${raw.merged_from.length} schede della fonte che descrivono lo stesso servizio.` : "",
    interpreted.length ? `Etichette ricavate dal testo della fonte (da verificare): ${interpreted.map(x=>`${x.label} (${x.basis})`).join("; ")}.` : "",
  ].filter(Boolean);
  return `<details class="detail-section service-section service-sources-panel" id="sec-fonti"><summary><h3>Fonti e aggiornamenti</h3></summary>
    ${renderProvenance(poi)}
    <p class="service-key">Dati non revisionati da EGI: verifica con chi eroga il servizio.</p>
    <ul class="service-reliability">${items.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>
    <details><summary>Dati originali</summary><pre class="source-evidence">${escapeHtml(JSON.stringify({record:raw.source_locator,gruppo:raw.source_group,sintesi:raw.derived_summary,campi_originali:raw.source_values,posizione:raw.position,da_verificare:raw.review_required,schede_unite:raw.merged_from},null,2))}</pre></details>
  </details>`;
}

/** Fixed bar: call first (or e-mail / website), then directions. */

function renderServiceBar(poi) {
  const actions=contactActions((poi.contacts || []).filter(c=>c?.is_active!==false));
  const reach=actions.find(a=>a.kind==="phone") || actions.find(a=>a.kind==="email") || actions.find(a=>a.kind==="website");
  const go=directionsAction(poi);
  const label={phone:"Chiama",email:"Scrivi",website:"Sito web"};
  const buttons=[
    reach ? `<a class="service-bar-btn primary ${reach.kind}" href="${escapeHtml(reach.href)}"${reach.external ? ' target="_blank" rel="noopener noreferrer"' : ""}><span class="contact-action-icon">${contactActionIcon(reach)}</span>${label[reach.kind]}</a>` : "",
    go ? `<a class="service-bar-btn${reach ? "" : " primary"}" href="${escapeHtml(go.href)}" target="_blank" rel="noopener noreferrer"><span class="contact-action-icon">${contactActionIcon(go)}</span>Indicazioni</a>` : "",
  ].filter(Boolean);
  return buttons.join("");
}

/** Close, anchors, the header's data flag, and the compact header while scrolling. */

function renderContacts(contacts) {
  const activeContacts = contacts.filter((contact) => contact?.is_active !== false);
  const actions = contactActions(activeContacts);
  if (!actions.length) {
    return `<p style="margin:0;font-size:.875rem">${escapeHtml(t("common.not_available"))}</p>`;
  }

  // Rows (r2 restyle): icon, value, kind; phones, then e-mail, then websites and the rest.
  const order = {phone: 1, whatsapp: 2, email: 3, telegram: 4, website: 5, other: 6};
  const kinds = {phone: "Telefono", whatsapp: "WhatsApp", email: "E-mail", telegram: "Telegram", website: "Sito web", other: "Altro"};
  return `
    <ul class="contact-list">
      ${[...actions].sort((a, b) => (order[a.kind] || 9) - (order[b.kind] || 9)).map((action) => `
        <li><a class="contact-row ${action.kind}" href="${escapeHtml(action.href)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""}${action.kind === "website" ? ` title="${escapeHtml(action.href)}"` : ""}>
          <span class="contact-action-icon">${contactActionIcon(action)}</span>
          <span class="contact-row-text"><span class="contact-row-value">${escapeHtml(action.label)}</span><small>${escapeHtml([kinds[action.kind] || kinds.other, action.note].filter(Boolean).join(" · "))}</small></span>
          <span class="contact-row-go" aria-hidden="true">›</span>
        </a></li>
      `).join("")}
    </ul>
  `;
}

function renderCost(poi) {
  const label = costLabel(poi.cost_tag);
  const note = poi.cost_note ? `<span style="display:block;color:var(--ink-soft);margin-top:4px">${escapeHtml(poi.cost_note)}</span>` : "";
  return `<p style="margin:0;font-size:.875rem">${escapeHtml(label)}${note}</p>`;
}

function contactActions(contacts) {
  const actions = [];
  const seen = new Set();

  contacts.forEach((contact) => {
    const action = contactAction(contact);
    if (!action) return;
    const key = `${action.kind}:${action.href}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(action);
  });

  return actions.sort((a, b) => a.priority - b.priority);
}

/** The site a website link opens, e.g. "cpiaroma2.edu.it" (r2: buttons name their address). */

function websiteHost(href) {
  try { return new URL(href).hostname.replace(/^www\./i, ""); } catch (_) { return ""; }
}

function contactAction(contact) {
  const type = String(contact.type || contact.contact_type || "").toLowerCase();
  const value = String(contact.value || contact.contact_value || "").trim();
  if (!value) return null;
  const href = contactHref(contact);
  if (!href) return null;

  if (type === "phone") {
    return {
      kind: "phone",
      href,
      label: String(contact.label || "").trim() || value,
      note: contact.source_note || "",  // e.g. "da GrIS Lazio (dicembre 2024)" on Ministero consultori
      external: false,
      priority: 1,
    };
  }
  if (type === "whatsapp") {
    return {
      kind: "whatsapp",
      href,
      label: t("map.whatsapp_action", {}, "WhatsApp"),
      external: true,
      priority: 2,
    };
  }
  if (type === "website" || type === "social") {
    return {
      kind: "website",
      href,
      label: type === "social" ? t("map.social_action", {}, "Social") : (websiteHost(href) || t("map.website_short_action", {}, "Sito web")),
      external: true,
      priority: 3,
    };
  }
  if (type === "email") {
    return {
      kind: "email",
      href,
      label: String(contact.label || "").trim() || value,
      external: false,
      priority: 4,
    };
  }
  if (type === "telegram") {
    return {
      kind: "telegram",
      href,
      label: t("map.telegram_action", {}, "Telegram"),
      external: true,
      priority: 5,
    };
  }
  return {
    kind: "other",
    href,
    label: contact.label || value,
    external: /^https?:\/\//i.test(href),
    priority: 6,
  };
}

function directionsAction(poi) {
  if (!poi) return null;
  const href = googleMapsDirectionsHref(poi);
  if (!href) return null;
  return {
    kind: "directions",
    href,
    label: t("map.directions_action", {}, "Indicazioni"),
    external: true,
    priority: 0,
  };
}

function stillValidHref(poi) {
  if (!poi?.id) return null;
  const url = new URL("/contribuisci", window.location.origin);
  url.searchParams.set("lang", normalizeLang(snapshot().lang));
  url.searchParams.set("poi_id", String(poi.id));
  url.searchParams.set("issue", "still_valid");
  return url.pathname + url.search;
}

function reportErrorAction(poi) {
  if (!poi?.id) return null;
  const url = new URL("/contribuisci", window.location.origin);
  url.searchParams.set("city_id", String(context.cityId || ""));
  url.searchParams.set("lang", normalizeLang(snapshot().lang));
  url.searchParams.set("poi_id", String(poi.id));
  url.searchParams.set("issue", "error");
  return {
    kind: "report-error",
    href: url.pathname + url.search,
    label: t("map.report_error_action", {}, "Segnala un errore"),
    external: false,
    priority: 10,
  };
}

function contactActionIcon(action) {
  const icons = {
    directions: "/static/assets/icons/default/direction.svg",
    "report-error": "/static/assets/icons/default/report.svg",
    website: "/static/assets/icons/default/web.svg",
    email: "/static/assets/icons/default/email.svg",
    phone: "/static/assets/icons/ui/phone.svg",
    whatsapp: "/static/assets/icons/brands/whatsapp.svg",
  };
  const icon = icons[action.kind];
  if (icon) {
    return `<img src="${icon}" alt="" aria-hidden="true" />`;
  }
  const symbol = action.kind === "email" ? "@" : action.kind === "website" ? "www" : action.kind === "report-error" ? "!" : "↗";
  return `<span class="contact-action-symbol" aria-hidden="true">${escapeHtml(symbol)}</span>`;
}

function googleMapsDirectionsHref(poi) {
  if (poi.raw?.placement?.section === "directory") return null;
  const lat = poi.latitude;
  const lng = poi.longitude;
  const destination = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat},${lng}`
    : String(poi.address || "").trim();
  if (!destination) return null;

  const params = new URLSearchParams({
    api: "1",
    destination,
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function contactHref(contact) {
  const type = String(contact.type || contact.contact_type || "").toLowerCase();
  const value = String(contact.value || contact.contact_value || "").trim();
  if (!value) return null;
  if (["phone","fax","whatsapp"].includes(type) && value.includes("/")) return null;
  // Helpinet v0.3 gives a dialable number (`dial`); null means the value is not a number.
  if ((type === "phone" || type === "fax") && "dial" in contact) return contact.dial ? `tel:${contact.dial}` : null;
  if (type === "phone" || type === "fax") return `tel:${value.replace(/[^\d+]/g, "")}`;
  if (type === "email") return `mailto:${value}`;
  if (type === "whatsapp") return `https://wa.me/${value.replace(/\D/g, "")}`;
  if (type === "website" || type === "social" || type === "telegram") {
    return normalizeExternalHref(value);
  }
  return null;
}

function costLabel(costTag) {
  const labels = {
    free: t("contribute.cost.free", {}, "Gratis"),
    low_cost: t("contribute.cost.contribution", {}, "Contributo"),
    donation: t("contribute.cost.contribution", {}, "Contributo"),
    variable: t("contribute.cost.unknown", {}, "Non noto"),
    paid: t("map.paid", {}, "A pagamento"),
    unknown: t("contribute.cost.unknown", {}, "Non noto"),
  };
  return labels[costTag] || costTag || t("common.not_available");
}

function sourceCode(poi) {
  return poi.raw?.source_code || "helpinet";
}

/** Second list line: the facility, or the address when the facility repeats the title. */

function sourceName(poi) {
  return poi.raw?.sources?.[0]?.source_name || "Helpinet";
}

/** Map-export positions are geocoded estimates; say how they were found. */

const SOURCE_KIND_TEXT = {
  map_export: {link: "mappa originale", acquired: "Esportazione KML acquisita il"},
  open_data: {link: "file originale", acquired: "File open data acquisito il"},
  web_pages: {link: "pagine originali", acquired: "Pagine web acquisite il"},
  document: {link: "guida originale", acquired: "Estratto dalla guida (PDF, revisione egi_sources) il"},
};

function renderProvenance(poi) {
  const raw = poi.raw || {};
  const src = raw.sources?.[0] || {};
  if (sourceCode(poi) === "helpinet") return `<p>Helpinet · <a href="https://helpinet.app/app/" target="_blank" rel="noopener">helpinet.app</a>. Copia locale del ${escapeHtml((raw.observed_at || "—").slice(0, 10))}; data di raccolta originale non nota.</p>`;
  const kind = SOURCE_KIND_TEXT[src.source_kind] || SOURCE_KIND_TEXT.map_export;
  const link = src.source_url ? ` · <a href="${escapeHtml(src.source_url)}" target="_blank" rel="noopener">${kind.link}</a>` : "";
  return `<p>${escapeHtml(src.source_title || src.source_name || "Fonte")}${link}. ${kind.acquired} ${escapeHtml(raw.original_retrieved_at || "—")}.</p>${src.attribution?`<p class="source-note">${escapeHtml(src.attribution)}. Licenza di riuso non stabilita: solo preview locale.</p>`:""}`;
}

function serviceButton(poi, matches = true) {
  return `<button type="button" class="related-service${matches ? "" : " outside-search"}" data-service-id="${escapeHtml(poi.id)}">${categoryBadge(resolveCategory(poi))}<span>${escapeHtml(poi.title)}</span><small>${escapeHtml(poi.raw?.place?.address || "")}</small>${matches?"":'<em>Altro servizio nel punto · fuori dai filtri attivi</em>'}<small>${escapeHtml((poi.raw?.native_classifications?.prestazioni || []).map(p=>p.nome).join(" · "))}</small></button>`;
}

function categoryBadge(category) {
  const c=category || {};
  const url=normalizeCategoryIconPath(c.icon_path);
  return `<span class="category-badge" style="background:${escapeHtml(c.color || "#555")}">${url?`<img src="${escapeHtml(url)}" alt="">`:""}<span>${escapeHtml(categoryCaption(c.label || c.slug))}</span></span>`;
}

function renderCanonicalInfo(poi) {
  const raw=poi.raw;
  const conditions=(raw.conditions || []).filter(row=>row.text);
  return `<section class="detail-section service-section" id="sec-info"><h3>Informazioni</h3>
    ${poi.notes ? `<p>${escapeHtml(poi.notes)}</p>` : "<p>Descrizione non disponibile.</p>"}
    ${conditions.length ? `<h4>Accesso e indicazioni</h4><ul>${conditions.map(row=>`<li>${escapeHtml(row.text)}${row.source_name ? ` <small>(${escapeHtml(row.source_name)})</small>` : ""}${row.state==="unknown" ? " · da verificare" : ""}</li>`).join("")}</ul>` : ""}
    ${(raw.offers || []).length ? `<h4>Prestazioni</h4>${chipList(raw.offers.map(row=>row.label))}` : ""}
    ${(raw.course_levels || []).length ? `<h4>Livelli dichiarati</h4>${chipList(raw.course_levels)}` : ""}
    ${renderCost(poi)}<p class="service-advice">La pubblicazione locale conserva le indicazioni delle fonti; non certifica la disponibilità del servizio.</p></section>`;
}

/** Display public revision provenance, without raw assertions or source capture contents. */

function renderCanonicalSources(poi) {
  const raw=poi.raw;
  const sources=(raw.sources || []).map(source=>`<li>${escapeHtml(source.name)}${source.source_url ? ` · <a href="${escapeHtml(normalizeExternalHref(source.source_url) || "#")}" target="_blank" rel="noopener">Fonte</a>` : ""} · acquisita il ${escapeHtml((source.observed_at || "non noto").slice(0,10))}${source.published_at ? ` · data dichiarata ${escapeHtml(source.published_at.slice(0,10))}` : " · data originaria non nota"}</li>`).join("");
  const linked=(raw.linked_sources || []).map(source=>`<li>${escapeHtml(source.source_name)}: contatti e criteri approvati separatamente, con provenienza conservata.</li>`).join("");
  return `<details class="detail-section service-section service-sources-panel" id="sec-fonti"><summary><h3>Fonti e aggiornamenti</h3></summary><ul>${sources}${linked}</ul><p>Revisione canonica: ${escapeHtml(raw.revision_id)}.</p><p>La classificazione segue il vocabolario Roma v0.3. Posizioni e orari restano indicazioni delle fonti; contatta chi eroga il servizio.</p></details>`;
}

/** Refresh canonical opening results while retaining the visitor's filters and selection. */
function todayHours(display, now=new Date()) {
  const structured=display?.days?.some(d=>d.intervals?.length);
  if (!structured) return display?.raw_text || display?.scoped?.length ? "Orari indicati come testo" : "";
  const day=new Intl.DateTimeFormat("en-GB",{timeZone:context.profile?.timezone || "UTC",weekday:"short"}).format(now);
  const key=["lun","mar","mer","gio","ven","sab","dom"][["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(day)];
  const today=display.days.find(d=>d.day===key);
  return today?.intervals?.length ? `Oggi ${today.intervals.map(i=>i.label).join(", ")}` : "";  // closed today: the status says it
}

/** Hours that deserve the separate amber flag: corrections, conflicts, review notes. */

function hoursNeedReview(display) {
  if (!display) return false;
  return Boolean((display.warnings || []).length || (display.days || []).some(d=>d.issues?.length || d.intervals?.some(i=>i.review_note)));
}

function renderCourseHours(raw) {
  const display=raw.hours_display;
  const enrol=raw.enrolment;
  const enrolState=enrol?.state==="aperte" ? "Iscrizioni aperte" : enrol?.state==="chiuse" ? "Iscrizioni chiuse" : "";
  // Week table like the other cards (r2): each lesson time with its levels as labels.
  const week=display.kind==="lessons" ? `<div class="source-week lesson-week">${display.days.map(day=>`<div class="source-day"><strong>${escapeHtml(day.label)}</strong><span>${day.intervals.length ? day.intervals.map(v=>`<span class="lesson-slot"><span>${escapeHtml(v.label)}</span>${(v.levels || []).map(l=>`<span class="level-chip">${escapeHtml(l)}</span>`).join("")}</span>`).join("") : '<span class="unknown-value">Nessuna lezione</span>'}</span></div>`).join("")}</div>` : "";
  const notes=(display.courses || []).filter(c=>c.note || c.flags.length || !c.sessions.length).map(c=>`<li><span class="level-chip">${escapeHtml(c.level)}</span> ${escapeHtml([c.note, ...c.flags, c.sessions.length ? "" : "orario non indicato"].filter(Boolean).join(" · "))}</li>`).join("");
  return `${week ? `<h4>Orari delle lezioni</h4>${week}` : ""}${notes ? `<h4>Note dei corsi</h4><ul class="course-notes">${notes}</ul>` : ""}
    ${display.kind==="office" && display.cpia ? "<p>Iscrizioni e informazioni in segreteria.</p>" : ""}
    ${display.office_text ? `<h4>${display.cpia ? "Orari di ricevimento" : "Segreteria"}</h4><p class="source-hours-text">${escapeHtml(display.office_text)}</p>` : ""}
    ${display.kind==="none" ? `<p>${escapeHtml(display.status_label)}.</p>` : ""}
    ${enrolState || enrol?.start_text ? `<h4>Iscrizioni</h4>${enrolState ? `<p><strong>${escapeHtml(enrolState)}</strong>${enrol.text ? ` — <span class="source-hours-text">${escapeHtml(enrol.text)}</span>` : ""}</p>` : ""}${enrol?.start_text ? `<p>${escapeHtml(enrol.start_text)}</p>` : ""}` : ""}
    ${raw.summer_closure ? '<p class="source-note">La sede indica una chiusura estiva.</p>' : ""}
    <p class="service-advice">Contatta la sede prima di andare: iscrizioni, posti e date vanno verificati.</p>`;
}

function renderHoursSection(poi) {
  if (poi.raw?.data_status === "approved_canonical_local") return renderCanonicalHours(poi);
  const raw=poi.raw || {};
  const display=raw.hours_display;
  if (["lessons","office","none"].includes(display?.kind)) return `<section class="detail-section service-section" id="sec-orari"><h3>Orari</h3>${renderCourseHours(raw)}</section>`;
  const known=Boolean(display?.days?.some(d=>d.intervals?.length) || display?.raw_text || display?.scoped?.length);
  const meals=(raw.meal_times || []).map(m=>m.label);
  const status=sourceOpeningStatus(display);
  const quiet=display ? {...display, note: ""} : display;
  return `<section class="detail-section service-section" id="sec-orari"><h3>Orari</h3>
    ${known ? renderSourceHours(quiet) : "<p>La fonte non indica orari.</p>"}
    ${meals.length ? `<h4>Pasti</h4>${chipList(meals)}` : ""}
    ${!known || hoursNeedReview(display) || status.kind==="unknown" ? '<p class="service-advice">Chiama prima di andare: gli orari potrebbero non essere aggiornati.</p>' : ""}
  </section>`;
}

function parseClockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function renderSourceHours(display) {
  if (!display) return '<p>Orari non indicati.</p>';
  if ("raw_text" in display && display.scoped?.length) return `<p class="source-note">${escapeHtml(display.note)}</p>${display.scoped.map(b=>`<div class="access-section">${b.title?`<h4>${escapeHtml(b.title)}</h4>`:""}${b.labels.length?`<div class="service-chips">${b.labels.map(l=>`<span class="service-chip">${escapeHtml(l.kind)}: ${escapeHtml(l.text)}${l.interpreted?" (interpretazione in revisione)":""}</span>`).join("")}</div>`:""}<p class="source-hours-text">${escapeHtml(b.text)}</p></div>`).join("")}`;
  if ("raw_text" in display) return `<p class="source-note">${escapeHtml(display.note)}</p>${display.raw_text?`<p class="source-hours-text">${escapeHtml(display.raw_text)}</p>`:""}`;
  // Days without hours are closed when the source declares other days (user, 2026-11-15).
  const empty=display.days.some(d=>d.intervals.length) ? '<span class="unknown-value">Chiuso</span>' : '<span class="unknown-value">Non indicato</span>';
  return `${display.note ? `<p class="source-note">${escapeHtml(display.note)}</p>` : ""}<div class="source-week">${display.days.map(day=>`<div class="source-day"><strong>${escapeHtml(day.label)}</strong><span>${day.intervals.length ? day.intervals.map(v=>`<span>${escapeHtml(v.label)}${v.review_note ? ` <small>${escapeHtml(v.review_note)}</small>`:""}</span>`).join("<br>") : empty}${day.issues.length && !day.intervals.length ? `<small>${escapeHtml(day.issues.join("; "))}</small>`:""}</span></div>`).join("")}</div>${(display.warnings || []).map(w=>`<p class="source-note">${escapeHtml(w)}</p>`).join("")}`;
}

function nextLesson(display, now = new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:context.profile?.timezone || "UTC",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).map(p=>[p.type,p.value]));
  const dayIndex=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(parts.weekday);
  const keys=["lun","mar","mer","gio","ven","sab","dom"];
  const minute=Number(parts.hour)*60+Number(parts.minute);
  for (let offset=0;offset<=7;offset++) {
    const day=(display.days || []).find(d=>d.day===keys[(dayIndex+offset)%7]);
    const next=(day?.intervals || []).filter(i=>{const a=parseClockMinutes(i.opens_raw);return a!==null && (offset>0 || a>minute);})
      .sort((a,b)=>a.opens_raw.localeCompare(b.opens_raw))[0];
    if (next) return `${offset===0 ? "oggi" : offset===1 ? "domani" : day.label.toLowerCase()} ${next.opens_raw}${next.level ? ` (${next.level})` : ""}`;
  }
  return null;
}

/** Courses are not desks: their status is the next lesson or the secretariat, never "Aperto ora". */

function courseStatus(display, now = new Date()) {
  const note=display.opening_note || "";
  if (display.kind==="lessons") {
    const next=nextLesson(display, now);
    return {kind:"lessons",label:next ? `Prossima lezione: ${next}` : "Orari delle lezioni da verificare",note};
  }
  return {kind:display.kind==="office" ? "office" : "unknown",label:display.status_label || "Orario non disponibile",note};
}

function sourceOpeningStatus(display, now = new Date()) {
  if (display?.canonical_opening) return canonicalOpeningStatus(display, now);
  if (["lessons","office","none"].includes(display?.kind)) return courseStatus(display, now);
  // Calculated from source intervals in Rome time, without asserting completeness.
  const unknown={kind:"unknown",label:"Orario non disponibile",note:display?.opening_note || "Orari della fonte non revisionati"};
  if (!display?.days || !Number.isFinite(now.getTime())) return unknown;
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:context.profile?.timezone || "UTC",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).map(p=>[p.type,p.value]));
  const dayIndex=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(parts.weekday);
  const keys=["lun","mar","mer","gio","ven","sab","dom"];
  const day=display.days.find(d=>d.day===keys[dayIndex]);
  const minute=Number(parts.hour)*60+Number(parts.minute);
  const intervals=day?.intervals || [];
  if (day?.issues?.length || intervals.some(i=>i.review_note)) return {...unknown,label:"Orari da verificare"};
  // An interval ending before it starts crosses midnight (night shelters); 23:59 closes the day.
  const span=i=>{const a=parseClockMinutes(i.opens_raw);let b=parseClockMinutes(i.closes_raw);if(a===null||b===null)return null;if(b===1439)b=1440;return b>a?{today:[a,b]}:b<a?{today:[a,1440],next:[0,b]}:null;};
  const spans=intervals.map(span);
  if (spans.some(x=>x===null)) return {...unknown,label:"Orari da verificare"};
  const yesterday=display.days.find(d=>d.day===keys[(dayIndex+6)%7]);
  const carried=yesterday?.issues?.length ? [] : (yesterday?.intervals || []).map(span).filter(x=>x?.next).map(x=>x.next);
  const ranges=[...spans.map(x=>x.today),...carried].sort((a,b)=>a[0]-b[0]);
  // Merge overlapping or adjacent intervals before finding the closing boundary.
  const merged=[];
  ranges.forEach(([a,b])=>{const last=merged[merged.length-1];if(last && a<=last[1]) last[1]=Math.max(last[1],b);else merged.push([a,b]);});
  const active=merged.find(([a,b])=>a<=minute && minute<b);
  if (active && active[1]===1440) return {kind:"open",label:"Aperto ora",note:unknown.note};  // continues past midnight
  if (active) {
    const remaining=active[1]-minute;
    return {kind:remaining<=60 ? "closing" : "open",label:remaining<=60?`Aperto ora · chiude alle ${String(Math.floor(active[1]/60)).padStart(2,"0")}:${String(active[1]%60).padStart(2,"0")}`:"Aperto ora",note:unknown.note};
  }
  const upcoming=merged.find(([a])=>a>minute);
  if (upcoming) return {kind:"closed",label:`Chiuso ora · apre oggi alle ${String(Math.floor(upcoming[0]/60)).padStart(2,"0")}:${String(upcoming[0]%60).padStart(2,"0")}`,note:unknown.note};
  // A day without declared hours counts as closed when the source declares other days
  // (user decision, 2026-11-15); with no structured hours at all the status stays unknown.
  for (let offset=1;offset<=7;offset++) {
    const candidate=display.days.find(d=>d.day===keys[(dayIndex+offset)%7]);
    if (candidate?.issues?.length) continue;
    const next=(candidate?.intervals || []).filter(i=>!i.review_note && span(i)!==null).sort((a,b)=>a.opens_raw.localeCompare(b.opens_raw))[0];
    if (next) return {kind:"closed",label:`Chiuso ora · apre ${offset===1 ? "domani" : candidate.label.toLowerCase()} alle ${next.opens_raw}`,note:`${unknown.note} · giorni senza orari considerati chiusi`};
  }
  return unknown;
}

function hoursVerification(display){
  const checks=(display?.verification?.checks || []).filter(row=>row.scope==="page" || row.scope==="field" && row.field==="hours")
    .sort((a,b)=>String(a.checked_at).localeCompare(String(b.checked_at)));
  const check=checks.at(-1);
  return check?.outcome==="confirmed" && check.warning!=="review_due" ? check : null;
}

function canonicalOpeningStatus(display, now = new Date()) {
  const opening=display.canonical_opening || {};
  const check=hoursVerification(display);
  const hint=check ? "" : " · da verificare";
  const note=check ? `Verifica registrata il ${String(check.checked_at).slice(0,10)}. Non è disponibilità in tempo reale.` : "Orari interpretati come verosimilmente completi, in attesa di verifica. Contatta il servizio per conferma.";
  const transition=opening.next_transition_at ? new Date(opening.next_transition_at) : null;
  if (transition && transition.getTime()<=now.getTime()) return {kind:"unknown",label:"Aggiornamento degli orari in corso",note};
  if (opening.status==="open") {
    const closes=opening.closes_at ? new Date(opening.closes_at) : null;
    const closing=closes && closes.getTime()>now.getTime() && closes.getTime()-now.getTime()<=3600000;
    return {kind:closing?"closing":"open",label:closing ? `Aperto${hint} · chiude alle ${new Intl.DateTimeFormat("it-IT",{timeZone:opening.timezone || context.profile?.timezone || "UTC",hour:"2-digit",minute:"2-digit"}).format(closes)}` : `Aperto${hint}`,note};
  }
  if (opening.status==="closed") return {kind:"closed",label:`Chiuso${hint}`,note};
  return {kind:"unknown",label:"Orario da verificare",note};
}

/** Show selected canonical conditions and preserve each supplementary field's source. */

function renderCanonicalHours(poi) {
  const days=poi.raw.hours_display?.days || [];
  const rows=days.map(day=>{
    const intervals=(day.intervals || []).map(interval=>escapeHtml(interval.label)).join("<br>");
    const label=intervals || (day.state==="closed" ? `Chiuso${hoursVerification(poi.raw?.hours_display) ? "" : " · da verificare"}` : "Da verificare");
    return `<tr><th scope="row">${escapeHtml(day.label)}</th><td>${label}</td></tr>`;
  }).join("");
  return `<section class="detail-section service-section" id="sec-orari"><h3>Orari dichiarati</h3><table class="hours-table"><tbody>${rows}</tbody></table><p class="service-advice">Calendario interpretato come completo, in attesa di verifica. Giorni e fasce incerti restano da verificare. Le fasce notturne proseguono nel giorno seguente; eccezioni e variazioni possono prevalere.</p></section>`;
}

function resolveCategory(poi) {
 return snapshot().categories.find(c=>c.id===poi.category_id)||normalizeEmbeddedCategory(poi.category)||null;
}
function describe(poi, now=new Date()) {
 return {title:serviceTitle(poi),kind:serviceKind(poi),organiser:serviceOrganiser(poi),
  sources:sourceNames(poi),sourceName:sourceName(poi),sourceCode:sourceCode(poi),
  distance:serviceDistance(poi),category:resolveCategory(poi),categoryBadge:categoryBadge(resolveCategory(poi)),
  status:sourceOpeningStatus(poi.raw?.hours_display,now),today:todayHours(poi.raw?.hours_display,now)};
}

return {describe,normalizePublicService,normalizeArea,normalizeCategory,mergeServiceCategories,applyCategoryLabels,normalizeCategoryIconPath,resolveCategory,categoryBadge,serviceTitle,serviceKind,serviceOrganiser,sourceNames,formatDistance,sourceOpeningStatus,todayHours,renderServiceHeader,renderInfoSection,renderHoursSection,renderContactsSection,renderSourcesSection,renderServiceBar,serviceButton,SERVICE_SECTIONS,escapeHtml,t};
}
