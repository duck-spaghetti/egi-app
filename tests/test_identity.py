"""Proposed identity decisions and multi-need hints, on the cases met in the live review."""

from __future__ import annotations

import unittest

from app.backend.api.preview.identity import address_relation, completeness, proposed_needs, propose


def card(i, title, kind, address, need="ascolto", status="geocoded_matched_house", description="", contacts=(), facility=None):
    """A review card as produced by preview.services()."""
    return {"id": i, "service_title": title, "facility_name": facility or title, "description": description,
            "native_classifications": {"tipologia": kind}, "category": {"slug": need}, "placement": {"status": status},
            "place": {"address": address}, "contacts": [{"type": "phone", "value": c} for c in contacts], "hours_display": {}}


def pair(**facts):
    """Review facts for a pair (defaults: nothing in common)."""
    base = {"same_address": False, "distance_m": None, "same_type": False, "name_similarity": 0.0, "shared_contacts": [], "evidence": []}
    return {**base, **facts}


class AddressTests(unittest.TestCase):
    def test_tolerated_forms_and_conflicts(self):
        same = [("Via A. Farnese, 17", "Via Alessandro Farnese 17 – Roma"), ("Circ.ne Trionfale, 19", "Circonvallazione Trionfale, 19"),
                ("V.Alessandro Avoli, 9", "Via Alessandro Avoli,9"), ("Via di Grottaperfetta, 610", "CAV Nilde Iotti Via di Grotta Perfetta, 610"),
                ("Via Cardinale Domenico Ginnasi 21", "Via Cardinal Ginnasi, 21"), ("P.zza Monte Gaudio, 8", "Piazzetta di Monte Gaudio, 8"),
                ("Piazza S. Giovanni in Laterano n. 6", "Piazza San Giovanni in Laterano 6/a"), ("Via Nicola Stame, 160/162", "VIA NICOLA STAME, 162"),
                ("Via dei Feltreschi ang. Via Bravetta", "Via dei Feltreschi ang. Via Bravetta")]
        for x, y in same:
            self.assertEqual(address_relation({"place": {"address": x}}, {"place": {"address": y}}), "same", (x, y))
        self.assertEqual(address_relation({"place": {"address": "Via Casilina 1368"}}, {"place": {"address": "Via Casilina Vecchia, 19"}}), "conflict")
        self.assertEqual(address_relation({"place": {"address": "Via Goito, 35"}}, {"place": {"address": "Via Goito 12"}}), "street")
        self.assertEqual(address_relation({"place": {"address": "Via Dalmazia, 25"}}, {"place": {"address": "Circonvallazione Trionfale, 19"}}), "conflict")


class ProposalTests(unittest.TestCase):
    def test_same_structure_same_kind_is_one_service_with_a_primary(self):
        a = card("a", "Centro di Accoglienza “Ferrhotel”", "Centro di accoglienza", "Via del Mandrione, 291", "dormire", description="x" * 400, contacts=["06 1"])
        b = card("b", "Centro di Accoglienza per Uomini “Ferrhotel”", "Centro di accoglienza", "Via del Mandrione 291, 00181 Roma", "dormire", contacts=["06 2"])
        p = propose(pair(same_address=True, name_similarity=0.67), a, b, org_contacts=False)
        self.assertEqual((p["decision"], p["confidence"]), ("same_service", "alta"))
        self.assertEqual(p["primary"]["id"], "a")
        self.assertIn("contatti: 06 2", p["enrich"])

    def test_same_structure_other_kind_is_one_place(self):
        a = card("a", "S. Rocco", "Igiene personale", "Piazza Augusto Imperatore, 6", "igiene_personale")
        b = card("b", "S. Rocco", "Mensa sociale", "Piazza Augusto Imperatore, 6", "cibo")
        self.assertEqual(propose(pair(same_address=True, name_similarity=1.0), a, b, False)["decision"], "same_place")

    def test_col_and_cpi_in_one_building_are_two_services_but_generic_lavoro_matches(self):
        col = card("c", "Col Vignali", "Centro di Orientamento al Lavoro", "Viale R. Vignali, 14", "lavoro")
        cpi = card("p", "CPI Roma Cinecittà", "Centro per l'Impiego", "Viale Rolando Vignali, 14", "lavoro")
        generic = card("g", "Lavoro", "Lavoro", "Viale Rolando Vignali, 14, 00173 Roma", "lavoro")
        self.assertEqual(propose(pair(same_address=True), col, cpi, False)["decision"], "same_place")
        p = propose(pair(same_address=True, name_similarity=0.3), col, generic, False)
        self.assertEqual((p["decision"], p["confidence"]), ("same_service", "media"))

    def test_two_named_providers_at_one_site(self):
        a = card("a", "CPIA 1", "Corsi linguistici", "Via Alfa 3", "istruzione")
        b = card("b", "Corsi di italiano · Asinitas", "Corsi linguistici", "Via Alfa, 3", "istruzione")
        p = propose(pair(same_address=True, same_type=True), a, b, False)
        self.assertEqual((p["decision"], p["confidence"]), ("same_place", "media"))

    def test_shared_line_with_other_addresses_is_not_one_structure(self):
        a = card("a", "Franca Rame / Trionfale", "Centro antiviolenza", "Via Dalmazia, 25")
        b = card("b", "CAV Alessia e Martina Capasso", "Salute e tutela della donna", "Circonvallazione Trionfale, 19")
        p = propose(pair(shared_contacts=["0667105191"], same_type=True), a, b, False)
        self.assertNotEqual(p["decision"], "same_service")
        self.assertIn("contatto in comune ma indirizzi diversi", p["reasons"])

    def test_street_level_estimates_do_not_prove_one_structure(self):
        a = card("a", "S. Giuseppe al Trionfale", "Mensa sociale", "Circ.ne Trionfale", "cibo", status="geocoded_matched_street")
        b = card("b", "Alessia e Martina Capasso", "Centro antiviolenza", "Circonvallazione Trionfale, 19", status="geocoded_matched_street")
        p = propose(pair(distance_m=0), a, b, False)
        self.assertEqual((p["decision"], p["confidence"]), ("different", "alta"))


class NeedTests(unittest.TestCase):
    def test_kind_and_offer_needs(self):
        cav = {n["need"] for n in proposed_needs(card("v", "CAV", "Centro antiviolenza", "Via X 1"))}
        self.assertEqual(cav, {"ascolto", "curarmi"})
        shower = proposed_needs(card("d", "Centro", "Igiene personale", "Via X 1", "igiene_personale", description="docce, lavanderia, cambio vestiti e colazione"))
        self.assertEqual({n["need"] for n in shower}, {"igiene_personale", "abiti_e_coperte", "cibo"})
        self.assertIn("testo: «vestiti»", [n["basis"] for n in shower])

    def test_eating_disorders_are_not_food(self):
        unit = card("u", "Uosd Disturbi Comportamenti Alimentari", "Salute mentale", "Via X 1", "curarmi")
        self.assertNotIn("cibo", {n["need"] for n in proposed_needs(unit)})

    def test_named_and_fuller_cards_score_higher(self):
        named = card("n", "CAV Alessia e Martina Capasso", "Centro antiviolenza", "Via X 1", description="x" * 300, contacts=["06 1"])
        generic = card("g", "Salute e tutela della donna", "Salute e tutela della donna", "Via X 1")
        self.assertGreater(completeness(named)[0], completeness(generic)[0])


if __name__ == "__main__":
    unittest.main()
