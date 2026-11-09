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


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.subs = base / "subs.json"
        self.catalog = MediaCatalog(self.subs)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, subs=None):
        self.subs.write_text(json.dumps(subs or [{"service_id": "s1", "provider": "organization", "url": "/o.jpg", "status": "approved"}]))

    def test_sensitive_services_get_no_images(self):
        self.write()
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
                         {"service_id": "s1", "provider": "organization", "url": "/x.jpg", "status": "pending"}])
        result = representation(card(), self.catalog)
        self.assertEqual([result["primary"]["provider"]] + [g["provider"] for g in result["gallery"]],
                         ["organization", "user"])
        self.assertNotIn("/x.jpg", json.dumps(result), "unapproved submissions are never shown")
        self.assertEqual(result["on_request"][0]["provider"], "street_view")
        self.assertIn("viewpoint=41.900000,12.500000", result["on_request"][0]["url"])

    def test_360_submission_comes_first_within_a_provider(self):
        self.write(subs=[{"service_id": "s1", "provider": "organization", "url": "/flat.jpg", "status": "approved"},
                         {"service_id": "s1", "provider": "organization", "url": "/pano.jpg", "status": "approved", "is_360": True}])
        self.assertEqual(representation(card(), self.catalog)["primary"]["url"], "/pano.jpg")

    def test_no_media_without_fixed_site_and_when_disabled(self):
        self.write()
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
