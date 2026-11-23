from app.backend import local_routes, search_routes, runtime
"""Verify address-search isolation, local train visibility and origin/destination semantics."""

from copy import deepcopy
from datetime import datetime
from zoneinfo import ZoneInfo
from app.backend import departures
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from app.backend import geocoding, main, transport
from app.backend.transit_nearby import StopIndex, local_route


class GeocodingTests(unittest.TestCase):
    """Exercise the real adapter with a fake upstream and disposable shared throttle."""

    def setUp(self):
        """Isolate rate state/cache; never call a public provider from unit tests."""
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "rate.lock"
        override = patch.object(geocoding, "RATE_FILE", self.path)
        override.start()
        self.addCleanup(override.stop)
        geocoding._CACHE.clear()
        self.addCleanup(geocoding._CACHE.clear)

    def test_cache_throttle_bounds_and_no_query_on_disk(self):
        """Only cache misses use upstream; shared rate state contains no address."""
        fetch = Mock(return_value=[{"lat":"41.9", "lon":"12.5", "display_name":"Roma"},
                                   {"lat":"45", "lon":"9", "display_name":"outside"}])
        with patch.object(geocoding.time, "time", return_value=100), patch.object(geocoding.time, "sleep") as sleep:
            first = geocoding.search_address("Roma Termini", fetch)
            self.assertEqual(geocoding.search_address("  ROMA   Termini ", fetch), first)
            geocoding.search_address("Roma Tiburtina", fetch)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(sleep.call_args.args[0], 1)
        self.assertEqual(first, [{"lat":41.9,"lon":12.5,"label":"Roma"}])
        self.assertEqual(self.path.read_text(), "100")

    def test_invalid_input_and_upstream_never_cached(self):
        """Reject malformed input/results without manufacturing a chosen reference."""
        fetch = Mock(return_value={"error":"bad"})
        with self.assertRaises(ValueError):
            geocoding.search_address("  ", fetch)
        fetch.assert_not_called()
        with self.assertRaises(ValueError):
            geocoding.search_address("Roma", fetch)
        self.assertFalse(geocoding._CACHE)

    def test_post_contract_and_failure_redaction(self):
        """Search uses POST, validates bounds and hides upstream exceptions/query text."""
        client = TestClient(main.app)
        with patch.object(search_routes,"search_address",return_value=[]) as search:
            self.assertEqual(client.post("/api/preview/address-search",json={"query":"Roma"}).json()["results"], [])
            self.assertEqual(client.post("/api/preview/address-search",json={"query":"x"}).status_code, 422)
            self.assertEqual(search.call_count,1)
        with patch.object(search_routes,"search_address",side_effect=OSError("secret query and upstream details")):
            response=client.post("/api/preview/address-search",json={"query":"Roma"})
            self.assertEqual(response.status_code,503)
            self.assertNotIn("secret",response.text)


class LocalTransportTests(unittest.TestCase):
    """Regional visibility is shared by station geometry, nearby lines and departures."""

    def test_source_categories(self):
        """Regional/metropolitan source categories survive; long-distance do not."""
        for code in ["REG","RV","MET","SFM","DIR"]:
            self.assertTrue(local_route({"mode":"rail","code":code}))
        for code in ["FR","FA","FB","IC","ICN","EXP","unknown"]:
            self.assertFalse(local_route({"mode":"rail","code":code}))
        self.assertTrue(local_route({"mode":"metro","code":"MEA"}))

    def test_regional_stations_without_approximate_tracks_even_in_focus(self):
        """Long-distance memberships and synthetic rail links cannot leak via focus."""
        fixture=Path(__file__).parent / "fixtures/transport-root"
        manifest,status,original=transport.load_active(fixture,"2026-01-05")
        network=deepcopy(original)
        for route in network["routes"].values():
            route.update(mode="rail",code="REG")
        network["routes"]["bus"]["code"]="FR"
        for feature in network["features"]:
            if feature["properties"]["kind"]=="route":
                feature["properties"]["transport_type"]="rail"
        with patch.object(transport,"load_active",return_value=(manifest,status,network)):
            # Avoid reusing the earlier immutable fixture's stop index.
            with patch.object(transport,"stop_index",side_effect=lambda _,n: StopIndex(n)):
                data=transport.transport_view([12,41,13,43],16,{"rail"},fixture,"2026-01-05",routes=set(network["routes"]))
        self.assertTrue(data["features"])
        self.assertTrue(all(f["geometry"]["type"]=="Point" for f in data["features"]))
        self.assertTrue(all(r["code"]!="FR" for f in data["features"] for r in f["properties"]["routes"]))

    def test_departures_use_the_same_regional_policy(self):
        """Actual SQLite departure reads exclude FR and retain REG for identical trips."""
        fixture=Path(__file__).parent / "fixtures/transport-root"
        manifest,status,original=transport.load_active(fixture,"2026-01-05")
        network=deepcopy(original)
        now=datetime(2026,1,5,7,50,tzinfo=ZoneInfo("Europe/Rome"))
        for code,expected in [("FR",False),("REG",True)]:
            network["routes"]["bus"].update(mode="rail",code=code)
            with patch.object(departures,"load_active",return_value=(manifest,status,network)):
                data=departures.next_departures(["s1"],root=fixture,now=now)
            self.assertEqual(any(d["route_id"]=="bus" for d in data["departures"]),expected)

    def test_origin_is_separate_and_validated_without_subject_database(self):
        """Origin requests accept explicit area coordinates and never query services."""
        client=TestClient(main.app)
        result={"availability":"available","places":{"origin":[]},"sources":[]}
        schedule={"availability":"available","departures":[],"realtime":{},"alerts":[],"now":"10:00"}
        with patch.object(local_routes,"nearby_transit",return_value=result), patch.object(local_routes,"next_departures_all",return_value=schedule), patch.object(runtime.SUBJECT_SOURCE,"latest") as db:
            data=client.post("/api/preview/transit/origin",json={"lat":41.9,"lon":12.5})
            self.assertEqual(data.status_code,200)
            self.assertEqual(data.json()["stops"],[])
            db.assert_not_called()
        self.assertEqual(client.post("/api/preview/transit/origin",json={"lat":45,"lon":9}).status_code,422)


if __name__=="__main__":
    unittest.main()
