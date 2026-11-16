"""Migrant health sources after 2026-11-16: Regione Lazio lists, Ministero consultori, GrIS retired."""

from __future__ import annotations

import unittest

from app.backend.preview import services, source_list
from tests.test_map_sources import map_row


def row(identifier: str, source: str, service_type: str, description: str = "") -> dict:
    """A shown health record of `source` with its classification."""
    r = map_row(identifier, service_type, "matched_house")
    r["source_code"] = source
    r["payload"]["description"] = description
    r["payload"]["source_classifications"] = {"layer": service_type, "help_topics": []}
    r["payload"]["classification"] = {"display": "shown", "need": "curarmi", "service_type": service_type,
                                      "display_name": f"{service_type} · Casa della Salute, Ostia", "access_claims": []}
    return r


class HealthSourceTests(unittest.TestCase):
    def test_gris_is_retired(self):
        gris = row("g", "gris-lazio-simm", "Rilascio STP/ENI")
        regional = row("r", "regione-lazio-stp-eni", "Rilascio STP/ENI")
        self.assertEqual([c["id"] for c in services([gris, regional])], ["r"])
        self.assertEqual([s["code"] for s in source_list([gris, regional])], ["regione-lazio-stp-eni"])

    def test_offers_come_from_the_type_only(self):
        card = services([row("r", "regione-lazio-stp-eni", "Rilascio STP/ENI", "c/o ospedale, ambulatorio")])[0]
        self.assertEqual((card["needs"], [o["code"] for o in card["offers"]]), (["salute"], ["stp_eni"]))
        clinic = services([row("p", "regione-lazio-ambulatori-stp-eni", "Pediatria")])[0]
        self.assertEqual([o["code"] for o in clinic["offers"]], ["pediatria"])

    def test_phone_from_gris_on_a_ministero_consultorio(self):
        r = row("m", "ministero-salute-consultori", "Consultorio familiare")
        r["payload"]["contacts"] = [{"channel": "phone", "value": "06 123", "normalized": "+3906123",
                                     "from_source": {"source_code": "gris-lazio-simm", "match": "same town, street and number", "data_date": "2024-12"}}]
        card = services([r])[0]
        self.assertEqual(card["contacts"][0]["source_note"], "da GrIS Lazio (dicembre 2024)")
        self.assertEqual([o["code"] for o in card["offers"]], ["consultorio"])


if __name__ == "__main__":
    unittest.main()
