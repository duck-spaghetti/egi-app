"""Read the versioned OSM cycle network for the map (egi-cycleways/1).

cycleways_view(bbox, zoom) returns ways intersecting the viewport, with the
simplified detail level for the zoom. Read-only; format in
egi-importer/docs/cycleways-format.md. Unavailable data is explicit, never an error.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from ..transport.network import intersects, route_geometry

FORMAT = "egi-cycleways/1"
MIN_ZOOM = 12
ROOT = Path(__file__).resolve().parents[5] / '.local/cycleways'


@lru_cache(maxsize=1)
def read_network(root: str, version: str) -> dict:
    """Cache the active immutable network by version."""
    data = json.loads((Path(root) / "versions" / version / "network.json").read_text())
    if data.get("format") != FORMAT:
        raise ValueError("Unsupported cycleways format")
    return data


def cycleways_view(bbox: list[float], zoom: int, root: Path = ROOT) -> dict:
    """Ways in bbox at zoom ≥ MIN_ZOOM; below that only availability and attribution."""
    result = {
        "type": "FeatureCollection",
        "features": [],
        "availability": "unavailable",
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "min_zoom": MIN_ZOOM,
    }
    try:
        manifest = json.loads((root / "active.json").read_text())
        if manifest.get("format") != FORMAT:
            raise ValueError("Unsupported cycleways format")
        network = read_network(str(root), manifest["version"])
    except (OSError, ValueError, KeyError):
        return result
    result.update(availability="available", osm_base=manifest.get("osm_base"), updated_at=manifest.get("updated_at"))
    if zoom < MIN_ZOOM:
        return result
    result["features"] = [
        {"type": "Feature", "id": f["id"], "geometry": route_geometry(f, zoom), "properties": f["properties"]}
        for f in network["features"]
        if intersects(f["bbox"], bbox)
    ]
    return result
