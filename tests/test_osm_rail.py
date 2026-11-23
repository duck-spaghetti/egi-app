"""Verify independent OSM rail reads, nearby distances and preview endpoint merging."""

from __future__ import annotations

import copy
import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.backend import local_routes as main
from app.backend.main import app
from app.backend.preview_dependencies import subject_source
from app.backend.osm_rail import nearby_places, rail_view
from app.backend.subjects import StaticSubjectSource
from tests.test_service_presentation import subject

FIXTURE = Path(__file__).parent / "fixtures/osm-rail-root"


class OsmRailTests(unittest.TestCase):
    """Geometry/filter contracts, missing data and nearby grouping without timetables."""

    def test_view_zoom_modes_focus_and_segments(self):
        """Focus ignores the viewport/mode/stop threshold and returns only chosen lines."""
        bbox = [12.49, 41.89, 12.53, 41.93]
        low = rail_view(bbox, 11, {"rail"}, root=FIXTURE)
        self.assertEqual(len(low["features"]), 2)
        self.assertEqual(low["features"][0]["geometry"]["type"], "MultiLineString")
        self.assertEqual(len(low["features"][0]["geometry"]["coordinates"]), 2)
        # r2: stations join the lines from STATION_MIN_ZOOM (14), not before.
        self.assertEqual(len(rail_view(bbox, 13, {"rail"}, root=FIXTURE)["features"]), 2)
        self.assertEqual(len(rail_view(bbox, 14, {"rail"}, root=FIXTURE)["features"]), 4)
        self.assertEqual(rail_view(bbox, 15, {"bus"}, root=FIXTURE)["features"], [])
        self.assertEqual(rail_view([0, 0, 1, 1], 15, {"rail"}, root=FIXTURE)["features"], [])
        focused = rail_view([0, 0, 1, 1], 3, {"bus"}, {"osm:Roma Viterbo (Urbana)"}, FIXTURE)
        self.assertEqual(len(focused["features"]), 2)
        self.assertEqual([r["route_id"] for r in focused["features"][1]["properties"]["routes"]], ["osm:Roma Viterbo (Urbana)"])

    def test_nearby_radius_and_untimed_rows(self):
        """Each nearby OSM line has one nearest station, all node ids and no departures."""
        data = nearby_places({"near": (12.5, 41.9), "far": (12, 41)}, FIXTURE)
        rows = data["places"]["near"]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["untimed"] and r["next"] == [] for r in rows))
        self.assertEqual(rows[0]["stop_ids"], ["osm:node:10", "osm:node:11"])
        self.assertEqual((rows[0]["distance_m"], rows[0]["walk_min"]), (0, 1))
        self.assertEqual(data["places"]["far"], [])
        # 790 m from the first station, and 810 m (outside) to its west.
        kx = 111_320 * math.cos(math.radians(41.9))
        boundary = nearby_places({"in": (12.5 - 790 / kx, 41.9), "out": (12.5 - 810 / kx, 41.9)}, FIXTURE)
        self.assertEqual(len(boundary["places"]["in"]), 2)
        self.assertEqual(boundary["places"]["out"], [])

    def test_unavailable_and_rejected_manifest_paths(self):
        """Missing, unsupported or traversing version paths fail closed for this source."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "runtime"
            self.assertEqual(nearby_places({"p": (12.5, 41.9)}, root)["availability"], "unavailable")
            shutil.copytree(FIXTURE, root)
            manifest = json.loads((root / "active.json").read_text())
            manifest["version"] = "../../elsewhere"
            (root / "active.json").write_text(json.dumps(manifest))
            self.assertEqual(rail_view([12, 41, 13, 43], 15, {"rail"}, root=root)["availability"], "unavailable")


class EndpointTests(unittest.TestCase):
    """Merge untimed rail even when timed feeds are unavailable, without OSM schedule ids."""

    def setUp(self):
        """Use independent source and rail fixtures; timed roots are deliberately absent."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        located = copy.deepcopy(subject("svc-1", "Mensa", {}))
        located["payload"]["source_values"]["posizione"]["coordinate"] = {"lat": 41.9, "lng": 12.5}
        app.dependency_overrides[subject_source] = lambda: StaticSubjectSource([located])
        self.addCleanup(app.dependency_overrides.clear)
        for name, value in [("OSM_RAIL_ROOT", FIXTURE), ("TRANSPORT_ROOTS", (Path(self.temp.name) / "missing",))]:
            target = patch.object(main, name, value)
            target.start()
            self.addCleanup(target.stop)
        self.client = TestClient(app)

    def test_map_and_detail_when_only_osm_available(self):
        """Untimed source availability never masquerades as a scheduled departure."""
        data = self.client.post("/api/preview/transport",json={"west":12.2,"south":41.7,"east":12.8,"north":42.1,"zoom":14,"modes":"rail"}).json()
        self.assertEqual(data["availability"], "available")
        self.assertEqual(len(data["features"]), 4)
        self.assertTrue(data["osm_rail"]["untimed"])
        service = self.client.get("/api/preview/services").json()[0]
        place = service["place"]["id"]
        badge = self.client.get("/api/preview/transit/places").json()["places"][place]
        self.assertTrue(badge["rail"]["untimed"])
        with patch.object(main, "next_departures_all", wraps=main.next_departures_all) as departures:
            detail = self.client.get(f"/api/preview/transit/places/{place}").json()
            departures.assert_not_called()
        self.assertEqual(len(detail["lines"]), 2)
        self.assertEqual(len(detail["stops"]), 1)
        self.assertTrue(all(not row.get("next") and row["untimed"] for row in detail["lines"]))

    def test_timed_and_untimed_sources_remain_distinct(self):
        """An active GTFS fixture and OSM routes coexist without replacing source ids."""
        roots = (Path(__file__).parent / "fixtures/transport-root",)
        with patch.object(main, "TRANSPORT_ROOTS", roots):
            # Fix the service day for the dated GTFS fixture, leaving OSM independent.
            from app.backend.transport import transport_view_all
            with patch.object(main, "transport_view_all", side_effect=lambda *a, **kw: transport_view_all(*a, day="2026-01-05", **kw)):
                data = self.client.post("/api/preview/transport",json={"west":12.2,"south":41.7,"east":12.8,"north":42.1,"zoom":14}).json()
        osm = [f for f in data["features"] if f["properties"].get("untimed")]
        timed = [f for f in data["features"] if not f["properties"].get("untimed")]
        self.assertEqual(len(osm), 4)
        self.assertTrue(timed)
        self.assertEqual(len({f["id"] for f in data["features"]}), len(data["features"]))


if __name__ == "__main__":
    unittest.main()
