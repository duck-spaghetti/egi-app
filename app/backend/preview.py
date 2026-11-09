"""Present imported source subjects in the legacy frontend shape for the local preview.

Rows come from app.backend.subjects (PostgreSQL source evidence); this module
only adapts them and creates no canonical entities or publication decisions. Native classification
keys are presentation groups, not an adopted EGI taxonomy.
"""

from __future__ import annotations

import math
import re
from typing import Any

from .presentation import access_sections, weekly_hours, placement

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
}
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
          "agosto", "settembre", "ottobre", "novembre", "dicembre"]


def is_map_row(row: dict[str, Any]) -> bool:
    """Map-export rows carry their source code; Helpinet fixtures may omit it."""
    return row.get("source_code", "helpinet") != "helpinet"


def is_visible(row: dict[str, Any]) -> bool:
    """Hide records the normalizer excluded and same-source copies of one entity.

    Normalizer 0.3 marks excluded records (e.g. state schools) and, for sources that
    repeat a placemark per layer, keeps one primary record per entity; the others stay
    in the database as evidence. Older payloads without these fields are all visible.
    """
    p = row["payload"]
    if (p.get("classification") or {}).get("display") == "excluded":
        return False
    entity = p.get("entity") or {}
    return not (entity.get("mode") == "name_address" and entity.get("primary") is False)


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


def services(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adapt source subjects to existing map cards while labelling all data unreviewed."""
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
                "hours_display": weekly_hours(p["hours"]["raw_value"]),
                "placement": placement(p, source_point(position)),
                "delivery_mode": p.get("delivery_mode"),
                "name": p["name"],
                "description": p["description"],
                "data_status": "unreviewed_source_preview",
                "source_locator": row["source_locator"],
                "run_id": row["run_id"],
                "observed_at": row["observed_at"],
                "original_retrieved_at": None,
                "freshness": freshness(None, row.get("observed_at")),
                "category": by_code[code],
                "category_id": by_code[code]["id"],
                "subcategory": None,
                "subcategories": [],
                "tags": [],
                "cost_tag": None,
                "cost_note": None,
                "hours": [],
                "hours_raw": p["hours"]["raw_value"],
                "contacts": [
                    {
                        "type": c["channel"],
                        "value": c["value"],
                        "label": None,
                        "is_active": True,
                    }
                    for c in p["contacts"]
                ],
                "place": {
                    "id": (p.get("source_group") or {}).get("external_key")
                    or row["id"],
                    "name": (p.get("source_group") or {}).get("name") or p["name"],
                    "address": p["location"]["address_raw"],
                    "geometry": source_point(position),
                    "contacts": [],
                    "is_protected_address": False,
                },
                "source_code": "helpinet",
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
                "coordinate_status": "source_unverified",
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


def source_hours(weekly: dict[str, Any] | None, raw: Any, source_name: str) -> dict[str, Any]:
    """Weekly hours when the source text parsed completely, otherwise the text as is."""
    if weekly:
        display = weekly_hours(weekly)
        display["note"] = f"Orari dichiarati da {source_name}, letti dal testo originale; giorni non indicati: orario sconosciuto."
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
    return {
        "id": row["id"],
        "place_id": row["id"],
        "service_title": classification.get("display_name") or p.get("name") or layer or "Servizio",
        # Generic source names ("Rilascio STP/ENI") give way to the site the normalizer found.
        "facility_name": (classification.get("site_hint") if GENERIC_NAME.match(p.get("name") or "") else None) or p.get("name"),
        "source_group": site_group,
        "derived_summary": None,
        "source_values": p.get("source_values", {}),
        "access_display": claim_sections(claims),
        "hours_display": source_hours(weekly, (p.get("hours") or {}).get("raw_value"), source_name),
        "placement": place_status,
        "delivery_mode": None,
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
