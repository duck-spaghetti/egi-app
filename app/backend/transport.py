"""Read versioned GTFS files without network, importer execution or database access.

load_active is the only code that knows the importer's runtime layout and format
(egi-importer/docs/transport-format.md). transport_view selects today's scheduled
shapes/points by modes, viewport and zoom. Atomic importer manifests isolate readers
from in-progress refreshes.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple
from zoneinfo import ZoneInfo

ROOT = Path(
    os.environ.get(
        "EGI_TRANSPORT_ROOT", Path(__file__).resolve().parents[3] / ".local/transport"
    )
)


FORMAT = "egi-transport/1"
VERSION = re.compile(r"[a-f0-9]{64}-" + re.escape(FORMAT.split("/")[1]))


class ActiveNetwork(NamedTuple):
    """The activated manifest, the poller status and the immutable network it names."""

    manifest: dict
    status: dict
    network: dict


@lru_cache(maxsize=2)
def read_network(root: str, version: str) -> dict:
    """Cache immutable networks (active and pending); a new version is a new key."""
    if not VERSION.fullmatch(version):
        raise ValueError("Unsupported transport version")
    data = json.loads((Path(root) / "versions" / version / "network.json").read_text())
    if data.get("format") != FORMAT:
        raise ValueError("Unsupported transport format")
    return data


def read_manifest(path: Path) -> dict:
    """Read an active or pending manifest and reject other formats."""
    manifest = json.loads(path.read_text())
    if manifest.get("format") != FORMAT:
        raise ValueError("Unsupported transport format")
    return manifest


def load_active(root: Path, day: str | None = None) -> ActiveNetwork:
    """Read the version to serve on day from a transport runtime root.

    A staged pending version is served once it schedules service on day, so a new
    timetable starts at midnight even before the poller promotes it. Otherwise the
    activated version is served. Raises OSError/ValueError/KeyError when neither is
    usable; a missing status file is an empty status.
    """
    status_path = root / "status.json"
    status = json.loads(status_path.read_text()) if status_path.exists() else {}
    pending_path = root / "pending.json"
    if day and pending_path.exists():
        pending = read_manifest(pending_path)
        network = read_network(str(root), pending["version"])
        if network["service_dates"].get(day):
            return ActiveNetwork(pending, status, network)
    manifest = read_manifest(root / "active.json")
    return ActiveNetwork(manifest, status, read_network(str(root), manifest["version"]))


def intersects(a: list, b: list) -> bool:
    """Test bounding-box intersection including touching edges."""
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


def transport_view(
    bbox: list[float],
    zoom: int,
    modes: set[str],
    root: Path = ROOT,
    day: str | None = None,
) -> dict:
    """Return bounded, date-aware GeoJSON; expose unavailable transport separately.

    An expired calendar yields no features and an explicit status rather than
    implying old scheduled service is operating today. No live availability claim.
    """
    today = day or datetime.now(ZoneInfo("Europe/Rome")).date().isoformat()
    result = {
        "type": "FeatureCollection",
        "features": [],
        "service_date": today,
        "availability": "unavailable",
        "source_url": "https://romamobilita.it/sistemi-e-tecnologie/open-data/",
    }
    try:
        manifest, status, network = load_active(root, today)
        result.update(manifest=manifest, refresh=status, availability="available")
        active_services = set(network["service_dates"].get(today, []))
        if not active_services:
            result["availability"] = "outside_calendar"
            return result
        for feature in network["features"]:
            if not intersects(feature["bbox"], bbox):
                continue
            props = feature["properties"]
            if props["kind"] == "route":
                mode = props["transport_type"]
                if mode not in modes or (mode == "bus" and zoom < 13):
                    continue
                if not active_services.intersection(props["service_ids"]):
                    continue
                public = {k: v for k, v in props.items() if k != "service_ids"}
            else:
                memberships = []
                for route_id, services in props["services_by_route"].items():
                    route = network["routes"][route_id]
                    threshold = 13 if route["mode"] == "metro" else 14
                    if (
                        route["mode"] in modes
                        and zoom >= threshold
                        and active_services.intersection(services)
                    ):
                        memberships.append({"route_id": route_id, **route})
                if not memberships:
                    continue
                public = {k: v for k, v in props.items() if k != "services_by_route"}
                public["routes"] = memberships
                public["transport_type"] = (
                    "metro" if any(r["mode"] == "metro" for r in memberships) else "bus"
                )
            result["features"].append(
                {
                    "type": "Feature",
                    "id": feature["id"],
                    "geometry": feature["geometry"],
                    "properties": public,
                }
            )
        return result
    except (OSError, ValueError, KeyError, TypeError):
        result.update(availability="unavailable", features=[])
        return result
