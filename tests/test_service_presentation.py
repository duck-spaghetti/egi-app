"""Verify source claims and service/facility presentation at the preview boundary."""

from __future__ import annotations

import copy
import unittest

from app.backend.presentation import access_sections, weekly_hours, placement, coverage
from app.backend.preview import services


def subject(identifier: str, name: str, hours: dict) -> dict:
    """Build independent service claims under a shared provisional source group."""
    raw = {
        "identifier": identifier,
        "nome": "Centro Alfa",
        "bisogno": "cibo",
        "tipologia": name,
        "prestazioni": [{"id": "1", "nome": "Pasto"}],
        "posizione": {
            "indirizzo": "Via Alfa 1",
            "coordinate": {"lat": None, "lng": None},
            "itinerante": False,
        },
        "numeri_telefono": [],
        "email": None,
        "orari_apertura": hours,
        "criteri_accesso": {"appuntamento": True, "a_pagamento": False},
        "descrizione": None,
        "ente": "Ente Alfa",
    }
    payload = {
        "name": raw["nome"],
        "description": None,
        "delivery_mode": None,
        "source_values": raw,
        "source_group": {
            "external_key": "group-a",
            "name": "Centro Alfa",
            "raw_fields": {"identifier": "group-a", "nome": "Centro Alfa"},
            "service_count": 2,
        },
        "derived_summary": {
            "text": "La fonte elenca: Pasto.",
            "method": "helpinet-summary/1",
            "status": "derived_unreviewed",
        },
        "source_classifications": {
            k: raw[k] for k in ["bisogno", "tipologia", "prestazioni"]
        },
        "location": {
            "address_raw": raw["posizione"]["indirizzo"],
            "source_position": raw["posizione"],
        },
        "contacts": [],
        "hours": {"raw_value": hours},
        "access": {"raw_flags": raw["criteri_accesso"]},
        "organization_claim": {"name_raw": raw["ente"]},
        "review_required": [],
    }
    return {
        "id": identifier,
        "payload": payload,
        "source_locator": identifier,
        "run_id": "test",
        "observed_at": "2026-11-08T10:00:00Z",
    }


class PresentationTests(unittest.TestCase):
    """Check unknowns and independent source claims without changing database policy."""

    def test_weekly_hours_missing_days_are_unknown_and_overnight_is_flagged(self):
        """Readable source intervals never create a closed day or definite open-now claim."""
        display = weekly_hours(
            {
                "lun": [{"inizio": "18:00", "fine": "20:00"}],
                "ven": [{"inizio": "22:00", "fine": "02:00"}],
                "other": "retained",
            }
        )
        self.assertEqual(display["days"][0]["intervals"][0]["label"], "18:00 – 20:00")
        self.assertEqual(display["days"][1]["state"], "unknown")
        self.assertTrue(display["days"][4]["issues"])
        self.assertIsNone(display["open_now"])
        self.assertFalse(display["complete"])
        self.assertTrue(display["warnings"])
        malformed = weekly_hours(
            {"mar": "not-a-list", "sab": [{"inizio": "wrong", "fine": "13:00"}]}
        )
        self.assertTrue(malformed["days"][1]["issues"])
        self.assertTrue(malformed["days"][5]["issues"])

    def test_access_false_flags_never_become_free_or_unrestricted(self):
        """Only positive claims appear; audience is separate from access procedure/cost."""
        display = access_sections(
            {
                "appuntamento": True,
                "donna": True,
                "a_pagamento": False,
                "isee_richiesto": False,
                "new_flag": False,
            }
        )
        by_kind = {s["code"]: s for s in display["sections"]}
        self.assertIn("procedure", by_kind)
        self.assertIn("audience", by_kind)
        self.assertNotIn("documents", by_kind)
        self.assertNotIn("cost", by_kind)
        self.assertNotIn("unresolved", by_kind)
        self.assertEqual(display["cost_state"], "unknown")
        self.assertEqual(display["unselected_count"], 3)

    def test_missing_geometry_does_not_make_directory_and_remote_is_explicit(self):
        """An address needing geocoding is distinct from explicitly remote delivery."""
        physical = {"delivery_mode": None, "location": {"address_raw": "Via Alfa 1"}}
        self.assertEqual(placement(physical, None)["status"], "needs_geocoding")
        self.assertEqual(
            placement({"delivery_mode": None, "location": {}}, None)["section"],
            "services",
        )
        self.assertEqual(
            placement({"delivery_mode": "telephone", "location": {}}, None)["section"],
            "directory",
        )
        self.assertEqual(
            placement({"delivery_mode": "online", "location": {}}, None)["section"],
            "directory",
        )

    def test_service_group_keeps_independent_hours_contacts_and_descriptions(self):
        """Related services keep distinct identities, titles and schedules without inherited points."""
        first = subject(
            "service-a", "Mensa", {"lun": [{"inizio": "12:00", "fine": "13:00"}]}
        )
        second = subject(
            "service-b",
            "Distribuzione",
            {"mar": [{"inizio": "09:00", "fine": "10:00"}]},
        )
        second["payload"]["contacts"] = [{"channel": "phone", "value": "123"}]
        values = services([first, second])
        self.assertEqual(
            values[0]["source_group"]["external_key"],
            values[1]["source_group"]["external_key"],
        )
        self.assertNotEqual(values[0]["id"], values[1]["id"])
        self.assertNotEqual(values[0]["hours_display"], values[1]["hours_display"])
        self.assertEqual(values[0]["contacts"], [])
        self.assertEqual(len(values[1]["contacts"]), 1)
        self.assertIsNone(values[0]["description"])
        self.assertIsNone(values[0]["place"]["geometry"])
        self.assertEqual(values[0]["service_title"], "Mensa")

    def test_coverage_reports_missing_source_description_and_unknown_fields(self):
        """Generated summaries never increase original description completeness."""
        row = subject("a", "Mensa", {})
        row["payload"]["source_values"]["future_field"] = {"kept": True}
        report = coverage([row])
        fields = {f["field"]: f for f in report["fields"]}
        self.assertEqual(fields["descrizione"]["populated_at_source"], 0)
        self.assertEqual(fields["descrizione"]["retained"], 1)
        self.assertEqual(fields["future_field"]["retained"], 1)
        self.assertEqual(fields["future_field"]["interpretation"], "pending")
        self.assertEqual(
            {r["field"] for r in report["group_fields"]},
            {"identifier", "nome", "servizi"},
        )
