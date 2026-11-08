"""Rank transport lines near a point for the "Vicino a" badge.

nearby_lines answers: which bus/metro lines running on a given day stop near this
point, at which nearest stop, and how many minutes on foot. Walking time is an
estimate from straight-line distance (no routing), deliberately on the slow side.
The stop index is built once per immutable network version.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict

WALK_M_PER_MIN = 4000 / 60  # 4 km/h, slower than the usual 5 km/h on purpose
DETOUR_FACTOR = 1.3  # straight line → street distance
RADIUS_M = {"metro": 800, "bus": 500}
CELL_DEG = 0.01  # ~830 m east-west, ~1.1 km north-south at Rome
METHOD = {
    "estimate": "straight_line",
    "detour_factor": DETOUR_FACTOR,
    "walk_km_h": 4,
    "radius_m": RADIUS_M,
}

_indexes: dict[str, "StopIndex"] = {}


def walk_minutes(distance_m: float) -> int:
    """Estimated minutes on foot, rounded up, at least one."""
    return max(1, math.ceil(distance_m * DETOUR_FACTOR / WALK_M_PER_MIN))


def display_code(code: str, mode: str) -> str:
    """Show metro lines as riders know them: MEA → A, MEB1 → B1."""
    match = re.fullmatch(r"ME([A-Z]\d?)", code or "")
    return match.group(1) if mode == "metro" and match else code


def is_night_line(code: str, mode: str) -> bool:
    """Rome night buses carry an "n" prefix (n92, nMB1); they run only at night."""
    return mode == "bus" and bool(re.fullmatch(r"n[A-Z0-9]+", code or ""))


def line_sort_key(row: dict) -> tuple:
    """Metro first, night lines last, then walking time and natural code (2 before 19)."""
    parts = re.split(r"(\d+)", row["code"])
    natural = [int(p) if p.isdigit() else p for p in parts]
    return (row["mode"] != "metro", row["night"], row["walk_min"], row["distance_m"], natural)


class StopIndex:
    """Grid of served stops with their route memberships, plus route colours."""

    def __init__(self, network: dict):
        """Bucket stop features by CELL_DEG cells; collect one colour per route."""
        self.routes = network["routes"]
        self.colors = {}
        self.cells = defaultdict(list)
        for feature in network["features"]:
            props = feature["properties"]
            if props["kind"] == "route":
                self.colors.setdefault(props["route_id"], props.get("color"))
                continue
            lon, lat = feature["geometry"]["coordinates"]
            key = (math.floor(lon / CELL_DEG), math.floor(lat / CELL_DEG))
            self.cells[key].append((lon, lat, props))

    def near(self, lon: float, lat: float, radius_m: float):
        """Yield (distance_m, stop properties) for stops within radius_m."""
        kx = 111_320 * math.cos(math.radians(lat))
        ky = 110_540
        span_x = math.ceil(radius_m / (kx * CELL_DEG))
        span_y = math.ceil(radius_m / (ky * CELL_DEG))
        cx, cy = math.floor(lon / CELL_DEG), math.floor(lat / CELL_DEG)
        for ix in range(cx - span_x, cx + span_x + 1):
            for iy in range(cy - span_y, cy + span_y + 1):
                for slon, slat, props in self.cells.get((ix, iy), ()):
                    distance = math.hypot((slon - lon) * kx, (slat - lat) * ky)
                    if distance <= radius_m:
                        yield distance, props


def stop_index(version: str, network: dict) -> StopIndex:
    """Return the cached index for an immutable version, building it once."""
    if version not in _indexes:
        _indexes.clear()  # keep only the current version in memory
        _indexes[version] = StopIndex(network)
    return _indexes[version]


def nearby_lines(
    index: StopIndex, active_services: set[str], lon: float, lat: float
) -> list[dict]:
    """List each line running today with its nearest stop within the mode radius.

    One row per route_id; rows are ordered metro first, then by walking time.
    """
    best: dict[str, tuple[float, dict]] = {}
    for distance, stop in index.near(lon, lat, max(RADIUS_M.values())):
        for route_id, services in stop["services_by_route"].items():
            mode = index.routes[route_id]["mode"]
            if distance > RADIUS_M[mode] or not active_services.intersection(services):
                continue
            if route_id not in best or distance < best[route_id][0]:
                best[route_id] = (distance, stop)
    rows = []
    for route_id, (distance, stop) in best.items():
        route = index.routes[route_id]
        rows.append(
            {
                "route_id": route_id,
                "code": display_code(route["code"], route["mode"]),
                "mode": route["mode"],
                "night": is_night_line(route["code"], route["mode"]),
                "color": index.colors.get(route_id),
                "stop_id": stop["stop_id"],
                "stop_name": stop["name"],
                "stop_code": stop.get("code", ""),
                "distance_m": round(distance),
                "walk_min": walk_minutes(distance),
            }
        )
    return sorted(rows, key=line_sort_key)


def summary(rows: list[dict]) -> dict:
    """Compact list badge: nearest metro line, nearest daytime bus line, total lines."""
    return {
        "metro": next((r for r in rows if r["mode"] == "metro"), None),
        "bus": next((r for r in rows if r["mode"] == "bus" and not r["night"]), None),
        "lines": len(rows),
    }


def lines_near_places(
    points: dict[str, tuple[float, float]], root, day: str | None = None
) -> dict:
    """Rank nearby lines for each place (place_id → (lon, lat)) on day.

    Transport being unavailable or outside its calendar yields no rows and an
    explicit availability, never an error, so service data stays usable.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from .transport import ROOT, load_active

    today = day or datetime.now(ZoneInfo("Europe/Rome")).date().isoformat()
    result = {
        "service_date": today,
        "availability": "unavailable",
        "method": METHOD,
        "places": {},
    }
    try:
        manifest, _status, network = load_active(root or ROOT, today)
    except (OSError, ValueError, KeyError, TypeError):
        return result
    active = set(network["service_dates"].get(today, []))
    if not active:
        result["availability"] = "outside_calendar"
        return result
    index = stop_index(manifest["version"], network)
    result.update(
        availability="available",
        source_url=manifest.get("source_url"),
        places={
            place_id: nearby_lines(index, active, lon, lat)
            for place_id, (lon, lat) in points.items()
        },
    )
    return result
