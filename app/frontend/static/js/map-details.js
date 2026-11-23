/** Service detail components, contacts and public provenance. */
import { normalizeCategoryIconPath, normalizeExternalHref } from "./map-data.js";
import { passesFilters, resolveCategory } from "./map-filters.js";
import { hoursNeedReview, renderHoursSection, sourceOpeningStatus, todayHours } from "./map-hours.js";
import { closeSheets, openSheet, showToast } from "./map-shell.js";
import { context, runtime, state } from "./map-state.js";
import { loadTransitDetail, transitSectionShell } from "./map-transit.js";
import { categoryCaption, distanceKm, escapeHtml, normalizeLang, t } from "./map-utils.js";
import { sameSourceGroup } from "./map-view.js";

export async function openDetail(id) {
  const poi=state.pois.find(p=>String(p.id)===String(id));
  if (!poi) return showToast("Servizio non disponibile");
  const sheet=document.getElementById("sheet-detail");
  sheet.classList.add("service-mode");
  document.getElementById("detail-top").innerHTML=renderServiceHeader(poi);
  document.getElementById("detail-body").innerHTML=[
    renderInfoSection(poi), renderHoursSection(poi), renderContactsSection(poi),
    renderArriveSection(poi), renderOtherServices(poi), renderSourcesSection(poi)].join("");
  document.getElementById("detail-bar").innerHTML=renderServiceBar(poi);
  bindServiceButtons();
  bindServiceSheet(poi);
  void loadTransitDetail(poi);
  document.querySelector("#sheet-detail .sheet-body").scrollTop=0;
  openSheet("sheet-detail");
  document.querySelector("#detail-top .service-close")?.focus();
}

export const SERVICE_SECTIONS=[["info","Informazioni"],["orari","Orari"],["contatti","Contatti"],["arrivare","Come arrivare"]];

/** Title (layout r4): the facility name; the service type goes beside it (`serviceKind`). */

export function serviceTitle(poi) {
  return poi.raw?.facility_name || poi.raw?.name || serviceKind(poi);
}

export function formatDistance(km) {
  return km<1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1).replace(".", ",")} km`;
}

/** Distance from the reference position, when one is set and the service has a fixed point. */

export function serviceDistance(poi) {
  if (!state.userLoc || poi.raw?.placement?.section==="directory" || !Number.isFinite(poi.latitude) || !Number.isFinite(poi.longitude)) return "";
  return formatDistance(distanceKm(state.userLoc,{lat:poi.latitude,lng:poi.longitude}));
}

/** Organiser line only when it says more than the facility name. */

export function serviceOrganiser(poi) {
  const org=String(poi.raw?.organization_raw || "").trim();
  return org && org.toLowerCase()!==String(serviceTitle(poi)).trim().toLowerCase() ? org : "";
}

/** Service type: main offer cluster of the card's primary need, else the source's service name. */

export function serviceKind(poi) {
  const raw=poi.raw || {};
  const primary=raw.category?.slug || raw.needs?.[0];
  const offer=(raw.offers || []).find(o=>o.need===primary && o.code!=="associazioni") || (raw.offers || []).find(o=>o.code!=="associazioni");
  return offer?.label || poi.title;
}

/** Today's declared intervals in Rome time, e.g. "Oggi 19:00 – 08:00 (del giorno dopo)". */

export function sourceNames(poi) {
  const names=(poi.raw?.sources || []).map(s=>s.source_name).filter(Boolean);
  return names.length ? [...new Set(names)] : [sourceName(poi)];
}

/** Course-site flags in the header: old page (decision 5) and stated summer closure. */

export function courseFlags(raw) {
  if (!raw.site_page_url) return "";
  return `${raw.freshness?.stale ? '<span class="flag-hours">dato da verificare · pagina non aggiornata da oltre 12 mesi</span>' : ""}${raw.summer_closure ? '<span class="flag-hours">chiusa in estate</span>' : ""}`;
}

export function renderServiceHeader(poi) {
  const raw=poi.raw || {};
  const cat=resolveCategory(poi) || {};
  const address=poi.address || "";
  const status=sourceOpeningStatus(raw.hours_display);
  const today=todayHours(raw.hours_display);
  const report=reportErrorAction(poi);
  const distance=serviceDistance(poi);
  const organiser=serviceOrganiser(poi);
  return `<header class="service-head">
    <div class="service-head-row">${categoryBadge(cat)}${distance ? `<span class="service-distance">${escapeHtml(distance)}</span>` : ""}<button type="button" class="service-close" data-close-service aria-label="Chiudi la scheda">Chiudi</button></div>
    <h2 class="service-title">${escapeHtml(serviceTitle(poi))}</h2>
    <p class="service-kind">${escapeHtml(serviceKind(poi))}</p>
    <p class="service-where">${escapeHtml(address || raw.placement?.label || "")}</p>
    <p class="service-status ${status.kind}" data-opening-service="${escapeHtml(poi.id)}"><strong>${escapeHtml(status.label)}</strong>${today ? `<span class="service-today">${escapeHtml(today)}</span>` : ""}${hoursNeedReview(raw.hours_display) ? '<span class="flag-hours">orari da verificare</span>' : ""}${courseFlags(raw)}<small hidden></small></p>
    <div class="service-extra">
      ${organiser ? `<p class="service-line"><span class="service-key">Organizzato da</span> ${escapeHtml(organiser)}</p>` : ""}
      <p class="service-line service-sources"><span class="service-key">Fonti</span> ${sourceNames(poi).map(n=>`<span class="source-chip">${escapeHtml(n)}</span>`).join("")}<button type="button" class="flag-data" data-jump="fonti">da verificare</button>${report ? `<a class="service-report" href="${escapeHtml(report.href)}" aria-label="Segnala un errore" title="Segnala un errore"><img src="/static/assets/icons/default/report.svg" alt="" aria-hidden="true"></a>` : ""}</p>
    </div>
  </header>
  <nav class="service-anchors" aria-label="Sezioni della scheda">${SERVICE_SECTIONS.map(([id,label],i)=>`<button type="button" data-jump="${id}" class="${i===0 ? "on" : ""}">${label}</button>`).join("")}</nav>`;
}

export function chipList(items, interpreted=new Set()) {
  return `<div class="service-chips">${items.map(x=>`<span class="service-chip${interpreted.has(x) ? " interpreted" : ""}">${escapeHtml(x)}</span>`).join("")}</div>`;
}

/** Labels in order, without repeats (case-insensitive). */

export function uniqueLabels(labels) {
  const seen=new Set();
  return labels.filter(x=>{const k=String(x || "").toLowerCase().trim(); if (!k || seen.has(k)) return false; seen.add(k); return true;});
}

/** Source prestazioni not already shown as an offer ("Doccia" is covered by "Docce"). */

export function uncoveredPrestazioni(raw) {
  const offers=raw.offers || [];
  const covered=new Set(offers.flatMap(o=>[o.label,String(o.basis || "").replace(/^(prestazione|tipo) della fonte: /,"")]).map(x=>String(x).toLowerCase()));
  const levels=(raw.course_facts?.levels || []).map(l=>String(l).toLowerCase());  // shown as "Livelli dei corsi"
  return uniqueLabels((raw.native_classifications?.prestazioni || []).map(p=>p.nome))
    .filter(n=>!covered.has(n.toLowerCase()) && !levels.some(l=>n.toLowerCase().includes(l)));
}

export function renderInfoSection(poi) {
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

export function renderContactsSection(poi) {
  const contacts=(poi.contacts || []).filter(c=>c?.is_active!==false);
  return `<section class="detail-section service-section" id="sec-contatti"><h3>Contatti</h3>
    ${contactActions(contacts).length ? renderContacts(contacts) : "<p>La fonte non indica contatti.</p>"}
  </section>`;
}

export function renderArriveSection(poi) {
  const raw=poi.raw || {};
  const facility=raw.facility_name || raw.name || "";
  // Say how the point was found only when it is not the source's own point or a house number.
  const precise=["source_point"].includes(raw.placement?.status) || /house/.test(raw.placement?.status || "");
  const where=raw.itinerant_source ? "Servizio itinerante: il punto indicato non è una sede fissa." : precise ? "" : raw.placement?.label || "";
  return `<section class="detail-section service-section" id="sec-arrivare"><h3>Come arrivare</h3>
    <p>${facility ? `<strong>${escapeHtml(facility)}</strong><br>` : ""}${escapeHtml(poi.address || "Indirizzo non indicato")}</p>
    ${where ? `<p class="service-note">${escapeHtml(where)}</p>` : ""}
    ${transitSectionShell(poi)}
  </section>`;
}

/** Other services at the same place: own block above "Fonti e aggiornamenti" (layout r4). */

export function renderOtherServices(poi) {
  const siblings=sameSourceGroup(poi).filter(p=>p.id!==poi.id);
  return siblings.length ? `<section class="detail-section service-section" id="sec-altri"><h3>Altri servizi qui</h3>${siblings.map(item=>serviceButton(item,passesFilters(item))).join("")}</section>` : "";
}

/** The only place that details how reliable the card is (one flag in the header). */

export function renderSourcesSection(poi) {
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

export function renderServiceBar(poi) {
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

export function bindServiceSheet(poi) {
  const top=document.getElementById("detail-top");
  const body=document.getElementById("detail-body");
  top.querySelector("[data-close-service]")?.addEventListener("click",closeSheets, {signal: runtime.lifecycle?.signal});
  const mark=id=>top.querySelectorAll(".service-anchors [data-jump]").forEach(b=>b.classList.toggle("on",b.dataset.jump===id));
  let jumpedAt=0;
  const jump=id=>{
    const target=document.getElementById(`sec-${id}`);
    if (!target) return;
    if (target.tagName==="DETAILS") target.open=true;
    if (SERVICE_SECTIONS.some(([key])=>key===id)) mark(id);
    jumpedAt=Date.now();
    body.scrollTo({top:target.offsetTop-body.offsetTop-4,behavior:"smooth"});
  };
  top.querySelectorAll("[data-jump]").forEach(b=>b.addEventListener("click",()=>jump(b.dataset.jump), {signal: runtime.lifecycle?.signal}));
  body.onscroll=()=>{
    top.classList.toggle("compact", body.scrollTop>24);
    // Keep the requested section while the jump scrolls, and at the end, where a short last
    // section cannot reach the top.
    if (Date.now()-jumpedAt<1000) return;
    const atEnd=body.scrollTop+body.clientHeight>=body.scrollHeight-2;
    const edge=atEnd ? body.scrollTop+body.clientHeight-60 : body.scrollTop+40;
    const passed=SERVICE_SECTIONS.filter(([id])=>{const el=document.getElementById(`sec-${id}`);return el && el.offsetTop-body.offsetTop<=edge;});
    mark((passed[passed.length-1] || SERVICE_SECTIONS[0])[0]);
  };
}

export function resolveLocalizedContent(poi, currentLanguageCode) {
  const code = String(currentLanguageCode || "").toLowerCase();
  const match = (poi.translations || []).find((translation) => translation.language?.code?.toLowerCase() === code);
  if (match) {
    return {
      title: match.title || poi.title,
      notes: match.notes || poi.notes,
      badge: `${t("map.language")} ${match.language?.code?.toUpperCase() || code.toUpperCase()}`,
    };
  }
  return {
    title: poi.title,
    notes: poi.notes,
    badge: poi.original_language ? `Fallback ${poi.original_language.code.toUpperCase()}` : t("map.language"),
  };
}

export function renderContacts(contacts) {
  const activeContacts = contacts.filter((contact) => contact?.is_active !== false);
  const actions = contactActions(activeContacts);
  if (!actions.length) {
    return `<p style="margin:0;font-size:14px">${escapeHtml(t("common.not_available"))}</p>`;
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

export function renderDetailHeaderActions(poi) {
  const actions = [directionsAction(poi), reportErrorAction(poi)].filter(Boolean);
  if (!actions.length) return "";
  return `
    <div class="detail-header-actions">
      ${actions.map((action) => `
        <a class="detail-header-action ${action.kind}" href="${escapeHtml(action.href)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>
          <span class="detail-header-action-icon">${contactActionIcon(action)}</span>
          <span class="detail-header-action-label">${escapeHtml(action.label)}</span>
        </a>
      `).join("")}
    </div>
  `;
}

export function renderCost(poi) {
  const label = costLabel(poi.cost_tag);
  const note = poi.cost_note ? `<span style="display:block;color:var(--ink-soft);margin-top:4px">${escapeHtml(poi.cost_note)}</span>` : "";
  return `<p style="margin:0;font-size:14px">${escapeHtml(label)}${note}</p>`;
}

export function renderTags(tags) {
  if (!tags.length) {
    return `<p style="margin:0;font-size:14px">${escapeHtml(t("common.not_available"))}</p>`;
  }
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag.label || tag.slug)}</span>`).join("")}
    </div>
  `;
}

export function contactActions(contacts) {
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

export function websiteHost(href) {
  try { return new URL(href).hostname.replace(/^www\./i, ""); } catch (_) { return ""; }
}

export function contactAction(contact) {
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

export function directionsAction(poi) {
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

export function reportErrorAction(poi) {
  if (!poi?.id) return null;
  const url = new URL("/contribuisci", window.location.origin);
  url.searchParams.set("city_id", String(context.cityId || ""));
  url.searchParams.set("lang", normalizeLang(state.lang));
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

export function contactActionIcon(action) {
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

export function googleMapsDirectionsHref(poi) {
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

export function contactHref(contact) {
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

export function costLabel(costTag) {
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

export function markerFallbackLabel(label) {
  const first = String(label || "").trim().charAt(0);
  return first ? first.toUpperCase() : "•";
}

export const POSITION_ISSUES = {
  no_address: "Indirizzo mancante", no_street: "Via mancante", no_street_unresolved: "Via mancante, non trovata",
  unresolved: "Indirizzo non trovato", municipality_only: "Trovato solo il comune", postcode_area_only: "Trovato solo il CAP",
  ambiguous: "Indirizzo ambiguo", no_coordinates: "Coordinate mancanti (Helpinet)",
};

/** Rebuild one select: values with a count under the other filters, plus the selected one. */

export function sourceCode(poi) {
  return poi.raw?.source_code || "helpinet";
}

/** Second list line: the facility, or the address when the facility repeats the title. */

export function facilityLine(poi) {
  const raw = poi.raw || {};
  const facility = raw.facility_name || raw.name || "";
  return facility && facility !== poi.title ? facility : (poi.address || facility);
}

export function sourceName(poi) {
  return poi.raw?.sources?.[0]?.source_name || "Helpinet";
}

/** Map-export positions are geocoded estimates; say how they were found. */

export function renderPositionNote(raw) {
  const pos = raw.position;
  if (!pos) return "";
  const match = pos.match ? ` Corrispondenza: ${escapeHtml(pos.match)}.` : "";
  return `<p class="source-note">Posizione ricavata dall’indirizzo della fonte con Nominatim (© OpenStreetMap contributors).${match}</p>`;
}


// Provenance wording by registry source kind; map exports stay the default.

export const SOURCE_KIND_TEXT = {
  map_export: {link: "mappa originale", acquired: "Esportazione KML acquisita il"},
  open_data: {link: "file originale", acquired: "File open data acquisito il"},
  web_pages: {link: "pagine originali", acquired: "Pagine web acquisite il"},
  document: {link: "guida originale", acquired: "Estratto dalla guida (PDF, revisione egi_sources) il"},
};

export function renderProvenance(poi) {
  const raw = poi.raw || {};
  const src = raw.sources?.[0] || {};
  if (sourceCode(poi) === "helpinet") return `<p>Helpinet · <a href="https://helpinet.app/app/" target="_blank" rel="noopener">helpinet.app</a>. Copia locale del ${escapeHtml((raw.observed_at || "—").slice(0, 10))}; data di raccolta originale non nota.</p>`;
  const kind = SOURCE_KIND_TEXT[src.source_kind] || SOURCE_KIND_TEXT.map_export;
  const link = src.source_url ? ` · <a href="${escapeHtml(src.source_url)}" target="_blank" rel="noopener">${kind.link}</a>` : "";
  return `<p>${escapeHtml(src.source_title || src.source_name || "Fonte")}${link}. ${kind.acquired} ${escapeHtml(raw.original_retrieved_at || "—")}.</p>${src.attribution?`<p class="source-note">${escapeHtml(src.attribution)}. Licenza di riuso non stabilita: solo preview locale.</p>`:""}`;
}

export function renderSourceAccess(display) {
  if (!display) return '<p>Indicazioni non disponibili.</p>';
  const texts=(display.texts || []).map(t=>`<div class="access-section"><h4>${escapeHtml(t.title)}</h4><p class="source-hours-text">${escapeHtml(t.text)}</p></div>`).join("");
  if (texts && !display.sections.length) return `${texts}<p class="source-note">${escapeHtml(display.note)}</p>`;
  return `${texts}${display.sections.length ? display.sections.map(section=>`<div class="access-section"><h4>${escapeHtml(section.title)}</h4><div class="service-chips">${section.entries.map(e=>`<span class="service-chip"${e.basis?` title="${escapeHtml(e.basis)}"`:""}>${escapeHtml(e.label)}${e.status==="derived"?" *":""}</span>`).join("")}</div></div>`).join("") : '<p>Nessuna indicazione positiva nella fonte.</p>'}<p class="source-note">${escapeHtml(display.note)}</p>`;
}

export function serviceButton(poi, matches = true) {
  return `<button type="button" class="related-service${matches ? "" : " outside-search"}" data-service-id="${escapeHtml(poi.id)}">${categoryBadge(resolveCategory(poi))}<span>${escapeHtml(poi.title)}</span><small>${escapeHtml(poi.raw?.place?.address || "")}</small>${matches?"":'<em>Altro servizio nel punto · fuori dai filtri attivi</em>'}<small>${escapeHtml((poi.raw?.native_classifications?.prestazioni || []).map(p=>p.nome).join(" · "))}</small></button>`;
}

export function bindServiceButtons() {
  document.querySelectorAll("[data-service-id]").forEach(button=>button.addEventListener("click",()=>openDetail(button.dataset.serviceId), {signal: runtime.lifecycle?.signal}));
}

export function openServiceChooser(items, matched = new Set(items.map(p=>p.id))) {
  if (items.length === 1) return openDetail(items[0].id);
  document.getElementById("sheet-detail").classList.remove("service-mode");
  document.getElementById("detail-top").innerHTML = "";
  document.getElementById("detail-bar").innerHTML = "";
  document.querySelector("#sheet-detail .sheet-head h2").textContent = "Scegli il servizio";
  document.getElementById("detail-body").innerHTML = `<h2>${escapeHtml(items[0].raw?.facility_name || "Servizi in questo punto")}</h2><p>${items.length} servizi con questa posizione. Scegli una scheda.</p>${items.map(p=>serviceButton(p,matched.has(p.id))).join("")}<p class="source-note">Servizi nella stessa posizione secondo le fonti; ogni servizio mantiene le proprie caratteristiche.</p>`;
  bindServiceButtons();
  document.querySelector("#sheet-detail .sheet-body").scrollTop=0;
  openSheet("sheet-detail");
}

export function categoryBadge(category) {
  const c=category || {};
  const url=normalizeCategoryIconPath(c.icon_path);
  return `<span class="category-badge" style="background:${escapeHtml(c.color || "#555")}">${url?`<img src="${escapeHtml(url)}" alt="">`:""}<span>${escapeHtml(categoryCaption(c.label || c.slug))}</span></span>`;
}

export function renderCanonicalInfo(poi) {
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

export function renderCanonicalSources(poi) {
  const raw=poi.raw;
  const sources=(raw.sources || []).map(source=>`<li>${escapeHtml(source.name)}${source.source_url ? ` · <a href="${escapeHtml(normalizeExternalHref(source.source_url) || "#")}" target="_blank" rel="noopener">Fonte</a>` : ""} · acquisita il ${escapeHtml((source.observed_at || "non noto").slice(0,10))}${source.published_at ? ` · data dichiarata ${escapeHtml(source.published_at.slice(0,10))}` : " · data originaria non nota"}</li>`).join("");
  const linked=(raw.linked_sources || []).map(source=>`<li>${escapeHtml(source.source_name)}: contatti e criteri approvati separatamente, con provenienza conservata.</li>`).join("");
  return `<details class="detail-section service-section service-sources-panel" id="sec-fonti"><summary><h3>Fonti e aggiornamenti</h3></summary><ul>${sources}${linked}</ul><p>Revisione canonica: ${escapeHtml(raw.revision_id)}.</p><p>La classificazione segue il vocabolario Roma v0.3. Posizioni e orari restano indicazioni delle fonti; contatta chi eroga il servizio.</p></details>`;
}

/** Refresh canonical opening results while retaining the visitor's filters and selection. */
