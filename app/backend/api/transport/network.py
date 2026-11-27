"""Read versioned GTFS files without network, importer execution or database access.

load_active is the only code that knows the importer's runtime layout and format
(egi-importer/docs/transport-format.md). transport_view selects today's scheduled
shapes/points by modes, viewport and zoom. Atomic importer manifests isolate readers
from in-progress refreshes.
"""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple
from zoneinfo import ZoneInfo

from .nearby import display_code, stop_index, local_route

ROOT = Path(__file__).resolve().parents[5] / '.local/transport'
RAIL_ROOT = Path(__file__).resolve().parents[5] / '.local/rail'
ROOTS = (ROOT, RAIL_ROOT)


FORMAT = "egi-transport/6"
FULL_DETAIL_ZOOM = 17
STOP_POINT_ZOOM = 18
# Twice the 6 h schedule plus slack: older means the poller stopped running.
STALE_AFTER = timedelta(hours=24)
VERSION = re.compile(r"[a-f0-9]{64}-" + re.escape(FORMAT.split("/")[1]))


class ActiveNetwork(NamedTuple):
    """The activated manifest, the poller status and the immutable network it names."""

    manifest: dict
    status: dict
    network: dict


@lru_cache(maxsize=4)
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


def refresh_stale(status: dict, now: datetime | None = None) -> bool:
    """Tell whether no poll attempt was recorded within STALE_AFTER."""
    try:
        last = datetime.fromisoformat(status["last_attempt_at"])
    except (KeyError, TypeError, ValueError):
        return True
    return (now or datetime.now(timezone.utc)) - last > STALE_AFTER


def route_geometry(feature: dict, zoom: int) -> dict:
    """Pick the coarsest detail level made for this zoom; full geometry from FULL_DETAIL_ZOOM."""
    levels = feature.get("simplified", {})
    usable = [int(z) for z in levels if int(z) <= zoom]
    if zoom >= FULL_DETAIL_ZOOM or not usable:
        return feature["geometry"]
    return {"type": "LineString", "coordinates": levels[str(max(usable))]}


def intersects(a: list, b: list) -> bool:
    """Test bounding-box intersection including touching edges."""
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


LINE_MIN_ZOOM = {"metro": 0, "rail": 0, "tram": 12, "bus": 13}
STOP_MIN_ZOOM = {"metro": 14, "rail": 14, "tram": 15, "bus": 16}
MODE_ORDER = {"metro": 0, "rail": 1, "tram": 2, "bus": 3}
STATION_RADIUS_M = 150


def route_order(route: dict) -> tuple:
    """Metro before tram before bus, then natural line code."""
    code = route.get("display_code") or route["code"]
    natural = [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", code)]
    return (MODE_ORDER.get(route["mode"], 9), natural)


def group_stations(stops: list[dict], zoom: int = 0) -> list[dict]:
    """Group nearby metro stops at overview zoom; retain source points at detail zoom.

    GTFS has one stop per platform/direction and no parent_station; this merge is
    for display only and keeps every source stop_id in the merged properties.
    """
    if zoom >= STOP_POINT_ZOOM:
        return stops
    clusters: list[list[dict]] = []
    others = []
    for stop in stops:
        if stop["properties"]["transport_type"] != "metro":
            others.append(stop)
            continue
        lon, lat = stop["geometry"]["coordinates"]
        for cluster in clusters:
            head = cluster[0]
            hlon, hlat = head["geometry"]["coordinates"]
            same_name = head["properties"]["name"].casefold() == stop["properties"]["name"].casefold()
            kx = 111_320 * math.cos(math.radians(lat))
            if same_name and math.hypot((lon - hlon) * kx, (lat - hlat) * 110_540) <= STATION_RADIUS_M:
                cluster.append(stop)
                break
        else:
            clusters.append([stop])
    stations = []
    for cluster in clusters:
        routes = {}
        for stop in cluster:
            for route in stop["properties"]["routes"]:
                routes.setdefault(route["route_id"], route)
        coords = [s["geometry"]["coordinates"] for s in cluster]
        first = cluster[0]["properties"]
        stations.append(
            {
                "type": "Feature",
                "id": "station:" + first["stop_id"],
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        round(sum(c[0] for c in coords) / len(coords), 6),
                        round(sum(c[1] for c in coords) / len(coords), 6),
                    ],
                },
                "properties": {
                    "kind": "station",
                    "name": first["name"],
                    "stop_ids": [s["properties"]["stop_id"] for s in cluster],
                    "wheelchair_boarding": (
                        lambda values: values.pop() if len(values) == 1 else "unknown"
                    )({s["properties"].get("wheelchair_boarding", "unknown") for s in cluster}),
                    "routes": sorted(routes.values(), key=route_order),
                    "transport_type": "metro",
                },
            }
        )
    return stations + others


def transport_view(
    bbox: list[float],
    zoom: int,
    modes: set[str],
    root: Path = ROOT,
    day: str | None = None,
    routes: set[str] | None = None,
) -> dict:
    """Return bounded, date-aware GeoJSON; expose unavailable transport separately.

    An expired calendar yields no features and an explicit status rather than
    implying old scheduled service is operating today. No live availability claim.
    With routes (focus view), only those route_ids are returned, whole and at any
    zoom, with every stop they call at; bbox, modes and zoom thresholds are ignored
    except for choosing the geometry detail level. Long-distance rail is always
    excluded; approximate timed rail geometry is suppressed even in focus.
    Ordinary bus views contain stops only, from zoom 16.
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
        result.update(
            manifest=manifest,
            refresh=status,
            refresh_stale=refresh_stale(status),
            availability="available",
        )
        active_services = set(network["service_dates"].get(today, []))
        if not active_services:
            result["availability"] = "outside_calendar"
            return result
        colors = stop_index(manifest["version"], network).colors
        stops = []
        for feature in network["features"]:
            if routes is None and not intersects(feature["bbox"], bbox):
                continue
            props = feature["properties"]
            if props["kind"] == "route":
                mode = props["transport_type"]
                # NeTEx geometry joins stations approximately, not actual rail tracks.
                if mode == "rail" or (mode == "bus" and routes is None):
                    continue
                if routes is not None:
                    if props["route_id"] not in routes:
                        continue
                elif mode not in modes or zoom < LINE_MIN_ZOOM.get(mode, 13):
                    continue
                if not active_services.intersection(props["service_ids"]):
                    continue
                public = {k: v for k, v in props.items() if k != "service_ids"}
                public["code"] = display_code(props["name"], mode)
                result["features"].append(
                    {
                        "type": "Feature",
                        "id": feature["id"],
                        "geometry": route_geometry(feature, zoom),
                        "properties": public,
                    }
                )
                continue
            memberships = []
            for route_id, services in props["services_by_route"].items():
                route = network["routes"][route_id]
                if not local_route(route):
                    continue
                if routes is not None:
                    wanted = route_id in routes
                else:
                    wanted = route["mode"] in modes and zoom >= STOP_MIN_ZOOM.get(
                        route["mode"], 14
                    )
                if wanted and active_services.intersection(services):
                    memberships.append(
                        {
                            "route_id": route_id,
                            **route,
                            "display_code": display_code(route["code"], route["mode"]),
                            "color": colors.get(route_id),
                        }
                    )
            if not memberships:
                continue
            public = {k: v for k, v in props.items() if k != "services_by_route"}
            public["routes"] = sorted(memberships, key=route_order)
            public["transport_type"] = public["routes"][0]["mode"]
            stops.append(
                {
                    "type": "Feature",
                    "id": feature["id"],
                    "geometry": feature["geometry"],
                    "properties": public,
                }
            )
        result["features"].extend(group_stations(stops, zoom))
        return result
    except (OSError, ValueError, KeyError, TypeError):
        result.update(availability="unavailable", features=[])
        return result


def transport_view_all(bbox, zoom, modes, roots=ROOTS, day=None, routes=None) -> dict:
    """transport_view over several runtimes; status fields come from the first source."""
    results = [transport_view(bbox, zoom, modes, root, day, routes) for root in roots]
    merged = dict(results[0])
    merged["features"] = [f for r in results for f in r["features"]]
    merged["sources"] = [
        {"availability": r["availability"], "source_url": (r.get("manifest") or {}).get("source_url"), "refresh": r.get("refresh")}
        for r in results
    ]
    if merged["availability"] != "available" and any(r["availability"] == "available" for r in results):
        merged["availability"] = "available"
    return merged
