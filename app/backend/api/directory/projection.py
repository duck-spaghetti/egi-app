"""Adapt approved public directory data to the retained map/list/detail interface.

Only the Db's public payload enters this module. Taxonomy terms own UI facets;
canonical opening owns availability. Linked fragments retain source and revision
provenance without combining the two sources' canonical records.
"""

from collections import defaultdict
from typing import Any

from ...config import resolved
from ...presentation.labels import AUDIENCE, COST, DOCUMENTS, PROCEDURE

from ...presentation.languages import PUBLIC_LANGUAGES as LANGUAGES
DAYS = [("lun", "Lunedì"), ("mar", "Martedì"), ("mer", "Mercoledì"),
        ("gio", "Giovedì"), ("ven", "Venerdì"), ("sab", "Sabato"), ("dom", "Domenica")]


def text(value: Any) -> str | None:
    """Return the resolved text while retaining metadata separately in the public payload."""
    return value.get("text") if isinstance(value, dict) else value


def vocabulary(snapshot: dict) -> dict:
    """Build UI labels and facet metadata from the approved territorial release."""
    groups: dict[str, list] = defaultdict(list)
    for term in snapshot["taxonomy"]:
        metadata = term["presentation"]
        row = {**metadata, "label": text(term["name"]), "term_id": term["term_id"]}
        groups[term["axis_code"]].append(row)
    for rows in groups.values():
        rows.sort(key=lambda row: (row.get("sort_order", 0), row["code"]))
    needs = [{"id": i, "slug": row["code"], "label": row["label"], "color": row.get("color", "#466b70"),
              "icon_path": f"/static/assets/icons/default/{row.get('icon', 'default')}.svg",
              "sort_order": i, "area_id": 1} for i, row in enumerate(groups["need"], 1)]
    return {"version": "egi-roma-needs/0.3", "needs": needs, "offers": groups["offer"],
            "audiences": groups["audience"], "access": groups["access"], "meal_times": groups["meal"],
            "course_levels": groups["level"], "paths": []}


def area(snapshot: dict, policy=None) -> dict:
    """Map the configured public Rome territory to the existing UI area envelope."""
    territory = snapshot["territory"]
    city = resolved(territory, policy)
    west,south,east,north = city['bounds']
    return {"id":1,"canonical_id":territory['territory_id'],"slug":territory['code'],
            "name":city['name'],"country_code":city['country_code'],"timezone":city['timezone'],
            "default_zoom":city['zoom'],"is_active":True,
            "default_center":{"type":"Point","coordinates":city['center']},
            "geometry_bbox":{"type":"Polygon","coordinates":[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}}


def weekly_days(hours: list[dict]) -> list[dict]:
    """Combine service schedules without treating an uncertain day as closed."""
    intervals = defaultdict(list)
    states = defaultdict(list)
    for row in hours:
        if row['scope_code']!='service':
            continue
        day=row['iso_weekday']
        states[day].append(row['day_state'])
        if not row.get('opens_at'):
            continue
        opens,closes=row['opens_at'][:5],row['closes_at'][:5]
        finish='00:00' if row['end_day_offset'] else closes
        intervals[day].append({'opens_raw':opens,'closes_raw':finish,'label':f'{opens}–{finish}','review_note':None})
        if row['end_day_offset'] and closes!='00:00':
            intervals[day%7+1].append({'opens_raw':'00:00','closes_raw':closes,'label':f'00:00–{closes}',
                                      'review_note':'Prosegue dal giorno precedente'})
    return [{"day":code,"label":label,"intervals":sorted(intervals[weekday],key=lambda row:row['opens_raw']),
             "issues":[],"state":"closed" if states[weekday] and all(x=='closed' for x in states[weekday]) else "unknown"}
            for weekday,(code,label) in enumerate(DAYS,1)]


def cards(snapshot: dict, policy=None) -> list[dict]:
    """Retain canonical UUIDs and expose only the selected public fields to the map."""
    vocab = vocabulary(snapshot)
    by_term = {term["term_id"]: {**term["presentation"], "label": text(term["name"]), "axis": term["axis_code"]}
               for term in snapshot["taxonomy"]}
    supplements: dict[str, list] = defaultdict(list)
    for item in snapshot.get("supplements", []):
        supplements[item["principal_id"]].append(item)
    result = []
    for service in snapshot["services"]:
        groups: dict[str, list] = defaultdict(list)
        for assignment in service["classifications"]:
            if term := by_term.get(assignment["term_id"]):
                groups[term["axis"]].append({**term, "basis": "Classificazione canonica approvata", "interpreted": True})
        needs = [row["code"] for row in sorted(groups["need"], key=lambda row: row.get("sort_order", 0))]
        category = next((row for row in vocab["needs"] if row["slug"] in needs), None)
        place = service.get("place") or {}
        lat, lon = place.get("latitude"), place.get("longitude")
        geometry = {"type": "Point", "coordinates": [lon, lat]} if lat is not None and lon is not None else None
        source_rows = sorted(service["sources"], key=lambda row: (row["name"], row["retrieved_at"] or "", row["source_id"]))
        sources = [{"name": row["name"], "source_name": row["name"], "source_url": row["homepage"], "license": row["license"],
                    "observed_at": row["retrieved_at"], "published_at": row["published_at"], "is_primary": i == 0}
                   for i, row in enumerate(source_rows)]
        contacts = [_contact(row) for row in service["contacts"]]
        labels = {**AUDIENCE, **COST, **DOCUMENTS, **PROCEDURE}
        conditions = [{"text": labels.get(text(row["details"]), text(row["details"])), "state": row["state"], "kind": row["kind"]}
                      for row in service["conditions"]]
        for linked in supplements[service["service_id"]]:
            contacts += [_contact(row, linked) for row in linked["contacts"]]
            conditions += [{"text": labels.get(text(row["details"]), text(row["details"])), "state": row["state"], "kind": row["kind"],
                            "source_name": linked["source_name"], "revision_id": linked["revision_id"]}
                           for row in linked["conditions"]]
        days = weekly_days(service["weekly_hours"])
        remote = service["delivery_mode"] in {"online", "telephone"}
        result.append({"id": service["service_id"], "revision_id": service["revision_id"],
            "data_status": "approved_canonical_local", "name": text(service["name"]),
            "service_title": text(service["name"]), "description": text(service["description"]),
            "content": {key: service[key] for key in ("name", "description")},
            "category": category, "needs": needs, "offers": groups["offer"], "audiences": groups["audience"],
            "access_tags": groups["access"], "meal_times": groups["meal"],
            "course_levels": [row["code"] for row in groups["level"]], "contacts": contacts,
            "conditions": conditions, "linked_sources": supplements[service["service_id"]],
            "cost_tag": service["cost"]["state"], "cost_note": text(service["cost"]["note"]),
            "delivery_mode": service["delivery_mode"], "operational_status": service["operational_status"],
            "verification": service.get("verification", {}),
            "canonical_opening": service["opening"], "opening_evaluated_at": snapshot["evaluated_at"],
            "hours_display": {"days": days, "verification":service.get("verification",{}), "canonical_opening": service["opening"], "evaluated_at": snapshot["evaluated_at"]},
            "place_id": place.get("location_id"), "place": {"id": place.get("location_id"), "geometry": geometry,
                "address": next((row["formatted"] for row in place.get("addresses", []) if row["kind"] == "physical"),
                                text(place.get("area_description"))),
                "coordinate_state": place.get("coordinate_state")},
            "placement": {"section": "directory" if remote else "services" if geometry else "needs_position",
                          "label": "Servizio a distanza" if remote else "Posizione indicativa della fonte"
                          if geometry and place.get("coordinate_state") != "known" else "Posizione da indirizzo accettata"
                          if geometry else "Posizione non disponibile: servizio presente nell’elenco"},
            "sources": sources, "source_code": (sources[0]["name"].casefold() if sources else "canonical"),
            "observed_at": max((row["observed_at"] for row in sources if row["observed_at"]), default=None),
            "hours": [], "valid_from": service["valid_from"], "valid_until": service["valid_until"]})
    return result


def _contact(row: dict, linked: dict | None = None) -> dict:
    """Keep the exact public value and the provenance of a supplementary contact."""
    origin = f" · {linked['source_name']}" if linked else ""
    return {"type": row["channel"], "value": row["value"], "is_active": True,
            "label": (text(row.get("label")) or row.get("purpose") or "") + origin,
            "provenance": {"service_id": linked["service_id"], "revision_id": linked["revision_id"],
                           "sources": row.get("sources", [])} if linked else None}


