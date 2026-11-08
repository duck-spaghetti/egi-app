"""Check date/mode/viewport selection independently of the Helpinet database.

The input is the vendored contract fixture `fixtures/transport-root`, a copy of
`egi-importer/tests/fixtures/transport-root`. No importer code is imported.
"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from datetime import datetime, timedelta, timezone

from app.backend.transport import (
    load_active,
    read_network,
    group_stations,
    refresh_stale,
    route_geometry,
    transport_view,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "transport-root"
PRODUCER = (
    Path(__file__).resolve().parents[2]
    / "egi-importer/tests/fixtures/transport-root"
)
SERVICE_DAY = "2026-01-05"
EXCEPTION_DAY = "2026-01-06"


def files(root: Path) -> dict[str, bytes]:
    """Map every file below root (relative POSIX path) to its bytes."""
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


class TransportViewTests(unittest.TestCase):
    """Validate the importer's published format through the read-only app projection."""

    def setUp(self):
        """Copy the fixture so tests may alter status/active files."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "transport"
        shutil.copytree(FIXTURE, self.root)
        self.addCleanup(read_network.cache_clear)

    def view(self, bbox, zoom, modes, day=SERVICE_DAY):
        """Project the fixture root for one scheduled day."""
        return transport_view(bbox, zoom, modes, self.root, day)

    def test_mode_zoom_bbox_and_membership(self):
        """Only active selected modes appear, with bus detail gated by zoom."""
        bbox = [12.4, 41.8, 12.6, 42]
        low = self.view(bbox, 11, {"metro", "bus"})
        self.assertEqual(len(low["features"]), 1)
        self.assertEqual(low["features"][0]["properties"]["transport_type"], "metro")
        high = self.view(bbox, 14, {"bus"})
        self.assertEqual(len(high["features"]), 3)
        self.assertTrue(
            all(f["properties"]["transport_type"] == "bus" for f in high["features"])
        )
        self.assertEqual(
            high["features"][1]["properties"]["routes"][0]["route_id"], "bus"
        )
        empty = self.view([11, 40, 11.5, 40.5], 14, {"metro", "bus"})
        self.assertEqual(empty["features"], [])

    def test_date_rollover_and_service_exception(self):
        """A new day with an exception needs no new download and displays no service."""
        data = self.view([12, 41, 13, 43], 14, {"metro", "bus"}, EXCEPTION_DAY)
        self.assertEqual(data["availability"], "outside_calendar")
        self.assertEqual(data["features"], [])

    def test_offline_refresh_retains_valid_projection(self):
        """Importer failure is visible while last-valid scheduled geometry remains."""
        (self.root / "status.json").write_text(
            json.dumps({"result": "failed", "last_error": "offline"})
        )
        data = self.view([12, 41, 13, 43], 14, {"metro", "bus"})
        self.assertEqual(data["availability"], "available")
        self.assertEqual(len(data["features"]), 4)
        self.assertEqual(data["refresh"]["result"], "failed")

    def test_stale_refresh_is_flagged(self):
        """An old or missing last attempt means the scheduled poller stopped."""
        old = self.view([12, 41, 13, 43], 14, {"metro"})
        self.assertTrue(old["refresh_stale"])
        now = datetime.now(timezone.utc)
        self.assertFalse(refresh_stale({"last_attempt_at": now.isoformat()}, now))
        self.assertTrue(
            refresh_stale(
                {"last_attempt_at": (now - timedelta(hours=25)).isoformat()}, now
            )
        )
        self.assertTrue(refresh_stale({}, now))

    def test_missing_transport_is_explicit(self):
        """An absent or unreadable feed is represented separately from services."""
        (self.root / "active.json").unlink()
        data = self.view([12, 41, 13, 43], 14, {"metro"})
        self.assertEqual(data["availability"], "unavailable")
        self.assertEqual(data["features"], [])

    def test_route_detail_follows_zoom(self):
        """Simplified levels are served below FULL_DETAIL_ZOOM, full geometry above."""
        feature = {
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1], [2, 0]]},
            "simplified": {"11": [[0, 0], [2, 0]], "13": [[0, 0], [1, 1], [2, 0]]},
        }
        self.assertEqual(route_geometry(feature, 12)["coordinates"], [[0, 0], [2, 0]])
        self.assertEqual(len(route_geometry(feature, 14)["coordinates"]), 3)
        self.assertIs(route_geometry(feature, 17), feature["geometry"])
        self.assertIs(route_geometry({"geometry": feature["geometry"]}, 11), feature["geometry"])
        served = self.view([12, 41, 13, 43], 14, {"bus"})["features"]
        self.assertTrue(all("simplified" not in f for f in served))

    def test_unknown_format_is_rejected(self):
        """A newer importer format is unavailable rather than misread."""
        active = json.loads((self.root / "active.json").read_text())
        active["format"] = "egi-transport/99"
        (self.root / "active.json").write_text(json.dumps(active))
        with self.assertRaises(ValueError):
            load_active(self.root)
        data = self.view([12, 41, 13, 43], 14, {"metro"})
        self.assertEqual(data["availability"], "unavailable")


class StationAndTramTests(unittest.TestCase):
    """Metro platforms show as one station; tram lines appear from zoom 12."""

    def setUp(self):
        """Copy the fixture, which has one metro, one tram and one bus route."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "transport"
        shutil.copytree(FIXTURE, self.root)
        self.addCleanup(read_network.cache_clear)

    @staticmethod
    def metro_stop(stop_id, name, lon, lat, route="MEA"):
        """A projected metro stop feature as transport_view builds it."""
        return {
            "type": "Feature",
            "id": "stop:" + stop_id,
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "kind": "stop",
                "stop_id": stop_id,
                "name": name,
                "transport_type": "metro",
                "routes": [{"route_id": route, "code": route, "mode": "metro", "display_code": route[-1]}],
            },
        }

    def test_same_named_platforms_merge_within_150_m(self):
        """Termini A and B platforms become one station; a far namesake stays apart."""
        stops = [
            self.metro_stop("a1", "Termini", 12.5000, 41.9000, "MEA"),
            self.metro_stop("b1", "TERMINI", 12.5010, 41.9003, "MEB"),
            self.metro_stop("x", "Termini", 12.5300, 41.9000, "MEA"),
            self.metro_stop("r", "Repubblica", 12.5002, 41.9001, "MEA"),
        ]
        stations = group_stations(stops)
        merged = [s for s in stations if len(s["properties"]["stop_ids"]) == 2]
        self.assertEqual(len(stations), 3)
        self.assertEqual(merged[0]["properties"]["stop_ids"], ["a1", "b1"])
        self.assertEqual(
            [r["route_id"] for r in merged[0]["properties"]["routes"]], ["MEA", "MEB"]
        )
        self.assertEqual(merged[0]["properties"]["kind"], "station")

    def test_tram_lines_from_zoom_12_and_metro_codes(self):
        """Tram is hidden at zoom 11 and shown at 12; route features carry display codes."""
        bbox = [12.4, 41.8, 12.6, 42]
        z11 = transport_view(bbox, 11, {"tram"}, self.root, SERVICE_DAY)["features"]
        z12 = transport_view(bbox, 12, {"tram"}, self.root, SERVICE_DAY)["features"]
        self.assertEqual(z11, [])
        self.assertEqual([f["properties"]["transport_type"] for f in z12], ["tram"])
        metro = transport_view(bbox, 11, {"metro"}, self.root, SERVICE_DAY)["features"]
        self.assertEqual(metro[0]["properties"]["code"], "MA")


class PendingVersionTests(unittest.TestCase):
    """A staged version is served from its first service day, before promotion."""

    def setUp(self):
        """Turn the fixture's version into a pending one with nothing active yet."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "transport"
        shutil.copytree(FIXTURE, self.root)
        (self.root / "active.json").rename(self.root / "pending.json")
        self.addCleanup(read_network.cache_clear)

    def test_pending_served_only_on_its_service_days(self):
        """Before its first day nothing is active; on that day the pending network is used."""
        before = transport_view([12, 41, 13, 43], 14, {"metro"}, self.root, "2026-01-04")
        self.assertEqual(before["availability"], "unavailable")
        on_day = transport_view([12, 41, 13, 43], 14, {"metro"}, self.root, SERVICE_DAY)
        self.assertEqual(on_day["availability"], "available")
        self.assertTrue(on_day["features"])


@unittest.skipUnless(PRODUCER.is_dir(), "sibling egi-importer checkout not present")
class ContractDriftTests(unittest.TestCase):
    """When the producer is checked out alongside, the vendored copy must match it."""

    def test_vendored_fixture_matches_importer(self):
        """Refresh with: cp -R ../egi-importer/tests/fixtures/transport-root tests/fixtures/"""
        self.assertEqual(files(FIXTURE), files(PRODUCER))


if __name__ == "__main__":
    unittest.main()
