"""Exercise a running local preview against the actual imported PostgreSQL evidence.

Set EGI_APP_BASE_URL to the loopback preview, never a production application.
"""

from __future__ import annotations

import json
import os
import unittest
import uuid
from urllib.error import HTTPError
from urllib.request import urlopen

BASE = os.environ.get("EGI_APP_BASE_URL", "")


@unittest.skipUnless(BASE, "set EGI_APP_BASE_URL to the running local preview")
class PreviewHttpTests(unittest.TestCase):
    """Check the recovered pages and read-only preview API through real HTTP."""

    def get(self, path: str):
        """Request only the explicitly selected loopback application."""
        if not BASE.startswith(("http://127.0.0.1:", "http://localhost:")):
            raise RuntimeError("Preview checks require a loopback URL")
        return urlopen(BASE + path, timeout=10)

    def payload(self, path: str):
        """Decode a successful JSON response from the real server."""
        with self.get(path) as response:
            self.assertEqual(
                response.headers["X-EGI-Data-Status"], "unreviewed-source-preview"
            )
            return json.load(response)

    def test_database_health_and_all_services(self):
        """The app reads exactly the imported services, retaining UUIDs and unknowns."""
        self.assertEqual(self.payload("/health")["services"], 315)
        records = self.payload("/api/preview/services?area_id=1")
        self.assertEqual(len(records), 315)
        self.assertEqual(len({r["id"] for r in records}), 315)
        for record in records:
            uuid.UUID(record["id"])
            self.assertEqual(record["data_status"], "unreviewed_source_preview")
            self.assertIsNone(record["description"])
            self.assertEqual(record["hours"], [])
            self.assertIsNone(record["original_retrieved_at"])
        self.assertEqual(sum(r["place"]["geometry"] is not None for r in records), 313)

    def test_rich_service_fields_and_benchmark(self):
        """All source fields, provisional groups and derived summaries reach the preview."""
        records = self.payload("/api/preview/services?area_id=1")
        self.assertEqual(len({r["source_group"]["external_key"] for r in records}), 201)
        self.assertEqual(sum(bool(r["derived_summary"]["text"]) for r in records), 315)
        for record in records:
            self.assertEqual(len(record["source_values"]), 12)
            self.assertEqual(len(record["hours_display"]["days"]), 7)
            self.assertIsNone(record["hours_display"]["open_now"])
            self.assertEqual(record["placement"]["section"], "services")
        benchmark = self.payload("/api/preview/coverage")
        self.assertEqual(benchmark["services"], 315)
        self.assertEqual(len(benchmark["fields"]), 12)
        self.assertEqual(len(benchmark["access_flags"]), 44)
        desc = next(f for f in benchmark["fields"] if f["field"] == "descrizione")
        self.assertEqual(desc["populated_at_source"], 0)
        with self.get("/benchmark") as response:
            self.assertIn("Copertura dei dati Helpinet", response.read().decode())

    def test_recovered_pages_translations_filters_and_assets(self):
        """Recovered pages render with the preview marker and all UI language catalogs."""
        for path in ["/", "/map?city_id=1&lang=it", "/map?city_id=1&lang=ar"]:
            with self.get(path) as response:
                body = response.read().decode()
                self.assertIn("Dati Helpinet non revisionati", body)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(len(self.payload("/api/preview/categories")), 9)
        self.assertEqual(len(self.payload("/api/preview/languages")), 4)
        self.assertEqual(len(self.payload("/api/preview/areas")), 1)
        self.assertEqual(self.payload("/api/preview/category-translations"), [])
        for language in ["it", "en", "fr", "ar"]:
            self.payload("/translations/" + language + ".json")
        with self.get("/static/js/map.js") as response:
            body = response.read().decode()
            self.assertIn("/api/preview/services", body)
            self.assertIn("function openDetail(id)", body)
            self.assertIn("Da verificare", body)

    def test_input_errors_and_no_public_or_mutation_router(self):
        """Invalid selections fail and private evidence has no public directory route."""
        for path, code in [
            ("/api/preview/services?limit=0", 422),
            ("/api/preview/services?area_id=99", 404),
            ("/map?city_id=99", 404),
            ("/api/public/services", 404),
            ("/api/entities/services", 404),
        ]:
            with self.assertRaises(HTTPError) as error:
                self.get(path)
            self.assertEqual(error.exception.code, code)

    def test_scheduled_transport_and_unchanged_services(self):
        """Actual active GTFS reaches the preview without changing Helpinet count."""
        metro = self.payload(
            "/api/preview/transport?modes=metro&zoom=14&west=12.2&south=41.7&east=12.9&north=42.2"
        )
        self.assertEqual(metro["availability"], "available")
        routes = {
            f["properties"]["route_id"]
            for f in metro["features"]
            if f["properties"]["kind"] == "route"
        }
        self.assertEqual(routes, {"MEA", "MEB", "MEB1", "MEC"})
        self.assertTrue(
            any(f["geometry"]["type"] == "Point" for f in metro["features"])
        )
        bus = self.payload(
            "/api/preview/transport?modes=bus&zoom=14&west=12.48&south=41.89&east=12.51&north=41.92"
        )
        self.assertTrue(bus["features"])
        self.assertTrue(
            all(f["properties"]["transport_type"] == "bus" for f in bus["features"])
        )
        self.assertEqual(
            self.payload("/api/preview/transport?modes=bus&zoom=11")["features"], []
        )
        self.assertEqual(len(self.payload("/api/preview/services")), 315)
        tram = self.payload(
            "/api/preview/transport?modes=tram&zoom=12&west=12.44&south=41.86&east=12.52&north=41.92"
        )
        self.assertTrue(
            tram["features"]
            and all(f["properties"]["transport_type"] == "tram" for f in tram["features"])
        )
        focus = self.payload("/api/preview/transport?routes=MEA&zoom=11&west=0&south=0&east=1&north=1")
        self.assertEqual(
            {f["properties"]["route_id"] for f in focus["features"] if f["properties"]["kind"] == "route"},
            {"MEA"},
        )
        too_many = ",".join(str(i) for i in range(81))
        for query in ["modes=ferry", "west=13&east=12", "zoom=30", "west=nan", "routes=", "routes=" + too_many]:
            with self.assertRaises(HTTPError) as error:
                self.get("/api/preview/transport?" + query)
            self.assertEqual(error.exception.code, 422)
