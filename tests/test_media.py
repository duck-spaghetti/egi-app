"""Media representation: sensitive exclusion, provider priority, 360° preference, switch."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app.backend import main
from app.backend.media import MediaCatalog, representation, sensitivity
from app.backend.subjects import StaticSubjectSource
from tests.test_map_sources import map_row


def card(**overrides):
    base = {"id": "s1", "name": "Sportello", "service_title": "Sportello", "description": "Orientamento",
            "native_classifications": {"tipologia": "Sportelli legali"}, "access_raw": {},
            "placement": {"section": "services"}, "itinerant_source": False,
            "place": {"geometry": {"type": "Point", "coordinates": [12.5, 41.9]}, "is_protected_address": False}}
    return {**base, **overrides}


def cand(i, distance, pano=False, facing=True, age=1.0):
    return {"id": f"m{i}", "distance_m": distance, "pano": pano, "facing": facing, "age_years": age,
            "creator": "someone", "lat": 41.9, "lon": 12.5, "bearing": 90}


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.subs, self.mly = base / "subs.json", base / "mly.json"
        self.catalog = MediaCatalog(self.subs, self.mly)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, subs=None, mly=None):
        self.subs.write_text(json.dumps(subs or []))
        self.mly.write_text(json.dumps({"pois": {"s1": {"best": mly or []}}}))

    def test_sensitive_services_get_no_images(self):
        self.write(mly=[cand(1, 5)])
        for service in [card(name="CAV Alfa"), card(description="Centro antiviolenza"),
                        card(access_raw={"vittima_di_violenza": True}),
                        card(place={"geometry": None, "is_protected_address": True})]:
            result = representation(service, self.catalog)
            self.assertIsNotNone(result["excluded"], service)
            self.assertIsNone(result["primary"])
            self.assertEqual(result["on_request"], [], "no Street View link for sensitive services either")
        self.assertIsNone(sensitivity(card(name="Caserma Cavour")), "CAV only as a whole word")

    def test_provider_priority_and_street_view_on_request(self):
        self.write(subs=[{"service_id": "s1", "provider": "user", "url": "/u.jpg", "status": "approved"},
                         {"service_id": "s1", "provider": "organization", "url": "/o.jpg", "status": "approved"},
                         {"service_id": "s1", "provider": "organization", "url": "/x.jpg", "status": "pending"}],
                   mly=[cand(1, 5)])
        result = representation(card(), self.catalog)
        self.assertEqual([result["primary"]["provider"]] + [g["provider"] for g in result["gallery"]],
                         ["organization", "mapillary", "user"])
        self.assertNotIn("/x.jpg", json.dumps(result), "unapproved submissions are never shown")
        self.assertEqual(result["on_request"][0]["provider"], "street_view")
        self.assertIn("viewpoint=41.900000,12.500000", result["on_request"][0]["url"])

    def test_mapillary_prefers_360_and_drops_unhelpful(self):
        self.write(mly=[cand(1, 4), cand(2, 25, pano=True, facing=False), cand(3, 10, facing=False),
                        cand(4, 45), cand(5, 8, age=9)])
        result = representation(card(), self.catalog)
        self.assertEqual(result["primary"]["image_id"], "m2", "a 360° within 30 m beats a closer flat image")
        self.assertEqual([g["image_id"] for g in result["gallery"]], ["m1"])

    def test_no_media_without_fixed_site_and_when_disabled(self):
        self.write(mly=[cand(1, 5)])
        self.assertEqual(representation(card(itinerant_source=True), self.catalog)["excluded"], "no_fixed_site")
        with mock.patch.dict(os.environ, {"EGI_MEDIA_ENABLED": "0"}):
            result = representation(card(), self.catalog)
            self.assertFalse(result["enabled"])
            self.assertIsNone(result["primary"])

    def test_route(self):
        rows = [map_row("a", "Salute", "matched_house")]
        main.app.dependency_overrides[main.subject_source] = lambda: StaticSubjectSource(rows)
        try:
            client = TestClient(main.app)
            data = client.get("/api/preview/media?service=a").json()
            self.assertEqual(data["service_id"], "a")
            self.assertEqual(client.get("/api/preview/media?service=nope").status_code, 404)
        finally:
            main.app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
