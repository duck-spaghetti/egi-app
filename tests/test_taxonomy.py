"""Need-first presentation taxonomy v0.3: offers, needs, audiences, access, meal times, paths, structured sources."""

from __future__ import annotations

import copy
import json
import unittest
from unittest import mock

import app.backend.api.preview.taxonomy as taxonomy


def card(title, kind=None, need=None, description="", address="Via X 1", hours=None, access_raw=None, entity_needs=None):
    """A card as produced by preview._source_cards (before the taxonomy)."""
    return {"service_title": title, "facility_name": title, "name": title, "description": description,
            "native_classifications": {"tipologia": kind, "prestazioni": []}, "category": {"slug": need} if need else None,
            "needs": entity_needs or ([need] if need else []), "place": {"address": address, "geometry": None},
            "hours_display": hours or {}, "access_raw": access_raw or {}, "placement": {"section": "services"}}


def helpinet(facility, kind, need, prestazioni, itinerant=False, title=None):
    """A Helpinet card: own type and prestazioni; the facility name is the parent's."""
    c = card(title or kind, kind, need)
    c.update({"source_code": "helpinet", "facility_name": facility, "name": facility, "itinerant_source": itinerant,
              "native_classifications": {"bisogno": need, "tipologia": kind,
                                         "prestazioni": [{"id": str(i), "nome": n} for i, n in enumerate(prestazioni)]}})
    return c


def codes(items):
    return [x["code"] for x in items]


class TaxonomyTests(unittest.TestCase):
    def test_vocabulary_is_consistent(self):
        vocab = taxonomy.vocabulary()
        needs = {n["code"] for n in vocab["needs"]}
        self.assertEqual(len(needs), 11)
        self.assertTrue(all(o["need"] in needs for o in vocab["offers"]))
        offer_codes = {o["code"] for o in vocab["offers"]}
        self.assertTrue(all(set(p["offers"]) <= offer_codes for p in vocab["paths"]))
        self.assertEqual(set(vocab["source_need_fallback"].values()) - needs, set())
        rules = vocab["structured"]
        self.assertTrue(set(rules["type_need"].values()) <= needs)
        self.assertTrue(set(rules["type_offer"].values()) | set(rules["prestazioni"].values()) <= offer_codes)
        self.assertLessEqual(set(rules["type_offer"]), set(rules["type_need"]))  # Sportello Sanitario: no default cluster

    def test_shower_point_is_hygiene_with_clothes_and_breakfast(self):
        c = taxonomy.apply(card("Sacro Cuore", "Igiene personale", "igiene_personale",
                                "docce e cambio vestiti, colazione", hours={"days": [{"day": "lun", "intervals": [{"label": "08:00 – 09:30"}]}]}))
        self.assertEqual(c["category"]["slug"], "lavarsi")
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

    def test_anti_violence_centre_is_its_own_need_and_for_women(self):
        c = taxonomy.apply(card("CAV Nilde Iotti", "Centro antiviolenza", "ascolto"))
        self.assertEqual(c["needs"], ["violenza"])
        self.assertIn("donne", codes(c["audiences"]))

    def test_tax_office_moves_to_documents_and_municipio_keeps_both(self):
        tax = taxonomy.apply(card("Agenzia delle Entrate — Roma 1", "Sportello sociale pubblico", "ascolto"))
        self.assertEqual(tax["needs"], ["documenti_diritti"])
        municipio = taxonomy.apply(card("Municipio 8", "Sportello sociale pubblico", "ascolto"))
        self.assertEqual(municipio["needs"][:2], ["orientamento", "documenti_diritti"])

    def test_social_life_entries_go_to_listening(self):
        c = taxonomy.apply(card("Lunaria", "Socialità e volontariato", "socialita", "si occupa della inclusione sociale"))
        self.assertEqual(c["category"]["slug"], "orientamento")
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

    def test_helpinet_facility_name_does_not_assign_needs(self):
        clothes = taxonomy.apply(helpinet("Emporio Togliatti", "Abbigliamento", "abiti_e_coperte", ["Vestiti", "Kit biancheria intima", "Distribuzione"]))
        self.assertEqual(clothes["needs"], ["vestiti_coperte"])
        self.assertEqual(codes(clothes["offers"]), ["vestiti", "biancheria"])
        psych = taxonomy.apply(helpinet("Mensa Dina Galli", "Salute mentale", "curarmi", ["Psicologo", "Supporto psicologico"]))
        self.assertEqual((psych["needs"], codes(psych["offers"])), (["salute"], ["psicologo"]))
        self.assertEqual(psych["meal_times"], [])

    def test_helpinet_prestazioni_outside_the_need_are_ignored(self):
        desk = taxonomy.apply(helpinet("Social Market Ferraioli", "Sportello sociale", "ascolto",
                                       ["Ascolto", "Orientamento al lavoro", "Orientamento sanitario", "Orientamento socio-legale"]))
        self.assertEqual((desk["needs"], codes(desk["offers"])), (["orientamento"], ["centro_ascolto"]))

    def test_helpinet_alcoholics_anonymous_are_addictions(self):
        aa = taxonomy.apply(helpinet("A.A. Gruppo Roma", "Sportello Sanitario", "curarmi", ["Ascolto", "Supporto dipendenze"]))
        self.assertEqual((aa["needs"], codes(aa["offers"])), (["salute"], ["dipendenze"]))
        open_ = taxonomy.apply(helpinet("O.P.E.N. Ramazzini", "Sportello socio sanitario", "ascolto",
                                        ["Supporto dipendenze", "Ascolto", "Orientamento ai servizi", "Supporto psicologico"]))
        self.assertEqual(open_["needs"], ["salute"])
        self.assertEqual(codes(open_["offers"]), ["dipendenze", "psicologo"])

    def test_helpinet_violence_by_type_name_and_anti_trafficking(self):
        cav = taxonomy.apply(helpinet("CAV Titano", "Salute e tutela della donna", "ascolto", ["Ascolto", "Supporto psicologico", "Servizio legale"]))
        self.assertEqual((cav["needs"], codes(cav["offers"])), (["violenza"], ["centro_antiviolenza"]))
        scialdone = taxonomy.apply(helpinet("CAV Martina Scialdone", "Sportello sociale", "ascolto", ["Accoglienza", "Counseling Psicologico"]))
        self.assertEqual((scialdone["needs"], codes(scialdone["offers"])), (["violenza"], ["centro_antiviolenza"]))
        roxanne = taxonomy.apply(helpinet("Roxanne e Oltre", "Sportello socio sanitario", "ascolto", ["Segretariato Sociale", "Anti tratta"]))
        self.assertEqual((roxanne["needs"], codes(roxanne["offers"])), (["violenza"], ["anti_tratta"]))

    def test_helpinet_food_clusters(self):
        street = taxonomy.apply(helpinet("RomAmoR Ostiense", "Distribuzione generi alimentari", "cibo", ["Cena", "Pasto da asporto", "Distribuzione"], itinerant=True))
        self.assertEqual(codes(street["offers"]), ["pasto_asporto"])
        self.assertEqual(codes(street["meal_times"]), ["cena"])
        breakfast = taxonomy.apply(helpinet("Centro Atlante", "Distribuzione generi alimentari", "cibo", ["Colazione", "Pranzo"]))
        self.assertEqual(codes(breakfast["offers"]), ["pasto"])
        canteen = taxonomy.apply(helpinet("S. Giuseppe al Trionfale", "Mensa sociale", "cibo", ["Pranzo", "Pasto da asporto"]))
        self.assertEqual(sorted(codes(canteen["offers"])), ["pasto", "pasto_asporto"])  # a canteen stays a canteen (user, 2026-11-16)
        market = taxonomy.apply(helpinet("Social Market Jerry Masslo", "Distribuzione generi alimentari", "cibo", ["Distribuzione"]))
        self.assertEqual(codes(market["offers"]), ["cibo_da_cucinare"])
        self.assertEqual(codes(market["offers"][:1]), ["cibo_da_cucinare"])
        self.assertTrue(market["offers"][0]["basis"].startswith("tipo della fonte"))

    def test_helpinet_itinerant_desk_and_job_centre(self):
        sos = taxonomy.apply(helpinet("Presidio itinerante SOS", "Sportello sociale", "ascolto", ["Ascolto", "Accoglienza"], itinerant=True))
        self.assertEqual(codes(sos["offers"]), ["unita_strada"])
        cpi = taxonomy.apply(helpinet("CPI Cinecittà", "Centro per l'Impiego", "lavoro", ["Supporto lavoro", "Corsi Formazione Lavoro"]))
        self.assertEqual(cpi["needs"], ["lavoro"])
        self.assertEqual(codes(cpi["offers"]), ["centro_impiego", "cercare_lavoro", "formazione"])
        school = taxonomy.apply(helpinet("Scuola di Alì", "Scuola", "istruzione", ["Corsi di italiano"]))
        self.assertEqual((school["needs"], codes(school["offers"])), (["istruzione"], ["italiano"]))


if __name__ == "__main__":
    unittest.main()
