"""Map-export (My Maps) rows in the preview: grouping, estimated positions, labels."""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.backend.main import app, subject_source
from app.backend.preview import categories, services
from app.backend.subjects import StaticSubjectSource
from tests.test_service_presentation import subject


def map_row(identifier: str, layer: str, status: str, ambiguous: bool = False, hours: str | None = None) -> dict:
    """A geocoded Programma Integra service as returned by the subject query."""
    return {
        "id": identifier,
        "source_code": "programma-integra",
        "source_name": "Programma Integra — Rome Welcome Map",
        "dataset_url": "https://www.google.com/maps/d/viewer?mid=X",
        "source_attribution": "Programma Integra (Google My Maps)",
        "source_locator": f"placemark:{identifier}:service",
        "run_id": "run",
        "observed_at": "2026-11-09T00:46:00Z",
        "payload": {
            "name": "Sportello Alfa",
            "layer": layer,
            "description": "Orientamento",
            "offer_text": None,
            "contacts": [{"channel": "phone", "value": "06 123", "normalized": "+3906123"}],
            "hours": {"raw_value": hours},
            "location": {"address_raw": "Via Alfa 1, 00185 Roma"},
            "source_classifications": {"layer": layer, "help_topics": ["Salute"]},
            "declared_update": {"text": "aggiornato a maggio 2024", "year": 2024, "month": 5, "curator_named": None},
            "organization_claim": {"name_raw": None},
            "review_required": ["coordinates_require_geocoding"],
            "source_values": {"Indirizzo": "Via Alfa 1"},
        },
        "geocode": {
            "status": status,
            "ambiguous": ambiguous,
            "chosen": {"lat": 41.9, "lon": 12.51, "display_name": "Via Alfa, Roma"},
            "provider": "nominatim.openstreetmap.org",
        },
    }


class MapSourceTests(unittest.TestCase):
    def test_layers_join_presentation_groups(self):
        rows = [subject("h1", "Mensa", {}), map_row("a", "Mense", "matched_house"),
                map_row("b", "Socialità volontariato e tempo libero", "matched_house")]
        by_id = {s["id"]: s for s in services(rows)}
        self.assertEqual(by_id["a"]["category"]["slug"], "cibo")
        self.assertEqual(by_id["a"]["category"]["slug"], by_id["h1"]["category"]["slug"])
        self.assertEqual(by_id["b"]["category"]["slug"], "socialita")
        self.assertEqual(by_id["a"]["native_classifications"]["tipologia"], "Mense")
        self.assertEqual({c["slug"] for c in categories(rows)}, {"cibo", "socialita"})

    def test_only_confident_candidates_become_points(self):
        rows = [map_row("house", "Salute", "matched_house"), map_row("amb", "Salute", "matched_street", ambiguous=True),
                map_row("cap", "Salute", "postcode_area"), map_row("none", "Salute", "unresolved")]
        by_id = {s["id"]: s for s in services(rows)}
        self.assertEqual(by_id["house"]["place"]["geometry"], {"type": "Point", "coordinates": [12.51, 41.9]})
        self.assertIn("stimata", by_id["house"]["placement"]["label"])
        for key in ["amb", "cap", "none"]:
            self.assertIsNone(by_id[key]["place"]["geometry"], key)
        self.assertIn("CAP", by_id["cap"]["placement"]["label"])

    def test_source_labels_hours_and_update(self):
        service = services([map_row("a", "Salute", "matched_house", hours="Lun 9-12")])[0]
        self.assertEqual(service["sources"][0]["source_name"], "Programma Integra")
        self.assertEqual(service["sources"][0]["source_url"], "https://www.google.com/maps/d/viewer?mid=X")
        self.assertEqual(service["hours_display"]["raw_text"], "Lun 9-12")
        self.assertTrue(all(not d["intervals"] for d in service["hours_display"]["days"]), "free text is never parsed")
        self.assertEqual(service["declared_update"], "maggio 2024")
        self.assertEqual(service["native_classifications"]["prestazioni"], [{"id": "topic:Salute", "nome": "Salute"}])

    def test_coverage_measures_helpinet_only(self):
        rows = [subject("h1", "Mensa", {}), map_row("a", "Mense", "matched_house")]
        app.dependency_overrides[subject_source] = lambda: StaticSubjectSource(rows)
        try:
            client = TestClient(app)
            self.assertEqual(client.get("/api/preview/coverage").json()["services"], 1)
            self.assertEqual(len(client.get("/api/preview/services").json()), 2)
        finally:
            app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
