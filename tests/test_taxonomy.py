"""Need-first presentation taxonomy v0.2: offers, needs, audiences, access, meal times, paths."""

from __future__ import annotations

import copy
import json
import unittest
from unittest import mock

from app.backend import taxonomy


def card(title, kind=None, need=None, description="", address="Via X 1", hours=None, access_raw=None, entity_needs=None):
    """A card as produced by preview._source_cards (before the taxonomy)."""
    return {"service_title": title, "facility_name": title, "name": title, "description": description,
            "native_classifications": {"tipologia": kind, "prestazioni": []}, "category": {"slug": need} if need else None,
            "needs": entity_needs or ([need] if need else []), "place": {"address": address, "geometry": None},
            "hours_display": hours or {}, "access_raw": access_raw or {}, "placement": {"section": "services"}}


def codes(items):
    return [x["code"] for x in items]


class TaxonomyTests(unittest.TestCase):
    def test_vocabulary_is_consistent(self):
        vocab = taxonomy.vocabulary()
        needs = {n["code"] for n in vocab["needs"]}
        self.assertEqual(len(needs), 8)
        self.assertTrue(all(o["need"] in needs for o in vocab["offers"]))
        offer_codes = {o["code"] for o in vocab["offers"]}
        self.assertTrue(all(set(p["offers"]) <= offer_codes for p in vocab["paths"]))
        self.assertEqual(set(vocab["source_need_fallback"].values()) - needs, set())

    def test_shower_point_is_hygiene_with_clothes_and_breakfast(self):
        c = taxonomy.apply(card("Sacro Cuore", "Igiene personale", "igiene_personale",
                                "docce e cambio vestiti, colazione", hours={"days": [{"day": "lun", "intervals": [{"label": "08:00 – 09:30"}]}]}))
        self.assertEqual(c["category"]["slug"], "lavarsi_vestirsi")
        self.assertEqual(codes(c["offers"])[:2], ["pasto", "docce"])
        self.assertIn("vestiti", codes(c["offers"]))
        docce = next(o for o in c["offers"] if o["code"] == "docce")
        self.assertFalse(docce["interpreted"])  # from the source type
        self.assertTrue(next(o for o in c["offers"] if o["code"] == "vestiti")["interpreted"])  # from the text
        self.assertIn("multiservizi", c["needs"])  # eat + wash at one place
        self.assertEqual(codes(c["meal_times"]), ["colazione"])

    def test_meal_times_from_hours_only_for_meals(self):
        lunch = taxonomy.apply(card("Mensa", "Mensa sociale", "cibo", hours={"scoped": [{"text": "dal lunedì al venerdì ore 12.00-13.30"}]}))
        self.assertEqual(codes(lunch["meal_times"]), ["pranzo"])
        self.assertTrue(lunch["meal_times"][0]["basis"].startswith("orari"))
        parcels = taxonomy.apply(card("Viveri", "Distribuzione generi alimentari", "cibo", hours={"scoped": [{"text": "sabato ore 9.00-11.00"}]}))
        self.assertEqual(parcels["meal_times"], [])

    def test_anti_violence_centre_in_both_needs_and_for_women(self):
        c = taxonomy.apply(card("CAV Nilde Iotti", "Centro antiviolenza", "ascolto"))
        self.assertEqual(set(c["needs"]), {"salute", "ascolto_aiuto"})
        self.assertIn("donne", codes(c["audiences"]))

    def test_tax_office_moves_to_documents_and_municipio_keeps_both(self):
        tax = taxonomy.apply(card("Agenzia delle Entrate — Roma 1", "Sportello sociale pubblico", "ascolto"))
        self.assertEqual(tax["needs"], ["documenti_diritti"])
        municipio = taxonomy.apply(card("Municipio 8", "Sportello sociale pubblico", "ascolto"))
        self.assertEqual(municipio["needs"][:2], ["ascolto_aiuto", "documenti_diritti"])

    def test_social_life_entries_go_to_listening(self):
        c = taxonomy.apply(card("Lunaria", "Socialità e volontariato", "socialita", "si occupa della inclusione sociale"))
        self.assertEqual(c["category"]["slug"], "ascolto_aiuto")
        self.assertEqual(c["source_category"], {"slug": "socialita"})

    def test_helpinet_false_flags_are_ignored_and_true_ones_used(self):
        c = taxonomy.apply(card("Dormitorio", "Centro di accoglienza", "dormire",
                                access_raw={"a_pagamento": False, "appuntamento": True, "donna": True}))
        self.assertNotIn("a_pagamento", codes(c["access_tags"]))
        self.assertIn("appuntamento", codes(c["access_tags"]))
        self.assertIn("donne", codes(c["audiences"]))

    def test_eating_disorders_are_not_food(self):
        c = taxonomy.apply(card("Uosd Disturbi Comportamenti Alimentari", "Salute mentale", "curarmi"))
        self.assertNotIn("mangiare", c["needs"])

    def test_disabled_offer_is_not_assigned(self):
        vocab = copy.deepcopy(json.loads(taxonomy.VOCABULARY.read_text(encoding="utf-8")))
        next(o for o in vocab["offers"] if o["code"] == "consultorio")["enabled"] = False
        compiled = taxonomy.compile_vocabulary(vocab)
        with mock.patch.object(taxonomy, "vocabulary", lambda: compiled):
            c = taxonomy.apply(card("Consultorio", "Consultorio familiare", "curarmi"))
        self.assertNotIn("consultorio", codes(c["offers"]))
        self.assertEqual(c["needs"], ["salute"])  # still under its source need

    def test_public_vocabulary_has_paths(self):
        public = taxonomy.public_vocabulary()
        self.assertEqual([p["code"] for p in public["paths"]], ["violenza", "stanotte", "lavarsi_mangiare", "appena_arrivato"])


if __name__ == "__main__":
    unittest.main()
