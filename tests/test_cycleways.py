"""Check the cycleways reader on a tiny runtime written in the producer's layout."""

import json
import tempfile
import unittest
from pathlib import Path

from app.backend.api.cycleways.network import FORMAT, cycleways_view, read_network


def root_with(features: list) -> Path:
    """Write active.json and one version directory."""
    root = Path(tempfile.mkdtemp())
    manifest = {"format": FORMAT, "version": "v-1", "osm_base": "2026-11-08T00:00:00Z"}
    (root / "versions" / "v-1").mkdir(parents=True)
    (root / "versions" / "v-1" / "network.json").write_text(json.dumps({"format": FORMAT, "features": features}))
    (root / "active.json").write_text(json.dumps(manifest))
    return root


WAY = {
    "type": "Feature", "id": "way:1", "bbox": [12.5, 41.9, 12.51, 41.91],
    "geometry": {"type": "LineString", "coordinates": [[12.5, 41.9], [12.505, 41.905], [12.51, 41.91]]},
    "simplified": {"11": [[12.5, 41.9], [12.51, 41.91]], "13": [[12.5, 41.9], [12.51, 41.91]], "15": [[12.5, 41.9], [12.51, 41.91]]},
    "properties": {"kind": "separated", "label": "Pista ciclabile separata", "name": "Tevere"},
}


class CyclewaysViewTests(unittest.TestCase):
    """Zoom gate, bbox filter, detail level and unavailability."""

    def tearDown(self):
        """Drop the version cache between tests."""
        read_network.cache_clear()

    def test_zoom_gate_bbox_and_detail(self):
        """Nothing below zoom 12; simplified geometry below 17; full at 17."""
        root = root_with([WAY])
        self.assertEqual(cycleways_view([12, 41, 13, 42], 11, root)["features"], [])
        z13 = cycleways_view([12, 41, 13, 42], 13, root)["features"]
        self.assertEqual(len(z13[0]["geometry"]["coordinates"]), 2)
        self.assertNotIn("simplified", z13[0])
        z17 = cycleways_view([12, 41, 13, 42], 17, root)["features"]
        self.assertEqual(len(z17[0]["geometry"]["coordinates"]), 3)
        self.assertEqual(cycleways_view([11, 40, 11.5, 40.5], 15, root)["features"], [])

    def test_missing_runtime_is_unavailable(self):
        """No active file → explicit unavailability."""
        self.assertEqual(cycleways_view([12, 41, 13, 42], 15, Path(tempfile.mkdtemp()))["availability"], "unavailable")


if __name__ == "__main__":
    unittest.main()
