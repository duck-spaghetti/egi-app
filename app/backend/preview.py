"""Read imported source subjects for the explicitly local, unreviewed preview.

The adapter returns the legacy frontend shape from PostgreSQL source evidence;
it creates no canonical entities or publication decisions. Native classification
keys are presentation groups, not an adopted EGI taxonomy.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from pathlib import Path
from typing import Any

from .presentation import access_sections, weekly_hours, placement

PSQL = os.environ.get("EGI_PSQL", "/Library/PostgreSQL/18/bin/psql")
PROJECT = Path(__file__).resolve().parents[3]
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
}


def connection_string() -> str:
    """Use the restricted preview reader, with runtime state outside repository history."""
    if os.environ.get("EGI_PREVIEW_DSN"):
        return os.environ["EGI_PREVIEW_DSN"]
    config = json.loads((PROJECT / ".local/preview-db/runtime.json").read_text())
    return f"host={config['socket']} port={config['port']} dbname={config['database']} user=egi_preview_reader"


def read_subjects() -> list[dict[str, Any]]:
    """Read one consistent latest succeeded Helpinet interpretation from PostgreSQL."""
    sql = """BEGIN READ ONLY;
WITH latest AS (
 SELECT p.run_id,c.retrieved_at,c.retrieval_status,c.source_metadata_snapshot
 FROM sources.processing_runs p JOIN sources.captures c USING(capture_id)
 JOIN sources.datasets d USING(dataset_id) JOIN sources.registry r USING(source_id)
 WHERE r.code='helpinet' AND d.external_key='helpinet-preserved-api-extract'
 AND p.run_kind='normalize' AND p.status='succeeded'
 ORDER BY p.started_at DESC,p.finished_at DESC,p.run_id LIMIT 1
)
SELECT COALESCE(json_agg(json_build_object('id',s.subject_id,'payload',s.normalized_payload,
 'run_id',s.run_id,'source_locator',s.subject_locator,'observed_at',l.retrieved_at,
 'retrieval_status',l.retrieval_status,'metadata',l.source_metadata_snapshot) ORDER BY s.subject_locator),'[]'::json)
FROM sources.normalized_subjects s JOIN latest l USING(run_id) WHERE s.subject_kind='service';
COMMIT;"""
    result = subprocess.run(
        [PSQL, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "--dbname", connection_string()],
        input=sql,
        text=True,
        capture_output=True,
        env={**os.environ, "PGCONNECT_TIMEOUT": "3"},
        timeout=10,
    )
    if result.returncode:
        raise RuntimeError("Preview database unavailable")
    return json.loads(result.stdout.strip())


def categories(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expose source-native needs as legacy UI groups, without canonical taxonomy writes."""
    codes = sorted(
        {
            r["payload"]["source_classifications"].get("bisogno") or "non_classificato"
            for r in rows
        }
    )
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
        p = row["payload"]
        code = p["source_classifications"].get("bisogno") or "non_classificato"
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
                "sources": [
                    {
                        "source_name": "Helpinet",
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
