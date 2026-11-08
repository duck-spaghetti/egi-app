"""Check date/mode/viewport selection independently of the Helpinet database."""

import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from app.backend.transport import read_network, transport_view

IMPORTER = Path(__file__).resolve().parents[2] / "egi-importer"
sys.path.insert(0, str(IMPORTER))
from egi_importer.transport import poll

spec = importlib.util.spec_from_file_location(
    "gtfs_fixtures", IMPORTER / "tests/test_transport.py"
)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class TransportViewTests(unittest.TestCase):
    """Validate actual pipeline output through the read-only app projection."""

    def setUp(self):
        """Build a complete disposable version with the production normalizer."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        publisher = fixtures.Publisher(fixtures.fixture())
        poll(self.root, publisher.fetch)
        self.addCleanup(read_network.cache_clear)

    def test_mode_zoom_bbox_and_membership(self):
        """Only active selected modes appear, with bus detail gated by zoom."""
        bbox = [12.4, 41.8, 12.6, 42]
        low = transport_view(bbox, 11, {"metro", "bus"}, self.root)
        self.assertEqual(len(low["features"]), 1)
        self.assertEqual(low["features"][0]["properties"]["transport_type"], "metro")
        high = transport_view(bbox, 14, {"bus"}, self.root)
        self.assertEqual(len(high["features"]), 3)
        self.assertTrue(
            all(f["properties"]["transport_type"] == "bus" for f in high["features"])
        )
        self.assertEqual(
            high["features"][1]["properties"]["routes"][0]["route_id"], "bus"
        )
        empty = transport_view([11, 40, 11.5, 40.5], 14, {"metro", "bus"}, self.root)
        self.assertEqual(empty["features"], [])

    def test_date_rollover_and_service_exception(self):
        """A new day with an exception needs no new download and displays no service."""
        tomorrow = (
            datetime.now(ZoneInfo("Europe/Rome")).date() + timedelta(days=1)
        ).isoformat()
        data = transport_view(
            [12, 41, 13, 43], 14, {"metro", "bus"}, self.root, tomorrow
        )
        self.assertEqual(data["availability"], "outside_calendar")
        self.assertEqual(data["features"], [])

    def test_offline_refresh_retains_valid_projection(self):
        """Importer failure is visible while last-valid scheduled geometry remains."""
        (self.root / "status.json").write_text(
            json.dumps({"result": "failed", "last_error": "offline"})
        )
        data = transport_view([12, 41, 13, 43], 14, {"metro", "bus"}, self.root)
        self.assertEqual(data["availability"], "available")
        self.assertEqual(len(data["features"]), 4)
        self.assertEqual(data["refresh"]["result"], "failed")

    def test_missing_transport_is_explicit(self):
        """An absent or unreadable feed is represented separately from services."""
        (self.root / "active.json").unlink()
        data = transport_view([12, 41, 13, 43], 14, {"metro"}, self.root)
        self.assertEqual(data["availability"], "unavailable")
        self.assertEqual(data["features"], [])
