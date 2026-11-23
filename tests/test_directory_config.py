"""Verify startup validation without a database or extra test framework."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.backend.db.database import catalogue, transition_passed
from app.backend.config import settings


class ConfigurationTests(unittest.TestCase):
    """Reject ambiguous query definitions and secret-bearing invalid settings."""

    def test_catalogue_rejects_duplicate_keys_and_unsafe_tags(self):
        """Duplicate mappings and Python YAML tags cannot silently become queries."""
        with tempfile.TemporaryDirectory() as root:
            target = Path(root)/'queries.yaml'
            for body in ('format: a\nformat: b\n', '!!python/object/apply:os.system ["false"]',
                         'format: egi-public-queries/1\nqueries: {}'):
                target.write_text(body)
                with self.assertRaisesRegex(RuntimeError, 'Invalid public query catalogue'):
                    catalogue(target)

    def test_settings_fail_without_disclosing_values(self):
        """Missing DSN and unsupported backends produce safe, explicit startup failure."""
        for environment in ({}, {'EGI_DB_BACKEND': 'sqlite', 'EGI_DATABASE_URL': 'PRIVATE_PASSWORD'}):
            with patch.dict(os.environ, environment, clear=True):
                with self.assertRaises(RuntimeError) as caught:
                    settings()
                self.assertNotIn('PRIVATE_PASSWORD', str(caught.exception))

    def test_elapsed_opening_transition_expires_the_cache(self):
        """An opening/closing boundary cannot wait for the generic cache TTL."""
        self.assertTrue(transition_passed({'services': [{'opening': {'next_transition_at': '2000-01-01T00:00:00Z'}}]}))
        self.assertFalse(transition_passed({'services': [{'opening': {'next_transition_at': None}}]}))


class WeeklyScheduleTests(unittest.TestCase):
    """Keep uncertainty across multiple applicable service schedules."""

    def test_unknown_schedule_prevents_closed_label_in_either_order(self):
        """A closed schedule cannot hide another schedule's unknown hours."""
        from app.backend.api.directory.projection import weekly_days
        closed = {"iso_weekday": 1, "scope_code": "service", "day_state": "closed"}
        unknown = {**closed, "day_state": "unknown"}
        for rows in ([closed, unknown], [unknown, closed]):
            self.assertEqual(weekly_days(rows)[0]["state"], "unknown")
        self.assertEqual(weekly_days([closed, closed])[0]["state"], "closed")
        self.assertEqual(weekly_days([])[0]["state"], "unknown")
