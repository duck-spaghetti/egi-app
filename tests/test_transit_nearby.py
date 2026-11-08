"""Check the "Vicino a" ranking and its endpoints without PostgreSQL or a server."""

from __future__ import annotations

import copy
import math
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.backend import main
from app.backend.main import app, subject_source
from app.backend.subjects import StaticSubjectSource
from app.backend.transit_nearby import (
    StopIndex,
    display_code,
    lines_near_places,
    nearby_lines,
    summary,
    walk_minutes,
)
from tests.test_service_presentation import subject

LON, LAT = 12.5, 41.9
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "transport-root"


def east(metres: float) -> tuple[float, float]:
    """A point metres east of the origin."""
    return LON + metres / (111_320 * math.cos(math.radians(LAT))), LAT


def stop(stop_id: str, metres: float, routes: dict) -> dict:
    """A served stop feature metres east of the origin."""
    lon, lat = east(metres)
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "kind": "stop",
            "stop_id": stop_id,
            "code": stop_id,
            "name": f"Stop {stop_id}",
            "services_by_route": routes,
        },
    }


def network(*stops: dict) -> dict:
    """A minimal network: metro MEA, day bus 49, night bus n92."""
    return {
        "routes": {
            "MEA": {"code": "MEA", "mode": "metro"},
            "49": {"code": "49", "mode": "bus"},
            "n92": {"code": "n92", "mode": "bus"},
        },
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": []},
                "properties": {"kind": "route", "route_id": "MEA", "color": "#E27439"},
            },
            *stops,
        ],
    }


class RankingTests(unittest.TestCase):
    """Radii, one row per line, ordering and calendar filtering."""

    def test_walk_estimate_is_slow_and_rounded_up(self):
        """1.3 × distance at 4 km/h, at least one minute."""
        self.assertEqual(walk_minutes(0), 1)
        self.assertEqual(walk_minutes(100), 2)
        self.assertEqual(walk_minutes(500), 10)

    def test_metro_codes_read_as_riders_know_them(self):
        """MEA → A and MEB1 → B1; bus codes untouched."""
        self.assertEqual(display_code("MEA", "metro"), "A")
        self.assertEqual(display_code("MEB1", "metro"), "B1")
        self.assertEqual(display_code("MEA", "bus"), "MEA")

    def test_mode_radius_and_nearest_stop_per_line(self):
        """Bus up to 500 m, metro up to 800 m; each line once, at its nearest stop."""
        index = StopIndex(
            network(
                stop("near", 120, {"49": ["svc"]}),
                stop("far", 300, {"49": ["svc"]}),
                stop("bus600", 600, {"n92": ["svc"]}),
                stop("metro700", 700, {"MEA": ["svc"]}),
            )
        )
        rows = nearby_lines(index, {"svc"}, LON, LAT)
        self.assertEqual([r["route_id"] for r in rows], ["MEA", "49"])
        self.assertEqual(rows[1]["stop_id"], "near")
        self.assertEqual(rows[0]["code"], "A")
        self.assertEqual(rows[0]["color"], "#E27439")
        index_far_metro = StopIndex(network(stop("metro900", 900, {"MEA": ["svc"]})))
        self.assertEqual(nearby_lines(index_far_metro, {"svc"}, LON, LAT), [])

    def test_lines_not_running_today_are_omitted(self):
        """Only services active on the day count."""
        index = StopIndex(network(stop("s", 50, {"49": ["weekday"]})))
        self.assertEqual(nearby_lines(index, {"sunday"}, LON, LAT), [])

    def test_night_lines_listed_after_day_lines_and_not_in_badge(self):
        """A closer night bus is still listed, after day lines; the badge shows the day bus."""
        index = StopIndex(
            network(stop("a", 20, {"n92": ["svc"]}), stop("b", 400, {"49": ["svc"]}))
        )
        rows = nearby_lines(index, {"svc"}, LON, LAT)
        self.assertEqual([(r["code"], r["night"]) for r in rows], [("49", False), ("n92", True)])
        self.assertEqual(summary(rows)["surface"]["code"], "49")
        self.assertEqual(summary(rows)["lines"], 2)


class AvailabilityTests(unittest.TestCase):
    """Missing or out-of-calendar transport never breaks the badge request."""

    def setUp(self):
        """Use a copy of the contract fixture (service on 2026-01-05 only)."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "transport"
        shutil.copytree(FIXTURE, self.root)

    def test_fixture_day_ranks_fixture_lines(self):
        """On a service day the fixture's metro, tram and bus are all near (12.5, 41.9)."""
        result = lines_near_places({"p": (LON, LAT)}, self.root, "2026-01-05")
        self.assertEqual(result["availability"], "available")
        self.assertEqual([r["mode"] for r in result["places"]["p"]][0], "metro")
        self.assertEqual({r["mode"] for r in result["places"]["p"]}, {"metro", "bus", "tram"})

    def test_outside_calendar_and_unavailable(self):
        """Explicit availability and no rows instead of an error."""
        self.assertEqual(
            lines_near_places({"p": (LON, LAT)}, self.root, "2026-01-06")["availability"],
            "outside_calendar",
        )
        (self.root / "active.json").unlink()
        result = lines_near_places({"p": (LON, LAT)}, self.root, "2026-01-05")
        self.assertEqual((result["availability"], result["places"]), ("unavailable", {}))


class EndpointTests(unittest.TestCase):
    """Routes over fixture subjects and the fixture transport root."""

    def setUp(self):
        """One located service and one without coordinates."""
        located = copy.deepcopy(subject("svc-1", "Mensa", {}))
        # subject() shares one position dict between source values and location.
        located["payload"]["source_values"]["posizione"]["coordinate"] = {"lat": LAT, "lng": LON}
        rows = [located, subject("svc-2", "Ascolto", {})]
        app.dependency_overrides[subject_source] = lambda: StaticSubjectSource(rows)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        root_patch = patch.object(main, "TRANSPORT_ROOT", FIXTURE)
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def test_list_and_detail_shapes(self):
        """Summary covers located places only; unknown place is 404."""
        services = self.client.get("/api/preview/services").json()
        located = [s for s in services if (s.get("place") or {}).get("geometry")]
        self.assertEqual(len(located), 1)
        place_id = located[0]["place"]["id"]
        listing = self.client.get("/api/preview/transit/places").json()
        self.assertIn("availability", listing)
        self.assertIn("method", listing)
        detail = self.client.get(f"/api/preview/transit/places/{place_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertIn("lines", detail.json())
        self.assertEqual(self.client.get("/api/preview/transit/places/nope").status_code, 404)


if __name__ == "__main__":
    unittest.main()
