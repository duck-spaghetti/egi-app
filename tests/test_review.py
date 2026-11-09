"""Overlap review pairs: cross-source only, graded by address, type, distance and names."""

import unittest

from fastapi.testclient import TestClient

from app.backend import main
from app.backend.review import overlap_pairs, street_key
from app.backend.subjects import StaticSubjectSource
from tests.test_map_sources import map_row


def card(i, source, title, address, lat, lon, kind):
    return {"id": i, "source_code": source, "service_title": title, "facility_name": title, "sources": [{"source_name": source}],
            "native_classifications": {"tipologia": kind}, "category": {"label": "x"}, "contacts": [], "hours_display": {},
            "place": {"address": address, "geometry": {"type": "Point", "coordinates": [lon, lat]}}, "placement": {}, "source_locator": i}


class ReviewTests(unittest.TestCase):
    def test_street_key_ignores_case_and_tail(self):
        self.assertEqual(street_key("Consultorio - X Via Duilio Cambellotti, 7 - 00133 Roma"), "via duilio cambellotti 7")

    def test_tiers_and_same_source_excluded(self):
        cards = [
            card("a", "gris", "Consultorio ASL Roma 4 Cerveteri", "Via Alfa, 3, Cerveteri", 42.0, 12.1, "Consultorio familiare"),
            card("b", "integra", "Consultorio - Cerveteri", "Via Alfa 3 Cerveteri", 42.0001, 12.1, "Consultorio familiare"),
            card("c", "integra", "Mensa San Pio", "Via Beta 1", 42.0002, 12.1, "Mensa sociale"),
            card("d", "gris", "Rilascio STP/ENI · Cerveteri", "Via Alfa 3", 42.0, 12.1, "Rilascio STP/ENI"),
        ]
        pairs = {(p["a"]["id"], p["b"]["id"]): p for p in overlap_pairs(cards)}
        self.assertEqual(pairs[("a", "b")]["tier"], "A")
        self.assertNotIn(("a", "d"), pairs, "same source is never paired")
        self.assertIn(pairs[("d", "b")]["tier"] if ("d", "b") in pairs else pairs[("b", "d")]["tier"], {"C", "D"})
        self.assertTrue(all(p["a"]["source_code"] != p["b"]["source_code"] for p in pairs.values()))

    def test_routes(self):
        rows = [map_row("x", "Salute", "matched_house")]
        main.app.dependency_overrides[main.subject_source] = lambda: StaticSubjectSource(rows)
        try:
            client = TestClient(main.app)
            self.assertEqual(client.get("/api/preview/review/overlaps").json()["count"], 0)
            self.assertEqual(client.get("/revisione/doppioni").status_code, 200)
        finally:
            main.app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
