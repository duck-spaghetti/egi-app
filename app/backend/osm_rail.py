"""Read untimed OSM rail for transport features and nearby-service stations.

load_active validates the immutable egi-osmrail/1 runtime; rail_view applies map
filters and geometry levels; nearby_places ranks untimed station rows within 800 m.
All reads are local and independent of timed GTFS/NeTEx availability.
"""

from __future__ import annotations

import json
import math
import os
import re
from functools import lru_cache
from pathlib import Path

from .transit_nearby import METHOD, RADIUS_M, line_sort_key, walk_minutes
from .transport import intersects

FORMAT = "egi-osmrail/1"
ROOT = Path(os.environ.get("EGI_OSM_RAIL_ROOT", Path(__file__).resolve().parents[3] / ".local/osm-rail"))
ATTRIBUTION = "© OpenStreetMap contributors (ODbL 1.0)"
SOURCE_URL = "https://www.openstreetmap.org/copyright"
VERSION = re.compile(r"[a-f0-9]{64}-1")


@lru_cache(maxsize=2)
def read_network(root: str, version: str) -> dict:
    """Cache a validated immutable network, rejecting unsupported version paths."""
    if not VERSION.fullmatch(version):
        raise ValueError("Unsupported OSM rail version")
    data = json.loads((Path(root) / "versions" / version / "network.json").read_text())
    if data.get("format") != FORMAT:
        raise ValueError("Unsupported OSM rail format")
    return data


def load_active(root: Path) -> tuple[dict, dict]:
    """Return the supported active manifest and its network; no calendar is implied."""
    manifest = json.loads((root / "active.json").read_text())
    if manifest.get("format") != FORMAT:
        raise ValueError("Unsupported OSM rail format")
    return manifest, read_network(str(root), manifest["version"])


# Matches transport.STOP_MIN_ZOOM['rail']: stations only once the map is close enough.
STATION_MIN_ZOOM = 14

def rail_view(bbox: list, zoom: int, modes: set, routes: set | None = None, root: Path = ROOT) -> dict:
    """OSM rail in the viewport, or complete focused routes with their stations."""
    result = {"features": [], "availability": "unavailable", "source_url": SOURCE_URL, "attribution": ATTRIBUTION, "untimed": True}
    if routes is None and "rail" not in modes:
        return result
    try:
        manifest, network = load_active(root)
        features = []
        for feature in network["features"]:
            props = feature["properties"]
            if routes is None and not intersects(feature["bbox"], bbox):
                continue
            if props["kind"] == "route":
                if routes is not None and props["route_id"] not in routes:
                    continue
                geometry = feature["geometry"]
                levels = feature.get("simplified", {})
                usable = [int(z) for z in levels if int(z) <= zoom]
                if zoom < 17 and usable:
                    geometry = {"type": "MultiLineString", "coordinates": levels[str(max(usable))]}
            else:
                memberships = [r for r in props["routes"] if routes is None or r["route_id"] in routes]
                if not memberships or (routes is None and zoom < STATION_MIN_ZOOM):
                    continue
                props = {**props, "routes": memberships}
                geometry = feature["geometry"]
            features.append({"type": "Feature", "id": feature["id"], "geometry": geometry, "properties": props})
        result.update(features=features, availability="available", updated_at=manifest.get("updated_at"), osm_base=manifest.get("osm_base"))
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return result


def nearby_places(points: dict[str, tuple[float, float]], root: Path = ROOT) -> dict:
    """Nearest station per OSM line within 800 m, explicitly without departures."""
    result = {"places": {}, "availability": "unavailable", "method": METHOD, "source_url": SOURCE_URL, "untimed": True}
    try:
        _manifest, network = load_active(root)
        stops = [f for f in network["features"] if f["properties"]["kind"] == "stop"]
        places = {}
        for place_id, (lon, lat) in points.items():
            best = {}
            kx = 111_320 * math.cos(math.radians(lat))
            for feature in stops:
                slon, slat = feature["geometry"]["coordinates"]
                distance = math.hypot((slon - lon) * kx, (slat - lat) * 110_540)
                if distance > RADIUS_M["rail"]:
                    continue
                stop = feature["properties"]
                for route in stop["routes"]:
                    route_id = route["route_id"]
                    if route_id in best and distance >= best[route_id][0]:
                        continue
                    best[route_id] = (distance, {
                        "route_id": route_id, "code": route["code"], "mode": "rail",
                        "color": route["color"], "night": False, "untimed": True, "next": [],
                        "stop_id": stop["stop_id"], "stop_ids": stop["stop_ids"],
                        "stop_name": stop["name"], "stop_code": "",
                        "stop_point": feature["geometry"]["coordinates"], "wheelchair": "unknown",
                        "distance_m": round(distance), "walk_min": walk_minutes(distance),
                    })
            places[place_id] = sorted((row for _, row in best.values()), key=line_sort_key)
        result.update(places=places, availability="available")
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return result
