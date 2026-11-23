"""Overlap review pairs: across datasets (sources or guide chapters), graded by address, type, distance and names."""

import unittest

from fastapi.testclient import TestClient

from app.backend import main
from app.backend.api.preview.dependencies import subject_source
from app.backend.api.preview.review import overlap_pairs, street_key
from app.backend.api.preview.subjects import StaticSubjectSource
from tests.test_map_sources import map_row


def card(i, source, title, address, lat, lon, kind):
    return {"id": i, "source_code": source, "service_title": title, "facility_name": title, "sources": [{"source_name": source}],
            "native_classifications": {"tipologia": kind}, "category": {"label": "x"}, "contacts": [], "hours_display": {},
            "place": {"address": address, "geometry": {"type": "Point", "coordinates": [lon, lat]}}, "placement": {}, "source_locator": i}


class ReviewTests(unittest.TestCase):
    def test_street_key_ignores_case_and_tail(self):
        self.assertEqual(street_key("Consultorio - X Via Duilio Cambellotti, 7 - 00133 Roma"), "via duilio cambellotti 7")
        self.assertEqual(street_key("V. delle Sette Sale, 30, 00184 Roma"), street_key("Via delle Sette Sale 30 – Roma"))
        self.assertEqual(street_key("P.zza S. Calisto 16"), "piazza san calisto 16")

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

    def test_guide_chapters_are_paired_but_one_chapter_is_not(self):
        """Two chapters of one guide are separate datasets (runs); one chapter is not paired with itself."""
        def guide(i, run, chapter, title):
            c = card(i, "sant-egidio", title, "Via di Porta San Lorenzo 7", 41.9, 12.51, "Centro di ascolto")
            c.update(run_id=run, sources=[{"source_name": "Sant'Egidio · DOVE 2026", "source_kind": "document"}],
                     native_classifications={"tipologia": "Centro di ascolto", "layer_path": [chapter]})
            return c
        cards = [guide("g1", "r-ascolto", "Ascolto", "Centro ascolto stranieri"), guide("g2", "r-curarsi", "Curarsi", "Centro ascolto stranieri"),
                 guide("g3", "r-ascolto", "Ascolto", "Centro ascolto stranieri")]
        pairs = {(p["a"]["id"], p["b"]["id"]) for p in overlap_pairs(cards)}
        self.assertEqual(pairs, {("g1", "g2"), ("g2", "g3")})
        first = overlap_pairs(cards)[0]
        self.assertEqual({first["a"]["source"], first["b"]["source"]}, {"Sant'Egidio · DOVE 2026 · Ascolto", "Sant'Egidio · DOVE 2026 · Curarsi"})

    def test_shared_contacts_match_without_position_and_groups_join_sources(self):
        def unplaced(i, source, title, address, phone, email, kind="Mensa sociale"):
            c = card(i, source, title, address, 0, 0, kind)
            c["place"]["geometry"] = None
            c["contacts"] = [{"type": "phone", "value": phone}, {"type": "email", "value": email}]
            return c
        cards = [
            unplaced("m1", "caritas-roma", "MENSA “GIOVANNI PAOLO II” a Colle Oppio", "Via delle Sette Sale 30 – Roma", "06.88815230", "colle.oppio@caritasroma.it"),
            unplaced("m2", "roma-solidarieta", "Mensa diurna “Giovanni Paolo II” a Colle Oppio", "Via delle Sette Sale 30, 00184 Roma", "06 88815230", "x@y.it"),
            unplaced("m3", "helpinet", "Mensa Colle Oppio", "Via delle Sette Sale, 30", "0688815230", "colle.oppio@caritasroma.it"),
            unplaced("o", "programma-integra", "Altro", "Via Uno 1", "06 9999999", "o@o.it", kind="Corsi linguistici"),
        ]
        pairs = overlap_pairs(cards)
        self.assertEqual({(p["a"]["id"], p["b"]["id"]) for p in pairs}, {("m1", "m2"), ("m1", "m3"), ("m2", "m3")})
        strongest = next(p for p in pairs if {p["a"]["id"], p["b"]["id"]} == {"m1", "m3"})
        self.assertEqual(strongest["tier"], "A")
        self.assertIn("stesso telefono", strongest["evidence"])
        self.assertIn("stessa email", strongest["evidence"])
        self.assertIsNone(strongest["distance_m"])
        self.assertEqual(strongest["group"]["sources"], ["caritas-roma", "helpinet", "roma-solidarieta"])

    def test_routes(self):
        rows = [map_row("x", "Salute", "matched_house")]
        main.app.dependency_overrides[subject_source] = lambda: StaticSubjectSource(rows)
        try:
            client = self.enterContext(TestClient(main.app))
            self.assertEqual(client.get("/api/preview/review/overlaps").json()["count"], 0)
            self.assertEqual(client.get("/revisione/doppioni").status_code, 200)
        finally:
            main.app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
