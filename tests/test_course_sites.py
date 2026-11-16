"""Scuolemigranti sites with their sede page (importer 0.4): course hours, page date, taxonomy."""

from __future__ import annotations

import unittest

from app.backend.preview import services
from tests.test_map_sources import map_row


def course_row(identifier: str, cpia: bool = False, courses: list | None = None, office: str | None = None,
               stale: bool = False, flags: list | None = None) -> dict:
    """A shown Scuolemigranti site whose sede page was captured."""
    row = map_row(identifier, "Sedi CPIA" if cpia else "Sedi associazioni Scuolemigranti", "matched_house")
    row["source_code"] = "scuolemigranti"
    p = row["payload"]
    p.update({
        "name": "CPIA 2" if cpia else "CivicoZero",
        "description": "Presso il Centro Anziani. Le iscrizioni sono aperte su appuntamento.",
        "declared_update": None,
        "classification": {"display": "shown", "need": "istruzione", "service_type": "Corsi linguistici",
                           "display_name": f"Corsi di italiano · {'CPIA 2' if cpia else 'CivicoZero'}", "access_claims": []},
        "site_page": {"status": "ok", "url": f"https://www.scuolemigranti.org/sedi/{identifier}/"},
        "hours": {"raw_value": "x", "scope": "lessons" if courses else "office", "courses": courses or [], "office_text": office},
        "course_facts": {"levels": ["A1", "B1"], "level_codes": ["a1", "b1"], "flags": flags or [], "cpia": cpia,
                         "licenza_media": cpia, "summer_closure": False},
        "offers_stated": ([{"name": "CPIA"}] if cpia else []) + [{"name": "Corsi di italiano", "derived": cpia, "basis": "dedotto: CPIA"}]
                         + ([{"name": "Scuola e licenza media"}] if cpia else []),
        "enrolment": {"state": "aperte", "text": "Le iscrizioni sono aperte.", "start_text": None},
        "data_as_of": {"page_modified": "2024-03-11" if stale else "2026-10-02", "months_before_capture": 32 if stale else 1,
                       "stale": stale, "stale_after_months": 12},
        "organization_claim": {"name_raw": "CivicoZero", "url": "https://www.scuolemigranti.org/aderenti/civico-zero/"},
    })
    p["contacts"] = [{"channel": "phone", "value": "347 2434799", "normalized": "+393472434799"},
                     {"channel": "website", "value": "https://www.scuolemigranti.org/sedi/x/", "role": "source_page"}]
    return row


B1 = {"level": "B1", "level_raw": "B1", "sessions": [{"days": ["mar"], "start": "18:00", "end": "20:00", "raw": "MAR 18:00 - 20:00"}],
      "unparsed_times": [], "note_raw": None, "flags": [], "summer": False}
A1 = {"level": "A1", "level_raw": "A1", "sessions": [{"days": ["mar", "gio"], "start": "18:00", "end": "20:00", "raw": "MAR - GIO 18:00 - 20:00"}],
      "unparsed_times": [], "note_raw": "Per donne", "flags": ["solo_donne"], "summer": False}


class CourseSiteTests(unittest.TestCase):
    def test_lessons_by_level_and_istruzione(self):
        card = services([course_row("a", courses=[A1], flags=["online"])])[0]
        display = card["hours_display"]
        self.assertEqual(display["kind"], "lessons")
        self.assertEqual(display["courses"][0]["sessions"], ["Mar, Gio 18:00 – 20:00"])
        self.assertEqual(display["courses"][0]["flags"], ["Solo donne"])
        tuesday = next(d for d in display["days"] if d["day"] == "mar")
        self.assertEqual((tuesday["intervals"][0]["label"], tuesday["intervals"][0]["levels"]), ("18:00 – 20:00", ["A1"]))
        self.assertEqual(card["needs"], ["istruzione"])
        self.assertEqual([o["code"] for o in card["offers"]], ["italiano"])
        self.assertEqual(card["course_levels"], ["a1", "b1"])
        self.assertEqual({a["code"] for a in card["access_tags"]}, {"online"}, "no access labels from page words")
        self.assertEqual(card["audiences"], [], "no 'per chi' from page words (Centro Anziani)")
        self.assertEqual(card["contacts"], [{"type": "phone", "value": "347 2434799", "label": None, "is_active": True, "dial": "3472434799"}])
        self.assertEqual(card["sources"][0]["source_url"], "https://www.scuolemigranti.org/sedi/a/")
        self.assertFalse(card["freshness"]["stale"])
        self.assertTrue(card["freshness"]["label"].startswith("Pagina della sede aggiornata il 2 ottobre 2026"))

    def test_same_time_levels_share_one_row(self):
        tuesday = next(d for d in services([course_row("s", courses=[A1, B1])])[0]["hours_display"]["days"] if d["day"] == "mar")
        self.assertEqual([(i["label"], i["levels"]) for i in tuesday["intervals"]], [("18:00 – 20:00", ["A1", "B1"])])

    def test_cpia_secretariat_and_old_page(self):
        card = services([course_row("c", cpia=True, office="Orari di ricevimento\nLunedì ore 15:30 – 17:30", stale=True)])[0]
        self.assertEqual(card["hours_display"]["kind"], "office")
        self.assertEqual(card["hours_display"]["status_label"], "Iscrizioni e informazioni in segreteria")
        self.assertEqual([o["code"] for o in card["offers"]], ["cpia", "italiano", "scuola"])
        self.assertTrue(card["offers"][1]["interpreted"], "Italian courses of a silent CPIA are derived")
        women = services([course_row("w", courses=[A1], flags=["solo_donne"])])[0]
        self.assertEqual([a["code"] for a in women["audiences"]], ["donne"])
        self.assertTrue(card["freshness"]["stale"])
        self.assertIn("dato da verificare", card["freshness"]["label"])
        bare = services([course_row("d", cpia=True)])[0]
        self.assertEqual(bare["hours_display"]["kind"], "none")
        self.assertEqual(bare["hours_display"]["status_label"], "Orario non disponibile — contatta la segreteria")

    def test_excluded_site_without_page_is_hidden(self):
        row = course_row("e")
        row["payload"]["classification"]["display"] = "excluded"
        self.assertEqual(services([row]), [])


if __name__ == "__main__":
    unittest.main()
