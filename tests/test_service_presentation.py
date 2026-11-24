"""Verify source claims and service/facility presentation at the preview boundary."""

from __future__ import annotations

import copy
import unittest

from app.backend.api.preview.presentation import access_sections, weekly_hours, placement, coverage
from app.backend.api.preview.projection import services


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

    def v03_pair(self):
        """Two Helpinet v0.3 records of one shower service, for men and for women."""
        men = subject("m", "Igiene personale", {"lun": [{"inizio": "09:00", "fine": "11:00"}]})
        women = subject("w", "Igiene personale", {"mar": [{"inizio": "09:00", "fine": "11:00"}]})
        for row, flag in [(men, "uomo"), (women, "donna")]:
            row["source_locator"] = f"helpinet:service:{row['id']}:subject"
            row["payload"]["access"]["raw_flags"] = {"appuntamento": True, flag: True}
            row["payload"]["contacts"] = [{"channel": "phone", "value": "Tel. 06.88815720", "normalized": ["0688815720"], "valid": True}]
            row["payload"]["data_as_of"] = {"latest": "2026-05-09", "kind": "upper_bound"}
        variants = [{"locator": "helpinet:service:m", "access_true": ["appuntamento", "uomo"], "prestazioni": ["Pasto"]},
                    {"locator": "helpinet:service:w", "access_true": ["appuntamento", "donna"], "prestazioni": ["Pasto"]}]
        men["payload"]["merge"] = {"role": "primary", "members": ["helpinet:service:m", "helpinet:service:w"], "variants": variants, "conflicts": []}
        women["payload"]["merge"] = {"role": "merged_into", "primary": "helpinet:service:m"}
        return men, women

    def test_v03_merged_service_shows_hours_per_audience(self):
        """One card for a service the source published twice; the other record stays in the DB."""
        cards = services(list(self.v03_pair()))
        self.assertEqual([c["id"] for c in cards], ["m"])
        days = {d["day"]: [i["label"] for i in d["intervals"]] for d in cards[0]["hours_display"]["days"]}
        self.assertEqual(days["lun"], ["09:00 – 11:00 · Uomini"])
        self.assertEqual(days["mar"], ["09:00 – 11:00 · Donne"])
        self.assertTrue(cards[0]["access_raw"]["uomo"] and cards[0]["access_raw"]["donna"])
        self.assertEqual(cards[0]["merged_from"], ["helpinet:service:m:subject", "helpinet:service:w:subject"])
        self.assertEqual(len(cards[0]["contacts"]), 1)  # same number in both records

    def test_v03_phones_data_date_and_sibling_position(self):
        """Dialable numbers keep the raw value; data date upper bound; derived point labelled."""
        men, _ = self.v03_pair()
        men["payload"].pop("merge")
        men["payload"]["contacts"].append({"channel": "phone", "value": "0667105197/98", "normalized": ["0667105197", "0667105198"], "valid": True})
        men["payload"]["location"]["derived_position"] = {"lat": 41.95, "lng": 12.53, "method": "same_source_group_and_address"}
        card = services([men])[0]
        self.assertEqual([(c["value"], c["dial"]) for c in card["contacts"]],
                         [("Tel. 06.88815720", "0688815720"), ("0667105197", "0667105197"), ("0667105198", "0667105198")])
        self.assertTrue(card["freshness"]["label"].startswith("Dati del 9 maggio 2026 o precedenti (circa 6 mesi"))
        self.assertEqual(card["place"]["geometry"], {"type": "Point", "coordinates": [12.53, 41.95]})
        self.assertEqual(card["placement"]["status"], "source_group_sibling")

    def test_v03_curated_hours_shown_with_the_source_value(self):
        """The corrected interval is used; the source's own value appears as a warning."""
        row = subject("c", "Lavoro", {"gio": [{"inizio": "14:00", "fine": "13:30"}]})
        row["payload"]["hours"].update({
            "corrected_value": {"gio": [{"inizio": "13:30", "fine": "14:00"}]},
            "corrections": [{"day": "gio", "index": 0, "raw": {"inizio": "14:00", "fine": "13:30"}, "corrected": {"inizio": "13:30", "fine": "14:00"}}],
        })
        display = services([row])[0]["hours_display"]
        self.assertEqual(display["days"][3]["intervals"][0]["label"], "13:30 – 14:00")
        self.assertIn("la fonte indica 14:00 – 13:30", display["warnings"][0])

    def test_weekly_hours_missing_days_are_unknown_and_overnight_crosses_midnight(self):
        """Readable source intervals never create a closed day; 22–02 ends the next day (2026-11-15)."""
        display = weekly_hours(
            {
                "lun": [{"inizio": "18:00", "fine": "20:00"}],
                "ven": [{"inizio": "22:00", "fine": "02:00"}],
                "other": "retained",
            }
        )
        self.assertEqual(display["days"][0]["intervals"][0]["label"], "18:00 – 20:00")
        self.assertEqual([d["label"] for d in display["days"]][:5], ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì"])
        self.assertEqual(display["days"][1]["state"], "unknown")
        self.assertEqual(display["days"][4]["issues"], [])
        overnight = display["days"][4]["intervals"][0]
        self.assertTrue(overnight["overnight"])
        self.assertEqual(overnight["label"], "22:00 – 02:00 (del giorno dopo)")
        self.assertEqual(weekly_hours({"lun": [{"inizio": "00:00", "fine": "23:59"}]})["days"][0]["intervals"][0]["label"], "Aperto 24 ore")
        self.assertTrue(weekly_hours({"lun": [{"inizio": "09:00", "fine": "09:00"}]})["days"][0]["issues"])
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
