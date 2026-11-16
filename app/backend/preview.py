"""Present imported source subjects in the legacy frontend shape for the local preview.

Rows come from app.backend.subjects (PostgreSQL source evidence); this module
only adapts them and creates no canonical entities or publication decisions. Native classification
keys are presentation groups, not an adopted EGI taxonomy.

Helpinet normalization v0.3 fields are read when present (older runs lack them): curated hours,
dialable phone numbers, positions from same-group siblings, the data-age upper bound and
same-service merges (`helpinet_card`, `merge_cards`).
"""

from __future__ import annotations

import math
import re
from typing import Any

from . import taxonomy
from .presentation import AUDIENCE, DAYS, access_sections, weekly_hours, placement

LANGUAGES = [
    {
        "id": 1,
        "code": "it",
        "name_native": "Italiano",
        "name_english": "Italian",
        "direction": "ltr",
        "is_active": True,
        "sort_order": 1,
    },
    {
        "id": 2,
        "code": "en",
        "name_native": "English",
        "name_english": "English",
        "direction": "ltr",
        "is_active": True,
        "sort_order": 2,
    },
    {
        "id": 3,
        "code": "fr",
        "name_native": "Français",
        "name_english": "French",
        "direction": "ltr",
        "is_active": True,
        "sort_order": 3,
    },
    {
        "id": 4,
        "code": "ar",
        "name_native": "العربية",
        "name_english": "Arabic",
        "direction": "rtl",
        "is_active": True,
        "sort_order": 4,
    },
]
AREA = {
    "id": 1,
    "slug": "roma",
    "name": "Roma e dintorni",
    "country_code": "IT",
    "default_zoom": 11,
    "is_active": True,
    "default_center": {"type": "Point", "coordinates": [12.4964, 41.9028]},
    "geometry_bbox": {
        "type": "Polygon",
        "coordinates": [
            [[11.5, 41.0], [13.7, 41.0], [13.7, 42.7], [11.5, 42.7], [11.5, 41.0]]
        ],
    },
}
PRESENTATION = {
    "cibo": ("#d4691a", "eat"),
    "dormire": ("#2d5f3f", "bed"),
    "igiene_personale": ("#1e6091", "shower"),
    "curarmi": ("#b91c47", "hospital"),
    "documenti": ("#4a3b8c", "law"),
    "ascolto": ("#7c5e1a", "listen"),
    "lavoro": ("#466b70", "office"),
    "istruzione": ("#526f33", "building"),
    "abiti_e_coperte": ("#8b587b", "shirt"),
    "istituzioni": ("#3d4f63", "report"),
    "socialita": ("#a0522d", "listen"),
}
# Presentation crosswalk from map layers to the preview's need groups. It only
# decides where a map service appears in the existing filters; it is not an adopted
# EGI taxonomy and the original layer stays visible as the service type.
MAP_LAYER_GROUPS = {
    "gris-lazio-simm": {"*": "curarmi"},
    "scuolemigranti": {"*": "istruzione"},
    "programma-integra": {
        "Casa": "dormire",
        "Formazione / Scuole migranti": "istruzione",
        "Istituzioni / Enti pubblici": "istituzioni",
        "Lavoro": "lavoro",
        "Mense": "cibo",
        "Salute": "curarmi",
        "Socialità volontariato e tempo libero": "socialita",
        "Sportelli legali": "documenti",
    },
}
# Geocoded candidates shown as map points; coarser or ambiguous ones stay in the list.
MAP_POINT_STATUSES = {"matched_house", "matched_street", "matched_poi", "manual"}
SOURCE_SHORT_NAMES = {
    "gris-lazio-simm": "GrIS Lazio",
    "scuolemigranti": "Scuolemigranti",
    "programma-integra": "Programma Integra",
    "ministero-salute-consultori": "Ministero della Salute",
    "1522": "1522 Antiviolenza",
    "caritas-roma": "Caritas Roma",
    "roma-solidarieta": "Roma Solidarietà",
    "sant-egidio": "Sant'Egidio · DOVE 2026",
}
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
          "agosto", "settembre", "ottobre", "novembre", "dicembre"]


def is_map_row(row: dict[str, Any]) -> bool:
    """Map-export rows carry their source code; Helpinet fixtures may omit it."""
    return row.get("source_code", "helpinet") != "helpinet"


def is_visible(row: dict[str, Any]) -> bool:
    """Hide records the normalizer excluded and same-source copies of one entity.

    Normalizer 0.3 marks excluded records (e.g. state schools) and, for sources that
    repeat a placemark per layer or have a user-confirmed duplicate, keeps one primary
    record per entity; the others stay in the database as evidence. Older payloads
    without these fields are all visible.
    """
    p = row["payload"]
    if (p.get("classification") or {}).get("display") == "excluded":
        return False
    entity = p.get("entity") or {}
    # name_address: one placemark per layer; source_declared: a duplicate the source review confirmed
    return not (entity.get("mode") in {"name_address", "source_declared"} and entity.get("primary") is False)


def group_code(row: dict[str, Any]) -> str:
    """Return the presentation need group of a subject row."""
    p = row["payload"]
    if (p.get("classification") or {}).get("need"):
        return p["classification"]["need"]
    if is_map_row(row):
        groups = MAP_LAYER_GROUPS.get(row["source_code"], {})
        return groups.get(p.get("layer") or "", groups.get("*", "non_classificato"))
    return p["source_classifications"].get("bisogno") or "non_classificato"


def categories(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expose source-native needs as legacy UI groups, without canonical taxonomy writes."""
    codes = sorted({group_code(r) for r in rows if is_visible(r)})
    return [
        {
            "id": i,
            "slug": code,
            "label": code.replace("_", " "),
            "color": PRESENTATION.get(code, ("#5a5a5a", "office"))[0],
            "icon_path": f"/static/assets/icons/default/{PRESENTATION.get(code,('#5a5a5a','office'))[1]}.svg",
            "sort_order": i,
            "area_id": 1,
            "is_active": True,
            "classification_status": "source_native_unmapped",
        }
        for i, code in enumerate(codes, 1)
    ]


def source_point(position: dict[str, Any]) -> dict[str, Any] | None:
    """Display only finite, in-range source pairs; do not geocode or infer accuracy."""
    try:
        coordinates = position["coordinate"]
        lat, lng = float(coordinates["lat"]), float(coordinates["lng"])
        if not (
            math.isfinite(lat)
            and math.isfinite(lng)
            and -90 <= lat <= 90
            and -180 <= lng <= 180
        ):
            return None
    except (KeyError, ValueError, TypeError):
        return None
    return {"type": "Point", "coordinates": [lng, lat]}


def derived_point(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Point of a same-group sibling at the same address (importer v0.3), else None."""
    derived = (payload.get("location") or {}).get("derived_position") or {}
    return source_point({"coordinate": {"lat": derived.get("lat"), "lng": derived.get("lng")}}) if derived else None


def helpinet_contacts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Card contacts; a phone gets one entry per dialable number (`dial`), raw value kept.

    "0667105197/98" becomes two entries; a value the importer could not read stays as
    text without a link (`dial` None). Older runs have no `normalized` field.
    """
    result = []
    for c in payload["contacts"]:
        numbers = c.get("normalized") if c["channel"] == "phone" and "normalized" in c else None
        if numbers is None:
            result.append({"type": c["channel"], "value": c["value"], "label": None, "is_active": True})
        elif not numbers:
            result.append({"type": c["channel"], "value": c["value"], "dial": None, "label": "Numero da verificare", "is_active": True})
        else:
            for number in numbers:
                result.append({"type": c["channel"], "value": c["value"] if len(numbers) == 1 else number,
                               "dial": number, "label": None, "is_active": True})
    return result


def data_as_of(fresh: dict[str, Any] | None, observed_at: str | None) -> dict[str, Any]:
    """Freshness from an upper bound on the data date (Helpinet v0.3), else the generic note."""
    if not fresh or not fresh.get("latest"):
        return freshness(None, observed_at)
    latest = fresh["latest"]
    acquired = (observed_at or "")[:10] or None
    year, month, day = (int(x) for x in latest.split("-"))
    months = (int(acquired[:4]) - year) * 12 + (int(acquired[5:7]) - month) if acquired else None
    when = f"{day} {MONTHS[month - 1]} {year}"
    age = f" (circa {months} mesi prima dell'acquisizione)" if months else ""
    return {"declared": f"{when} o precedenti", "months_old": months, "acquired": acquired, "stale": bool(months and months >= 18),
            "label": f"Dati del {when} o precedenti{age}; la data esatta di raccolta non è nota. Da verificare con chi eroga il servizio."}


def merge_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Show a service the source published twice as one card (importer v0.3 `merge`).

    The secondary record is hidden (it stays in the database); the primary card shows each
    record's hours labelled by its own audience, the union of contacts, access flags and
    prestazioni, and a warning when two records give different hours for the same audience.
    """
    by_locator = {c["source_locator"]: c for c in cards}
    result = []
    for card in cards:
        merge = card.pop("_merge", None) or {}
        if merge.get("role") == "merged_into" and merge.get("primary") + ":subject" in by_locator:
            continue
        if merge.get("role") == "primary":
            members = [by_locator.get(m + ":subject") for m in merge["members"]]
            members = [m for m in members if m is not None]
            if len(members) > 1:
                _combine(card, members, merge)
        result.append(card)
    return result


def _combine(card: dict[str, Any], members: list[dict[str, Any]], merge: dict[str, Any]) -> None:
    """Fold member cards into the primary card (see `merge_cards`)."""
    variants = merge.get("variants") or []
    common = set.intersection(*(set(v.get("access_true", [])) for v in variants)) if variants else set()
    days: dict[str, dict[str, Any]] = {d["day"]: {**d, "intervals": [], "issues": []} for d in members[0]["hours_display"]["days"]}
    warnings: list[str] = []
    labels = []
    def signature(member: dict[str, Any]) -> list[Any]:
        return [[(i["opens_raw"], i["closes_raw"]) for i in d["intervals"]] for d in member["hours_display"]["days"]]
    distinct = len({repr(signature(m)) for m in members}) > 1
    seen: set[str] = set()
    for index, (member, variant) in enumerate(zip(members, variants or [{}] * len(members))):
        if repr(signature(member)) in seen:
            continue  # same hours published twice (e.g. a record missing only the email)
        seen.add(repr(signature(member)))
        own = [AUDIENCE.get(code, code) for code in sorted(set(variant.get("access_true", [])) - common) if code in AUDIENCE]
        label = (", ".join(own) or f"versione {chr(65 + index)} della fonte") if distinct else None
        if label:
            labels.append(label)
        for day in member["hours_display"]["days"]:
            target = days[day["day"]]
            target["intervals"] += [{**i, "label": f'{i["label"]} · {label}' if label else i["label"], "audience": label} for i in day["intervals"]]
            target["issues"] += day["issues"]
            target["state"] = "declared" if target["intervals"] else "unknown"
        warnings += member["hours_display"].get("warnings", [])
    if "hours_differ_for_same_audience" in merge.get("conflicts", []):
        warnings.append("La fonte pubblica questo servizio due volte con orari diversi: da verificare.")
    flags = {k: v for m in members for k, v in (m.get("access_raw") or {}).items() if v is True}
    natives = dict(card["native_classifications"])
    natives["prestazioni"] = list({p.get("nome"): p for m in members for p in m["native_classifications"].get("prestazioni") or []}.values())
    contacts = list({(c["type"], c.get("dial") or c["value"]): c for m in members for c in m["contacts"]}.values())
    card.update({
        "hours_display": {**card["hours_display"], "days": [days[k] for k, _ in DAYS], "warnings": warnings,
                          "note": (f"Orari dichiarati da Helpinet in {len(members)} schede dello stesso servizio ({'; '.join(labels)}); da verificare."
                                   if labels else card["hours_display"]["note"])},
        "access_raw": {**card["access_raw"], **flags},
        "access_display": access_sections({**card["access_raw"], **flags}),
        "native_classifications": natives,
        "contacts": contacts,
        "merged_from": [m["source_locator"] for m in members],
    })


def services(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adapt source subjects to existing map cards while labelling all data unreviewed.

    Each card is then placed in the need-first presentation taxonomy (`taxonomy.apply`);
    the source's own need stays in `source_category`.
    """
    return [taxonomy.apply(card) for card in merge_cards(_source_cards(rows))]


def _source_cards(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cards with the source-native need group as category (before the taxonomy)."""
    by_code = {c["slug"]: c for c in categories(rows)}
    result = []
    for row in rows:
        if not is_visible(row):
            continue
        if is_map_row(row):
            result.append(map_service(row, by_code[group_code(row)]))
            continue
        p = row["payload"]
        code = group_code(row)
        position = p["location"]["source_position"]
        point = source_point(position) or derived_point(p)
        derived = source_point(position) is None and point is not None
        result.append(
            {
                "id": row["id"],
                "place_id": (p.get("source_group") or {}).get("external_key")
                or row["id"],
                "service_title": p["source_classifications"].get("tipologia")
                or p["name"]
                or "Servizio",
                "facility_name": (p.get("source_group") or {}).get("name") or p["name"],
                "source_group": p.get("source_group"),
                "derived_summary": p.get("derived_summary"),
                "source_values": p.get("source_values", {}),
                "access_display": access_sections(p["access"]["raw_flags"]),
                "hours_display": weekly_hours(p["hours"].get("corrected_value") or p["hours"]["raw_value"], p["hours"].get("corrections")),
                "placement": placement(p, point, derived),
                "delivery_mode": p.get("delivery_mode"),
                "name": p["name"],
                "description": p["description"],
                "data_status": "unreviewed_source_preview",
                "source_locator": row["source_locator"],
                "run_id": row["run_id"],
                "observed_at": row["observed_at"],
                "original_retrieved_at": None,
                "freshness": data_as_of(p.get("data_as_of"), row.get("observed_at")),
                "category": by_code[code],
                "category_id": by_code[code]["id"],
                "subcategory": None,
                "subcategories": [],
                "tags": [],
                "cost_tag": None,
                "cost_note": None,
                "hours": [],
                "hours_raw": p["hours"]["raw_value"],
                "contacts": helpinet_contacts(p),
                "place": {
                    "id": (p.get("source_group") or {}).get("external_key")
                    or row["id"],
                    "name": (p.get("source_group") or {}).get("name") or p["name"],
                    "address": p["location"]["address_raw"],
                    "geometry": point,
                    "contacts": [],
                    "is_protected_address": False,
                },
                "source_code": "helpinet",
                "_merge": p.get("merge"),
                "sources": [
                    {
                        "source_name": "Helpinet",
                        "source_title": "Helpinet",
                        "source_url": "https://helpinet.app/app/",
                        "is_primary": True,
                    }
                ],
                "access_raw": p["access"]["raw_flags"],
                "organization_raw": p["organization_claim"]["name_raw"],
                "native_classifications": p["source_classifications"],
                "review_required": p["review_required"],
                "itinerant_source": position.get("itinerante") is True,
                "coordinate_status": "source_group_sibling_unverified" if derived else "source_unverified",
                "is_active": True,
            }
        )
    return result


POINT_LABELS = {
    "matched_house": "Posizione stimata dal civico (OpenStreetMap) · da verificare",
    "matched_street": "Posizione stimata sulla via, civico non trovato · da verificare",
    "matched_poi": "Posizione del luogo indicato trovata su OpenStreetMap · da verificare",
    "manual": "Posizione corretta a mano · da verificare",
}
# Why a service has no map point: one explicit reason per record (importer `issue`).
ISSUE_LABELS = {
    "ambiguous": "Indirizzo con più corrispondenze · posizione non mostrata",
    "postcode_area_only": "Trovato solo il CAP · posizione non mostrata",
    "municipality_only": "Trovato solo il comune · posizione non mostrata",
    "no_street": "Indirizzo senza via · posizione da completare",
    "no_street_unresolved": "Indirizzo senza via · posizione da completare",
    "unresolved": "Indirizzo non trovato · posizione da completare",
    "no_address": "Indirizzo non indicato dalla fonte",
    "no_coordinates": "Coordinate non indicate dalla fonte · posizione da completare",
}
ISSUE_NAMES = {
    "ambiguous": "Indirizzo ambiguo", "postcode_area_only": "Solo CAP", "municipality_only": "Solo comune",
    "no_street": "Via mancante", "no_street_unresolved": "Via mancante", "unresolved": "Indirizzo non trovato",
    "no_address": "Indirizzo mancante", "no_coordinates": "Coordinate mancanti",
}


def geocode_issue(geocode: dict[str, Any] | None) -> str:
    """The importer's issue, or the same classification for bundles older than strategy 0.3."""
    g = geocode or {}
    if g.get("issue"):
        return g["issue"]
    status = g.get("status") or "unresolved"
    if status in MAP_POINT_STATUSES:
        return "ambiguous" if g.get("ambiguous") else "ok"
    return {"postcode_area": "postcode_area_only", "locality_only": "municipality_only", "no_address": "no_address"}.get(status, "unresolved")


def map_position(geocode: dict[str, Any] | None) -> tuple[dict[str, Any] | None, dict[str, str]]:
    """Show confident candidates (house, street, named place, manual) as points; others list-only with a reason."""
    status = (geocode or {}).get("status") or "unresolved"
    chosen = (geocode or {}).get("chosen") or {}
    issue = geocode_issue(geocode)
    if issue in {"ok", "manual"} and status in POINT_LABELS:
        point = source_point({"coordinate": {"lat": chosen.get("lat"), "lng": chosen.get("lon")}})
        if point:
            return point, {"section": "services", "status": f"geocoded_{status}", "label": POINT_LABELS[status], "issue": issue}
    issue = issue if issue in ISSUE_LABELS else "unresolved"
    return None, {"section": "services", "status": f"geocode_{status}", "label": ISSUE_LABELS[issue], "issue": issue}


def text_hours(raw: Any, source_name: str) -> dict[str, Any]:
    """Keep free-text source hours readable without parsing them into intervals."""
    display = weekly_hours({})
    display["raw_text"] = raw if isinstance(raw, str) and raw.strip() else None
    display["note"] = (f"Orari come testo originale di {source_name}; non interpretati, da verificare."
                       if display["raw_text"] else f"{source_name} non indica orari.")
    display["opening_note"] = (f"Orari {source_name} solo come testo" if display["raw_text"]
                               else f"{source_name} non indica orari")
    return display


def declared_update_label(update: dict[str, Any] | None) -> str | None:
    """Render the source's own update note, e.g. 'maggio 2024 (GrIS Lazio)'."""
    if not update:
        return None
    month, year = update.get("month"), update.get("year")
    when = " ".join(str(v) for v in [MONTHS[month - 1] if isinstance(month, int) and 1 <= month <= 12 else None, year] if v)
    who = update.get("curator_named")
    text = " ".join(filter(None, [when, f"({who})" if who else None])) or update.get("text")
    return text or None


GENERIC_NAME = re.compile(r"^(rilascio stp/eni|ambulatorio( di)? (medicina generale|pediatria|malattie infettive))\s*$", re.I)
CLAIM_GROUPS = {"audience": "Destinatari indicati", "cost": "Costo indicato", "procedure": "Come accedere"}


def claim_sections(claims: list[dict[str, Any]]) -> dict[str, Any]:
    """Access claims from the normalizer, grouped like Helpinet's, each with its basis."""
    sections = []
    for group, title in CLAIM_GROUPS.items():
        entries = [{"code": c["code"], "label": c["label"], "value": True, "status": c.get("certainty"), "basis": c.get("basis")}
                   for c in claims if c.get("group") == group]
        if entries:
            sections.append({"code": group, "title": title, "entries": entries})
    derived = any(c.get("certainty") == "derived" for c in claims)
    return {
        "sections": sections,
        "unselected_count": 0,
        "note": ("Le indicazioni con * sono dedotte dal tipo di servizio (es. STP/ENI), non scritte dalla fonte: da verificare."
                 if derived else "Indicazioni della fonte da verificare."),
        "cost_state": "source_claim" if any(c.get("group") == "cost" for c in claims) else "unknown",
    }


def source_access_texts(facts: dict[str, Any]) -> list[dict[str, str]]:
    """Printed audience, access and heading-organization text of a reviewed source entry.

    Shown as the source wrote it (no interpretation); referral numbers stay apart from
    the service's own contacts. Empty for sources without `source_facts`.
    """
    payload = facts.get("payload") or {}
    access = payload.get("access") or {}
    texts = []
    def add(title: str, text: Any) -> None:
        if isinstance(text, str) and text.strip():
            texts.append({"title": title, "text": text.strip()})
    add("Destinatari", (payload.get("audience") or {}).get("raw_text"))
    add("Modalità di accesso", access.get("raw_notes"))
    for context in access.get("shared_contexts") or []:
        add("Modalità di accesso (indicazione comune della sezione)", context.get("raw_text"))
    add("Numeri per l'accesso (SOS o invio, non del servizio)",
        "\n".join(c.get("raw_value") or c.get("value") or "" for c in access.get("referral_contacts") or []))
    add("Prestazioni", (payload.get("offerings") or {}).get("raw_text"))
    add("Organizzazione indicata nell'intestazione (ruolo da verificare)",
        "\n".join(o["name"] for o in payload.get("source_organizations") or [] if o.get("name")))
    return texts


SCHEDULE_SCOPES = {  # egi_sources schedule scopes -> card headings; unspecified scopes get none
    "dependency_treatment_schedule": "Orario del servizio per le dipendenze",
    "hygiene_service": "Servizio igiene", "laundry_service": "Lavanderia", "clothing_service": "Guardaroba",
    "contact_availability": "Disponibilità per contatti", "orientation_office_schedule": "Sportello di orientamento",
    "admission_interview": "Colloquio di ammissione",
    "admission_interview_at_referral_office": "Colloquio di ammissione presso l'ufficio che invia",
    "admission_interview_at_shelter": "Colloquio di ammissione presso la struttura",
    "entry": "Ingresso", "exit": "Uscita", "ticket_distribution": "Distribuzione dei biglietti",
    "overnight_accommodation": "Accoglienza notturna", "accommodation": "Accoglienza",
    "accommodation_with_seasonal_limits": "Accoglienza con limiti stagionali",
    "unspecified_24_hour_availability": "Disponibilità continua (da verificare)",
}
SCHEDULE_LABEL_KINDS = {"audience": "Destinatari", "prestation": "Prestazione", "availability": "Disponibilità",
                        "access": "Accesso", "capacity": "Capienza"}


def scoped_schedules(facts: dict[str, Any]) -> list[dict[str, Any]]:
    """Printed schedule blocks with the scope and labels the source review assigned.

    Labels from the user's review are marked, so they stay distinguishable from
    printed facts. Nothing becomes an opening interval here.
    """
    hours = (facts.get("payload") or {}).get("hours") or {}
    blocks = []
    for item in hours.get("scoped_schedules") or []:
        labels = [{"kind": SCHEDULE_LABEL_KINDS.get(lab.get("kind"), lab.get("kind") or ""), "text": lab.get("text") or "",
                   "interpreted": lab.get("basis") == "user_interpretation"} for lab in item.get("labels") or []]
        blocks.append({"title": SCHEDULE_SCOPES.get(item.get("scope") or ""), "text": (item.get("raw_text") or "").strip(), "labels": labels})
    return [b for b in blocks if b["text"]]


def source_hours(weekly: dict[str, Any] | None, raw: Any, source_name: str) -> dict[str, Any]:
    """Weekly hours when the source text parsed completely, otherwise the text as is."""
    if weekly:
        display = weekly_hours(weekly)
        display["note"] = f"Orari dichiarati da {source_name}, letti dal testo originale; giorni senza orari: considerati chiusi."
        display["raw_text_original"] = raw
        display["opening_note"] = f"Orari {source_name} non revisionati · fuso Europe/Rome"
        return display
    return text_hours(raw, source_name)


def freshness(update: dict[str, Any] | None, observed_at: str | None) -> dict[str, Any]:
    """How current the source says its data is. EGI has not verified any of it.

    Imported as is; a reviewer enriches, cleans and verifies with the providers
    (user decision, 2026-11-09). Here we only make the age visible.
    """
    acquired = (observed_at or "")[:10] or None
    if not update or not update.get("year"):
        return {"declared": None, "months_old": None, "acquired": acquired, "stale": None,
                "label": f"La fonte non indica quando è stata aggiornata; dati acquisiti il {acquired or '—'}. Da verificare con chi eroga il servizio."}
    year, month = update["year"], update.get("month") or 6
    ref_year, ref_month = (int(acquired[:4]), int(acquired[5:7])) if acquired else (year, month)
    months = (ref_year - year) * 12 + (ref_month - month)
    when = declared_update_label(update) or str(year)
    stale = months >= 18
    text = f"Aggiornamento dichiarato dalla fonte: {when}"
    if stale:
        age = f"{months} mesi" if months < 24 else f"circa {months // 12} anni"
        text += f" ({age} prima dell'acquisizione): le informazioni potrebbero non essere aggiornate."
    return {"declared": when, "months_old": months, "acquired": acquired, "stale": stale, "label": text + " Da verificare con chi eroga il servizio."}


def map_service(row: dict[str, Any], category: dict[str, Any]) -> dict[str, Any]:
    """Adapt a map-export service and its geocoded candidate to the card shape."""
    p = row["payload"]
    source_name = SOURCE_SHORT_NAMES.get(row["source_code"]) or row.get("source_name") or row["source_code"]
    geocode = row.get("geocode")
    point, place_status = map_position(geocode)
    facts = p.get("source_facts") or {}  # reviewed upstream facts (Sant'Egidio guide); absent for map exports
    delivery = facts.get("delivery_mode")
    if delivery in {"telephone", "online"}:  # remote by the source's own statement, as for Helpinet
        place_status = {"section": "directory", "status": delivery, "label": "Servizio a distanza"}
    location = p.get("location") or {}
    classification = p.get("classification") or {}
    entity = p.get("entity") or {}
    topics = entity.get("topics") or (p.get("source_classifications") or {}).get("help_topics") or []
    levels = (p.get("course_facts") or {}).get("levels") or []
    layer = p.get("layer")
    service_type = classification.get("service_type") or layer
    chosen = (geocode or {}).get("chosen") or {}
    claims = classification.get("access_claims") or []
    weekly = (p.get("hours") or {}).get("weekly")
    site_group = ({"external_key": entity["key"], "name": p.get("name"), "raw_fields": {}, "service_count": len(entity.get("members") or [])}
                  if entity.get("mode") == "site_address" and len(entity.get("members") or []) > 1 else None)
    card = {
        "id": row["id"],
        "place_id": row["id"],
        "service_title": classification.get("display_name") or p.get("name") or layer or "Servizio",
        # Generic source names ("Rilascio STP/ENI") give way to the site the normalizer found.
        "facility_name": (classification.get("site_hint") if GENERIC_NAME.match(p.get("name") or "") else None) or p.get("name"),
        "source_group": site_group,
        "derived_summary": None,
        "source_values": p.get("source_values", {}),
        "access_display": {**claim_sections(claims), "texts": source_access_texts(facts)},
        "hours_display": {**source_hours(weekly, (p.get("hours") or {}).get("raw_value"), source_name), "scoped": scoped_schedules(facts)},
        "placement": place_status,
        "delivery_mode": delivery,
        "name": p.get("name"),
        "description": p.get("description") or p.get("offer_text"),
        "offer_text": p.get("offer_text"),
        "data_status": "unreviewed_source_preview",
        "source_code": row["source_code"],
        "source_locator": row["source_locator"],
        "run_id": row["run_id"],
        "observed_at": row["observed_at"],
        "original_retrieved_at": row["observed_at"],
        "declared_update": declared_update_label(p.get("declared_update")),
        "freshness": freshness(p.get("declared_update"), row.get("observed_at")),
        "position": {
            "status": (geocode or {}).get("status") or "unresolved",
            "ambiguous": bool((geocode or {}).get("ambiguous")),
            "match": chosen.get("display_name"),
            "provider": (geocode or {}).get("provider"),
            "attribution": (geocode or {}).get("attribution"),
        },
        "category": category,
        "category_id": category["id"],
        "subcategory": None,
        "subcategories": [],
        "tags": [],
        "cost_tag": None,
        "cost_note": None,
        "hours": [],
        "hours_raw": (p.get("hours") or {}).get("raw_value"),
        "contacts": [
            {"type": c["channel"], "value": c.get("normalized") if c["channel"] == "website" and c.get("normalized") else c["value"],
             "label": None, "is_active": True}
            for c in p.get("contacts", [])
        ],
        "place": {
            "id": row["id"],
            "name": p.get("name"),
            "address": location.get("address_raw"),
            "geometry": point,
            "contacts": [],
            "is_protected_address": False,
        },
        "sources": [{
            "source_name": source_name,
            "source_title": row.get("source_name"),
            "source_url": row.get("dataset_url") or row.get("source_homepage"),
            "attribution": row.get("source_attribution"),
            "source_kind": row.get("source_kind"),
            "is_primary": True,
        }],
        "access_raw": {c["code"]: True for c in claims},
        "organization_raw": (p.get("organization_claim") or {}).get("name_raw"),
        "needs": entity.get("needs") or [category["slug"]],
        "sector": classification.get("sector"),
        "entity_kind": classification.get("entity_kind"),
        "entity_members": len(entity.get("members") or [1]),
        "course_facts": p.get("course_facts"),
        "native_classifications": {
            "tipologia": service_type,
            "layer": layer,
            "prestazioni": [{"id": f"topic:{t}", "nome": t} for t in topics] + [{"id": f"level:{lv}", "nome": f"Livello {lv}" if lv[0].isalpha() and len(lv) == 2 else lv.capitalize()} for lv in levels],
            "layer_path": (p.get("source_classifications") or {}).get("layer_path"),
        },
        "review_required": p.get("review_required", []),
        "itinerant_source": False,
        "coordinate_status": "geocoded_candidate_unverified" if point else "not_positioned",
        "is_active": True,
    }
    if p.get("site_page"):  # Scuolemigranti sede page (importer 0.4): courses, enrolment, page date
        extra = course_fields(p, row, source_name)
        extra["access_raw"] = {**card["access_raw"], **extra["access_raw"]}
        card.update(extra)
    return card


DAY_SHORT = {"lun": "Lun", "mar": "Mar", "mer": "Mer", "gio": "Gio", "ven": "Ven", "sab": "Sab", "dom": "Dom"}
COURSE_FLAGS = {"online": "Corsi online", "online_e_presenza": "Corsi anche online", "solo_donne": "Solo donne"}


def course_hours(p: dict[str, Any]) -> dict[str, Any]:
    """Lesson times by level from a sede page (Scuolemigranti decisions 3, 4 and 6, 2026-11-16).

    `kind` tells the map how to read the card: "lessons" (next lesson, never "Aperto ora"),
    "office" (reception hours as printed; CPIA say enrolment is at the secretariat) or "none".
    `days` carries each session as an interval labelled with its level, so today's lessons show.
    """
    hours = p.get("hours") or {}
    facts = p.get("course_facts") or {}
    cpia = bool(facts.get("cpia"))
    courses, rows = [], {key: [] for key, _ in DAYS}
    for course in hours.get("courses") or []:
        level = course.get("level") or "Livello non indicato"
        sessions = []
        for s in course.get("sessions") or []:
            sessions.append(f'{", ".join(DAY_SHORT[d] for d in s["days"])} {s["start"]} – {s["end"]}')
            for day in s["days"]:
                rows[day].append({"opens_raw": s["start"], "closes_raw": s["end"], "label": f'{s["start"]} – {s["end"]} · {level}',
                                  "level": level, "overnight": False, "review_note": None, "raw": s["raw"]})
        courses.append({"level": level, "sessions": sessions + course.get("unparsed_times", []), "note": course.get("note_raw"),
                        "flags": [COURSE_FLAGS[f] for f in course.get("flags", []) if f in COURSE_FLAGS], "summer": course.get("summer")})
    days = [{"day": key, "label": label, "intervals": sorted(rows[key], key=lambda i: i["opens_raw"]),
             "state": "declared" if rows[key] else "unknown", "issues": []} for key, label in DAYS]
    office = hours.get("office_text")
    if courses:
        kind, status = "lessons", None
    elif office:
        kind, status = "office", ("Iscrizioni e informazioni in segreteria" if cpia else "Orari di segreteria indicati")
    else:
        kind, status = "none", ("Orario non disponibile — contatta la segreteria" if cpia else "Orari delle lezioni non indicati")
    return {
        "kind": kind, "status_label": status, "days": days, "courses": courses, "office_text": office, "cpia": cpia,
        "warnings": [], "raw_text_original": hours.get("raw_value"),
        "note": "Orari delle lezioni dalla pagina della sede su scuolemigranti.org; non sono orari di apertura.",
        "opening_note": "Orari delle lezioni · fuso Europe/Rome",
    }


def page_freshness(fresh: dict[str, Any] | None, observed_at: str | None) -> dict[str, Any]:
    """Data date = the sede page's modification date; older than the threshold → "dato da verificare"."""
    acquired = (observed_at or "")[:10] or None
    if not fresh or not fresh.get("page_modified"):
        return {"declared": None, "months_old": None, "acquired": acquired, "stale": True,
                "label": "La pagina della sede non indica quando è stata aggiornata: dato da verificare."}
    year, month, day = (int(x) for x in fresh["page_modified"].split("-"))
    when = f"{day} {MONTHS[month - 1]} {year}"
    months = fresh.get("months_before_capture")
    stale = bool(fresh.get("stale"))
    label = f"Pagina della sede aggiornata il {when}"
    if stale:
        label += f" (circa {months} mesi prima dell'acquisizione; soglia {fresh.get('stale_after_months', 12)} mesi): dato da verificare."
    else:
        label += ". Da verificare con chi organizza il corso."
    return {"declared": when, "months_old": months, "acquired": acquired, "stale": stale, "label": label}


def course_fields(p: dict[str, Any], row: dict[str, Any], source_name: str) -> dict[str, Any]:
    """Card fields of a Scuolemigranti site with its sede page (overrides of `map_service`)."""
    facts = p.get("course_facts") or {}
    page = p.get("site_page") or {}
    flags = facts.get("flags") or []
    stated = [o["name"] for o in p.get("offers_stated") or []]
    prestazioni = [{"id": f"offer:{name}", "nome": name} for name in stated]
    prestazioni += [{"id": f"flag:{f}", "nome": COURSE_FLAGS[f]} for f in flags if f in COURSE_FLAGS]
    contacts = []
    for c in p.get("contacts", []):
        if c.get("role") == "source_page":
            continue  # the page link is in Fonti, not among the service's own contacts
        value = c.get("normalized") if c["channel"] == "website" and c.get("normalized") else c["value"]
        entry = {"type": c["channel"], "value": value, "label": None, "is_active": True}
        if c["channel"] == "phone" and c.get("normalized"):
            entry["dial"] = c["normalized"].replace("+39", "", 1) if c["normalized"].startswith("+39") else c["normalized"]
        contacts.append(entry)
    claims = {"donna": True} if "solo_donne" in flags else {}
    if flags and {"online", "online_e_presenza"} & set(flags):
        claims["corsi_online"] = True
    return {
        "hours_display": course_hours(p),
        "freshness": page_freshness(p.get("data_as_of"), row.get("observed_at")),
        "declared_update": None,
        "description": p.get("description"),
        "contacts": contacts,
        "access_raw": {**claims},
        "course_levels": facts.get("level_codes") or [],
        "course_flags": flags,
        "summer_closure": bool(facts.get("summer_closure")),
        "enrolment": p.get("enrolment"),
        "site_page_url": page.get("url"),
        "organization_url": (p.get("organization_claim") or {}).get("url"),
        "native_classifications": {"tipologia": "Corsi linguistici", "layer": p.get("layer"),
                                   "prestazioni": prestazioni + [{"id": f"level:{lv}", "nome": f"Livello {lv}"} for lv in facts.get("levels") or []],
                                   "layer_path": (p.get("source_classifications") or {}).get("layer_path")},
        "sources": [{"source_name": source_name, "source_title": "Rete Scuolemigranti — pagina della sede",
                     "source_url": page.get("url") or row.get("dataset_url"), "attribution": row.get("source_attribution"),
                     "source_kind": row.get("source_kind"), "is_primary": True}],
    }


def debug_positions(rows: list[dict[str, Any]], source_code: str) -> dict[str, Any]:
    """Every position candidate of one source, for local accuracy checks.

    Unlike services(), this includes the candidates that are not shown as map points
    (CAP area, municipality, ambiguous), with score, OSM match and alternatives.
    """
    points = []
    for row in rows:
        code = row.get("source_code", "helpinet")
        if code != source_code or not is_visible(row):
            continue
        p = row["payload"]
        if is_map_row(row):
            geocode = row.get("geocode") or {}
            chosen = geocode.get("chosen") or {}
            shown, _ = map_position(geocode)
            status = geocode.get("status") or "unresolved"
            lat, lon = chosen.get("lat"), chosen.get("lon")
            extra = {
                "score": chosen.get("score"),
                "match": chosen.get("display_name"),
                "reasons": chosen.get("reasons", []),
                "step": chosen.get("step"),
                "ambiguous": bool(geocode.get("ambiguous")),
                "alternatives": geocode.get("alternatives", []),
                "postcode_anchor": geocode.get("postcode_anchor"),
                "issue": geocode_issue(geocode),
                "provider": chosen.get("provider") or geocode.get("provider"),
            }
            layer = p.get("layer")
        else:
            shown = source_point(p["location"]["source_position"] or {})
            status = "source_point" if shown else "no_position"
            if shown is None and (shown := derived_point(p)):
                status = "source_group_sibling"
            lat, lon = (shown["coordinates"][1], shown["coordinates"][0]) if shown else (None, None)
            extra = {"ambiguous": False}
            layer = p["source_classifications"].get("tipologia")
        points.append({
            "id": row["id"],
            "name": p.get("name"),
            "layer": layer,
            "address": (p.get("location") or {}).get("address_raw"),
            "status": status,
            "lat": lat,
            "lon": lon,
            "shown_on_map": shown is not None,
            "locator": row.get("source_locator"),
            **extra,
        })
    counts: dict[str, int] = {}
    for point in points:
        counts[point["status"]] = counts.get(point["status"], 0) + 1
    return {"source": source_code, "total": len(points), "status_counts": counts, "points": points}


def source_list(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Displayed sources with their service counts."""
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = row.get("source_code", "helpinet")
        entry = seen.setdefault(code, {"code": code, "name": SOURCE_SHORT_NAMES.get(code, row.get("source_name") or "Helpinet"),
                                       "dataset_url": row.get("dataset_url"), "services": 0})
        entry["services"] += 1
    return sorted(seen.values(), key=lambda e: e["name"])
