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
            self.assertEqual(len(client.get("/api/preview/services").json()), 1, "the Helpinet fixture has no coordinates")
            self.assertEqual(len(client.get("/api/preview/services?include_unplaced=true").json()), 2)
        finally:
            app.dependency_overrides.clear()


    def test_debug_positions_include_hidden_candidates(self):
        rows = [subject("h1", "Mensa", {}), map_row("a", "Mense", "matched_house"),
                map_row("cap", "Mense", "postcode_area"), map_row("amb", "Mense", "matched_street", ambiguous=True)]
        app.dependency_overrides[subject_source] = lambda: StaticSubjectSource(rows)
        try:
            client = TestClient(app)
            data = client.get("/api/preview/debug/positions?source=programma-integra").json()
            self.assertEqual(data["total"], 3)
            by_id = {p["id"]: p for p in data["points"]}
            self.assertTrue(by_id["a"]["shown_on_map"])
            self.assertFalse(by_id["cap"]["shown_on_map"])
            self.assertEqual(by_id["cap"]["lat"], 41.9, "hidden candidates keep their coordinates for checking")
            self.assertTrue(by_id["amb"]["ambiguous"])
            self.assertEqual(client.get("/api/preview/debug/positions?source=nessuna").status_code, 404)
            codes = {s["code"]: s["services"] for s in client.get("/api/preview/debug/sources").json()}
            self.assertEqual(codes, {"helpinet": 1, "programma-integra": 3})
        finally:
            app.dependency_overrides.clear()


    def test_normalizer_classification_drives_cards(self):
        """0.3 payloads: excluded and secondary records hidden; need, type, claims and hours used."""
        base = map_row("a", "Salute", "matched_house")
        base["payload"]["classification"] = {"display": "shown", "need": "curarmi", "service_type": "Rilascio STP/ENI",
                                             "display_name": "Rilascio STP/ENI · Ospedale", "sector": "public",
                                             "access_claims": [{"code": "stp", "group": "audience", "label": "STP", "certainty": "derived", "basis": "definition"}]}
        base["payload"]["hours"] = {"raw_value": "Lunedì: 9:00-12:00", "weekly": {"lun": [{"inizio": "09:00", "fine": "12:00"}]}}
        base["payload"]["entity"] = {"mode": "name_address", "primary": True, "key": "k", "members": ["a", "b"], "needs": ["curarmi", "lavoro"], "topics": ["Salute", "Lavoro"]}
        secondary = map_row("b", "Lavoro", "matched_house")
        secondary["payload"]["classification"] = {"display": "shown", "need": "lavoro"}
        secondary["payload"]["entity"] = {"mode": "name_address", "primary": False, "key": "k", "members": ["a", "b"]}
        school = map_row("c", "Formazione / Scuole migranti", "matched_house")
        school["payload"]["classification"] = {"display": "excluded", "exclusion_reason": "state_school_without_migrant_service"}
        cards = services([base, secondary, school])
        self.assertEqual([c["id"] for c in cards], ["a"])
        card = cards[0]
        self.assertEqual((card["category"]["slug"], card["service_title"]), ("curarmi", "Rilascio STP/ENI · Ospedale"))
        self.assertEqual(card["needs"], ["curarmi", "lavoro"])
        self.assertEqual(card["native_classifications"]["tipologia"], "Rilascio STP/ENI")
        self.assertEqual(card["access_raw"], {"stp": True})
        self.assertEqual(card["hours_display"]["days"][0]["intervals"][0]["label"], "09:00 – 12:00")
        self.assertEqual({c["slug"] for c in categories([base, secondary, school])}, {"curarmi"})


    def test_position_issue_is_explicit(self):
        """Strategy 0.3 issues: named places and manual fixes are points; every other record says why not."""
        poi = map_row("p", "Salute", "matched_poi"); poi["geocode"]["issue"] = "ok"
        manual = map_row("m", "Salute", "manual"); manual["geocode"]["issue"] = "manual"
        cap = map_row("c", "Salute", "postcode_area"); cap["geocode"]["issue"] = "postcode_area_only"
        street = map_row("s", "Salute", "locality_only"); street["geocode"]["issue"] = "no_street"
        by_id = {x["id"]: x for x in services([poi, manual, cap, street])}
        self.assertIsNotNone(by_id["p"]["place"]["geometry"])
        self.assertIn("luogo indicato", by_id["p"]["placement"]["label"])
        self.assertIn("a mano", by_id["m"]["placement"]["label"])
        self.assertEqual(by_id["c"]["placement"]["issue"], "postcode_area_only")
        self.assertIsNone(by_id["c"]["place"]["geometry"])
        self.assertIn("senza via", by_id["s"]["placement"]["label"])


    def test_freshness_flags_old_declarations(self):
        row = map_row("a", "Salute", "matched_house")
        row["payload"]["declared_update"] = {"text": "Regione Lazio marzo 2022", "year": 2022, "month": 3}
        card = services([row])[0]
        self.assertTrue(card["freshness"]["stale"])
        self.assertIn("potrebbero non essere aggiornate", card["freshness"]["label"])
        row["payload"]["declared_update"] = None
        self.assertIn("non indica", services([row])[0]["freshness"]["label"])


if __name__ == "__main__":
    unittest.main()
