"""Check date/mode/viewport selection independently of the Helpinet database.

The input is the vendored contract fixture `fixtures/transport-root`, a copy of
`egi-importer/tests/fixtures/transport-root`. No importer code is imported.
"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app.backend.transport import load_active, read_network, transport_view

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

    def test_missing_transport_is_explicit(self):
        """An absent or unreadable feed is represented separately from services."""
        (self.root / "active.json").unlink()
        data = self.view([12, 41, 13, 43], 14, {"metro"})
        self.assertEqual(data["availability"], "unavailable")
        self.assertEqual(data["features"], [])

    def test_unknown_format_is_rejected(self):
        """A newer importer format is unavailable rather than misread."""
        active = json.loads((self.root / "active.json").read_text())
        active["format"] = "egi-transport/99"
        (self.root / "active.json").write_text(json.dumps(active))
        with self.assertRaises(ValueError):
            load_active(self.root)
        data = self.view([12, 41, 13, 43], 14, {"metro"})
        self.assertEqual(data["availability"], "unavailable")


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
