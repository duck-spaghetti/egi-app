"""Rank transport lines near a point for the "Vicino a" badge.

nearby_lines answers: which metro, tram and bus lines running on a given day stop near this
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
RADIUS_M = {"metro": 800, "rail": 800, "tram": 500, "bus": 500}
SIBLING_M = 150  # same-named stops this close count as one stop for departures
CELL_DEG = 0.01  # ~830 m east-west, ~1.1 km north-south at Rome
METHOD = {
    "estimate": "straight_line",
    "detour_factor": DETOUR_FACTOR,
    "walk_km_h": 4,
    "radius_m": RADIUS_M,
}

_indexes: dict[str, "StopIndex"] = {}


LOCAL_RAIL_CODES = {"REG", "RV", "MET", "SFM", "DIR"}


def local_route(route: dict) -> bool:
    """Keep regional/metropolitan source categories and all non-rail modes."""
    return route.get("mode") != "rail" or route.get("code") in LOCAL_RAIL_CODES


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
    """Metro, then trains, then others; night lines last; then walking time and natural code."""
    parts = re.split(r"(\d+)", row["code"])
    natural = [int(p) if p.isdigit() else p for p in parts]
    rank = {"metro": 0, "rail": 1}.get(row["mode"], 2)
    return (rank, row["night"], row["walk_min"], row["distance_m"], natural)


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
        """Yield (distance_m, stop properties, [lon, lat]) for stops within radius_m."""
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
                        yield distance, props, [slon, slat]


def stop_index(version: str, network: dict) -> StopIndex:
    """Return the cached index for an immutable version, building it once."""
    if version not in _indexes:
        if len(_indexes) >= 4:  # two sources × (active, pending)
            _indexes.pop(next(iter(_indexes)))
        _indexes[version] = StopIndex(network)
    return _indexes[version]


def nearby_lines(
    index: StopIndex, active_services: set[str], lon: float, lat: float
) -> list[dict]:
    """List each line running today with its nearest stop within the mode radius.

    One row per route_id; rows are ordered metro first, then by walking time.
    """
    best: dict[str, tuple[float, dict, list]] = {}
    calls: dict[str, list[tuple[dict, list]]] = defaultdict(list)
    for distance, stop, point in index.near(lon, lat, max(RADIUS_M.values())):
        for route_id, services in stop["services_by_route"].items():
            if not local_route(index.routes[route_id]):
                continue
            mode = index.routes[route_id]["mode"]
            if distance > RADIUS_M[mode] or not active_services.intersection(services):
                continue
            calls[route_id].append((stop, point))
            if route_id not in best or distance < best[route_id][0]:
                best[route_id] = (distance, stop, point)
    rows = []
    for route_id, (distance, stop, point) in best.items():
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
                "stop_point": point,
                # Same-named stops of this line nearby: platforms or the other side of
                # the street, so both directions' departures can be shown.
                "stop_ids": sibling_stops(stop, point, calls[route_id]),
                "wheelchair": stop.get("wheelchair_boarding", "unknown"),
                "distance_m": round(distance),
                "walk_min": walk_minutes(distance),
            }
        )
    return sorted(rows, key=line_sort_key)


def sibling_stops(stop: dict, point: list, candidates: list[tuple[dict, list]]) -> list[str]:
    """IDs of stops named like stop within SIBLING_M of it (stop itself first)."""
    kx = 111_320 * math.cos(math.radians(point[1]))
    ids = [stop["stop_id"]]
    for other, where in candidates:
        if other["stop_id"] in ids or other["name"].casefold() != stop["name"].casefold():
            continue
        if math.hypot((where[0] - point[0]) * kx, (where[1] - point[1]) * 110_540) <= SIBLING_M:
            ids.append(other["stop_id"])
    return ids


def group_by_stop(rows: list[dict]) -> list[dict]:
    """Group line rows by physical stop: same stop name within SIBLING_M.

    Each group has the stop name, the union of stop_ids, the nearest distance and
    walking time, its modes and its lines (rows) in line order. Groups are ordered
    by distance across all modes, with stable name/ID ties.
    """
    groups: list[dict] = []
    for row in rows:
        lon, lat = row["stop_point"]
        kx = 111_320 * math.cos(math.radians(lat))
        for group in groups:
            glon, glat = group["stop_point"]
            if group["stop_name"].casefold() == row["stop_name"].casefold() and math.hypot(
                (lon - glon) * kx, (lat - glat) * 110_540
            ) <= SIBLING_M:
                break
        else:
            group = {
                "stop_name": row["stop_name"],
                "stop_point": row["stop_point"],
                "stop_ids": [],
                "distance_m": row["distance_m"],
                "walk_min": row["walk_min"],
                "wheelchair": row.get("wheelchair", "unknown"),
                "lines": [],
            }
            groups.append(group)
        group["lines"].append(row)
        group["stop_ids"] += [s for s in row.get("stop_ids", [row["stop_id"]]) if s not in group["stop_ids"]]
        if row["distance_m"] < group["distance_m"]:
            group.update(distance_m=row["distance_m"], walk_min=row["walk_min"], stop_point=row["stop_point"])
    for group in groups:
        group["lines"].sort(key=line_sort_key)
        group["modes"] = sorted({r["mode"] for r in group["lines"]}, key=["metro", "rail", "tram", "bus"].index)
    return sorted(groups, key=lambda g: (g["distance_m"], g["stop_name"].casefold(), sorted(g["stop_ids"])))


def summary(rows: list[dict]) -> dict:
    """Compact list badge: nearest metro, nearest daytime tram/bus line, total lines."""
    return {
        "metro": next((r for r in rows if r["mode"] == "metro"), None),
        "rail": next((r for r in rows if r["mode"] == "rail"), None),
        "surface": next((r for r in rows if r["mode"] in ("tram", "bus") and not r["night"]), None),
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


def lines_near_places_all(points: dict[str, tuple[float, float]], roots, day: str | None = None) -> dict:
    """lines_near_places over several runtimes (Roma Mobilità, rail), rows merged per place.

    Availability is "available" when any source is; per-source states are listed.
    """
    results = [lines_near_places(points, root, day) for root in roots]
    merged = dict(results[0])
    merged["sources"] = [{"availability": r["availability"], "source_url": r.get("source_url")} for r in results]
    states = [r["availability"] for r in results]
    merged["availability"] = "available" if "available" in states else states[0]
    places: dict[str, list] = {}
    for result in results:
        for place_id, rows in result.get("places", {}).items():
            places.setdefault(place_id, []).extend(rows)
    merged["places"] = {k: sorted(v, key=line_sort_key) for k, v in places.items()}
    return merged
