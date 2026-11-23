"""Verify configured application isolation through HTTP and real dependency Seams."""
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.backend.config import Configuration, profile
from app.backend.main import create_app
from app.backend.api.preview.subjects import StaticSubjectSource


class ApplicationInstancesTests(unittest.TestCase):
    """Independent lifecycles do not inherit each other's mode, profile or resources."""

    def test_two_profiles_and_resource_lifetimes_are_isolated(self):
        """Both apps resolve their own public geography and source counts concurrently."""
        first = profile()
        second = first.model_copy(update={
            'territory_code': 'synthetic',
            'fallback': first.fallback.model_copy(update={'name': 'Synthetic', 'country_code': 'ES', 'timezone': 'Europe/Madrid'})})
        with tempfile.TemporaryDirectory() as root:
            a = create_app(Configuration(first, error_dir=Path(root)/'a'), {'source': StaticSubjectSource([])})
            b = create_app(Configuration(second, error_dir=Path(root)/'b'), {'source': StaticSubjectSource([{'id': 'synthetic'}])})
            with TestClient(a) as client_a:
                with TestClient(b) as client_b:
                    self.assertIn('Roma', client_a.get('/map').text)
                    self.assertIn('Synthetic', client_b.get('/map').text)
                    self.assertEqual(client_a.get('/health').json()['services'], 0)
                    self.assertEqual(client_b.get('/health').json()['services'], 1)
                    client_a.post('/api/preview/address-search', json={'query': 'x'})
                    self.assertTrue(list((Path(root)/'a').glob('*.json')))
                    self.assertFalse(list((Path(root)/'b').glob('*.json')))
                # Closing another app does not retire this one's selected resources.
                self.assertEqual(client_a.get('/health').status_code, 200)

    def test_configuration_failure_occurs_at_startup_without_secret_values(self):
        """Importing/composing an app does not require or disclose its eventual settings."""
        with patch.dict('os.environ', {'EGI_DATA_MODE': 'SECRET_INVALID_MODE'}, clear=True):
            application = create_app()
            with self.assertRaisesRegex(RuntimeError, 'Unsupported directory data mode') as error:
                with TestClient(application):
                    pass
            self.assertNotIn('SECRET_INVALID_MODE', str(error.exception))


class SnapshotReader:
    """Serve synthetic public reads at the same domain Interface as the real Db."""

    def __init__(self, snapshot):
        """Keep a public fixture without constructing a connection."""
        self.value = snapshot

    def snapshot(self, language='it'):
        """Return the selected fixture in the native public snapshot shape."""
        return self.value

    def close(self):
        """The fixture has no external resources to close."""


class DirectorySelectionTests(unittest.TestCase):
    """UUID selection is independent from list limits."""

    def test_detail_beyond_list_limit_remains_public(self):
        """A published card after the first 5000 must remain addressable by UUID."""
        from uuid import UUID
        from app.backend.config import DirectorySettings
        service = {'revision_id': str(UUID(int=9000)), 'name': {'text': 'Public'},
                   'description': {'text': 'Public description'}, 'classifications': [],
                   'sources': [], 'contacts': [], 'conditions': [], 'weekly_hours': [],
                   'delivery_mode': 'in_person', 'cost': {'state': 'unknown', 'note': None},
                   'operational_status': 'active', 'opening': {'status': 'unknown'},
                   'valid_from': None, 'valid_until': None}
        rows = [{**service, 'service_id': str(UUID(int=i))} for i in range(1, 5002)]
        reader = SnapshotReader({'services': rows, 'taxonomy': [], 'supplements': [],
                                 'evaluated_at': '2026-11-23T10:00:00Z'})
        configuration = Configuration(profile(), canonical=True,
                                      directory=DirectorySettings(database_url='unused'))
        with tempfile.TemporaryDirectory() as root:
            configuration = replace(configuration, error_dir=Path(root))
            with TestClient(create_app(configuration, {'reader': reader})) as client:
                self.assertEqual(len(client.get('/api/public/services?limit=1').json()), 1)
                response = client.get('/api/public/services/' + rows[-1]['service_id'])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['id'], rows[-1]['service_id'])
