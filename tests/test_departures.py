"""Check next scheduled departures on the vendored contract fixture.

Fixture service "svc" runs on 2026-01-05 only (removed on 2026-01-06). Times:
bus 08:00 at s1 / 08:05 at s2, tram 12:30 / 12:36, metro 24:01 at s1 / 24:06 at s2.
s2 is every trip's last stop, so it has no departures.
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.backend.api.transport.departures import clock, next_departures
from app.backend.main import app
from app.backend.api.transport.network import read_network

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "transport-root"
ROME = ZoneInfo("Europe/Rome")


def at(text: str) -> datetime:
    """A Rome wall-clock moment."""
    return datetime.fromisoformat(text).replace(tzinfo=ROME)


class NextDepartureTests(unittest.TestCase):
    """Upcoming times, exhausted directions and trips after midnight."""

    def setUp(self):
        """Copy the fixture root."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "transport"
        shutil.copytree(FIXTURE, self.root)
        self.addCleanup(read_network.cache_clear)

    def by_route(self, result):
        """route_id → list of 'HH:MM' times."""
        return {d["route_id"]: [t["time"] for t in d["times"]] for d in result["departures"]}

    def test_upcoming_times_ordered_with_minutes_left(self):
        """At 07:50 the bus leaves s1 in 10 minutes, then tram, then metro."""
        result = next_departures(["s1"], root=self.root, now=at("2026-01-05T07:50"))
        self.assertEqual(result["availability"], "available")
        self.assertEqual([d["route_id"] for d in result["departures"]], ["bus", "tram", "metro"])
        self.assertEqual(result["departures"][0]["times"], [{"time": "08:00", "in_min": 10}])
        self.assertEqual(result["departures"][0]["headsign"], "West")
        metro = [d for d in result["departures"] if d["route_id"] == "metro"][0]
        self.assertEqual(metro["color"], "#E27439")

    def test_no_more_trips_is_explicit(self):
        """After 12:30 the tram direction is listed with no times."""
        result = next_departures(["s1"], {"tram"}, root=self.root, now=at("2026-01-05T12:31"))
        self.assertEqual(self.by_route(result), {"tram": []})

    def test_trip_after_midnight_belongs_to_previous_service_day(self):
        """At 00:00 on a day without service, yesterday's 24:01 metro is in 1 minute."""
        result = next_departures(["s1"], root=self.root, now=at("2026-01-06T00:00"))
        metro = [d for d in result["departures"] if d["route_id"] == "metro"][0]
        self.assertEqual(metro["times"], [{"time": "00:01", "in_min": 1}])
        self.assertEqual(self.by_route(result)["bus"], [])

    def test_terminal_stop_has_no_departures(self):
        """Arrivals at a trip's last stop are not offered as departures."""
        result = next_departures(["s2"], root=self.root, now=at("2026-01-05T07:00"))
        self.assertEqual(result["departures"], [])

    def test_missing_file_is_unavailable(self):
        """Without departures.sqlite the schedule is unavailable, not an error."""
        for path in self.root.glob("versions/*/departures.sqlite"):
            path.unlink()
        result = next_departures(["s1"], root=self.root, now=at("2026-01-05T07:50"))
        self.assertEqual((result["availability"], result["departures"]), ("unavailable", []))

    def test_clock_wraps(self):
        """24:03 shows as 00:03."""
        self.assertEqual(clock(1443), "00:03")


class RealtimeTests(unittest.TestCase):
    """Fresh predictions join their trip's direction; stale ones are ignored; alerts attach."""

    def setUp(self):
        """Fixture root plus a realtime snapshot: bus trip tb predicted at s1 08:04 (+4 min)."""
        import json

        import app.backend.api.transport.departures as module

        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "transport"
        shutil.copytree(FIXTURE, self.root)
        self.addCleanup(read_network.cache_clear)
        module._realtime_cache.update(mtime=None, data=None)
        self.now = at("2026-01-05T07:50")
        self.snapshot = {
            "format": "egi-realtime/1",
            "feeds": {"trip_updates": {"fetched_epoch": self.now.timestamp() - 30, "fetched_at": "x"}},
            "predictions": {"s1": [["tb", at("2026-01-05T08:04").timestamp(), 240]]},
            "alerts": [
                {"id": "a1", "periods": [{"start": 0, "end": None}], "routes": ["bus"], "stops": [],
                 "header": "Deviazione", "description": "", "url": ""},
                {"id": "a2", "periods": [{"start": 0, "end": None}], "routes": ["other"], "stops": [],
                 "header": "Altro", "description": "", "url": ""},
            ],
        }
        (self.root / "realtime").mkdir()
        (self.root / "realtime" / "latest.json").write_text(json.dumps(self.snapshot))

    def test_live_prediction_and_alert(self):
        """The bus direction gets 08:04 (+4) as realtime; only the matching alert is attached."""
        result = next_departures(["s1"], {"bus"}, root=self.root, now=self.now)
        self.assertEqual(result["realtime"]["status"], "live")
        bus = result["departures"][0]
        self.assertEqual(bus["realtime"], [{"time": "08:04", "in_min": 14, "delay_min": 4}])
        self.assertEqual(bus["times"][0]["time"], "08:00")
        self.assertEqual([a["id"] for a in result["alerts"]], ["a1"])

    def test_stale_snapshot_is_not_realtime(self):
        """Predictions fetched over 3 minutes ago are not shown."""
        import json

        import app.backend.api.transport.departures as module

        self.snapshot["feeds"]["trip_updates"]["fetched_epoch"] = self.now.timestamp() - 600
        (self.root / "realtime" / "latest.json").write_text(json.dumps(self.snapshot))
        module._realtime_cache.update(mtime=None, data=None)
        result = next_departures(["s1"], {"bus"}, root=self.root, now=self.now)
        self.assertEqual(result["realtime"]["status"], "stale")
        self.assertEqual(result["departures"][0]["realtime"], [])


class DepartureEndpointTests(unittest.TestCase):
    """Validation of the stop list."""

    def test_stop_list_limits(self):
        """Empty or more than 40 stops is 422."""
        client = self.enterContext(TestClient(app))
        self.assertEqual(client.get("/api/preview/transit/departures?stops=").status_code, 422)
        many = ",".join(f"s{i}" for i in range(41))
        self.assertEqual(client.get(f"/api/preview/transit/departures?stops={many}").status_code, 422)


if __name__ == "__main__":
    unittest.main()
