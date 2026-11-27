"""Visitor contributions through HTTP into the private store (EGI-22).

Needs EGI_DATABASE_REPO (see tests/native.py). The public reader sees the canonical
fixture's "Public service"; the intake login can only submit.
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
import psycopg

from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.config import Configuration, DirectorySettings, profile
from app.backend.main import create_app
from tests.native import REPOSITORY, Cluster

ORIGIN = {'origin': 'http://testserver'}
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(REPOSITORY, 'needs explicit EGI_DATABASE_REPO native schema fixture')
class ContributeTests(unittest.TestCase):
    """Forms, validation, storage, honeypot, switch and public isolation."""

    @classmethod
    def setUpClass(cls):
        """Deploy, load the public fixture and create the intake login."""
        cls.cluster = Cluster(65442, 'egi_contribute')
        cls.addClassCleanup(cls.cluster.close)
        cls.cluster.file(Path(REPOSITORY)/'tests/contract/fixtures.sql', Path(REPOSITORY)/'tests/contract/helpers.sql',
                         ROOT/'tests/canonical-fixture.sql')
        cls.cluster.sql('CREATE ROLE egi_test_intake LOGIN IN ROLE egi_intake')
        cls.owner = psycopg.connect(cls.cluster.dsn(__import__('getpass').getuser()), autocommit=True)
        cls.addClassCleanup(cls.owner.close)
        cls.service, cls.revision = cls.owner.execute(
            "SELECT h.entity_id::text,h.revision_id::text FROM governance.published_heads h JOIN data.services s USING(entity_id)").fetchone()
        errors = tempfile.TemporaryDirectory()
        cls.addClassCleanup(errors.cleanup)
        cls.configuration = Configuration(profile(), canonical=True, error_dir=Path(errors.name),
            directory=DirectorySettings(database_url=cls.cluster.dsn('egi_app_test_reader')),
            intake_url=cls.cluster.dsn('egi_test_intake'))

    def client(self, configuration=None) -> TestClient:
        """Return a client for an app built from `configuration`."""
        client = TestClient(create_app(configuration or self.configuration, {'source': StaticSubjectSource([])}))
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def rows(self, sql: str):
        """Read the private store as the owner."""
        return self.owner.execute(sql).fetchall()

    def test_forms_validate_store_and_confirm_receipt_only(self):
        """Report, still-valid and proposal journeys; nothing public changes."""
        client = self.client()
        before = client.get('/api/public/services').json()
        self.assertIn('Proponi un servizio', client.get('/contribuisci').text)
        self.assertIn('Public service', client.get('/contribuisci', params={'issue': 'error', 'poi_id': self.service}).text)
        self.assertEqual(client.get('/contribuisci', params={'issue': 'error', 'poi_id': '00000000-0000-0000-0000-000000000000'}).status_code, 404)

        report = {'issue': 'error', 'poi_id': self.service, 'lang': 'it', 'category': 'hours', 'message': 'Chiude prima',
                  'value': 'Lun 9-12', 'contact': 'reporter@example.invalid'}
        self.assertEqual(client.post('/contribuisci', data=report).status_code, 403, 'no Origin')
        refused = client.post('/contribuisci', data=report, headers=ORIGIN)
        self.assertEqual(refused.status_code, 400)
        self.assertIn('serve il consenso', refused.text)
        self.assertEqual(client.post('/contribuisci', data={**report, 'category': ''}, headers=ORIGIN).status_code, 400)
        received = client.post('/contribuisci', data={**report, 'consent': '1'}, headers=ORIGIN)
        self.assertEqual(received.status_code, 200)
        self.assertIn('Abbiamo ricevuto la segnalazione', received.text)
        self.assertNotIn('reporter@example.invalid', received.text)

        self.assertIn('ricevuto la conferma', client.post('/contribuisci', data={'issue': 'still_valid', 'poi_id': self.service},
                                                          headers=ORIGIN).text)
        self.assertEqual(client.post('/contribuisci', data={'name': 'Mensa'}, headers=ORIGIN).status_code, 400, 'offer missing')
        proposal = client.post('/contribuisci', data={'name': 'Mensa San Paolo', 'offer': 'Pasti caldi', 'online': '1'}, headers=ORIGIN)
        self.assertIn('ricevuto la proposta', proposal.text)
        trapped = client.post('/contribuisci', data={'name': 'Spam', 'offer': 'Spam', 'website': 'http://spam.invalid'}, headers=ORIGIN)
        self.assertEqual(trapped.status_code, 200, 'a bot sees the same receipt')

        stored = self.rows("SELECT kind,category,service_id::text,public_revision_id::text,text,contact FROM editorial.contributions ORDER BY created_at")
        self.assertEqual(stored, [('report', 'hours', self.service, self.revision, 'Chiude prima', 'reporter@example.invalid'),
                                  ('still_valid', None, self.service, self.revision, None, None),
                                  ('new_service', None, None, None, None, None)])
        self.assertEqual(self.rows("SELECT field,value#>>'{}' FROM editorial.proposals ORDER BY field"),
                         [('hours', 'Lun 9-12'), ('name', 'Mensa San Paolo'), ('offer', 'Pasti caldi'), ('online', 'sì')])

        after = client.get('/api/public/services').json()
        self.assertEqual(before, after, 'public reads are unchanged')
        self.assertNotIn('reporter@example.invalid', client.get(f'/api/public/services/{self.service}').text)

        self.owner.execute('UPDATE editorial.intake_settings SET open=false')
        self.addCleanup(self.owner.execute, 'UPDATE editorial.intake_settings SET open=true')
        later = client.post('/contribuisci', data={'issue': 'still_valid', 'poi_id': self.service}, headers=ORIGIN)
        self.assertEqual(later.status_code, 503)
        self.assertIn('Riprova più tardi', later.text)

    def test_without_intake_contributions_are_unavailable(self):
        """No intake login, or preview mode: the page only explains."""
        for configuration in (Configuration(profile(), canonical=True, error_dir=self.configuration.error_dir,
                                            directory=self.configuration.directory),
                              Configuration(profile(), error_dir=self.configuration.error_dir)):
            client = self.client(configuration)
            self.assertIn('non sono ancora disponibili', client.get('/contribuisci').text)
            self.assertIn('non sono ancora disponibili', client.post('/contribuisci', data={'name': 'x', 'offer': 'y'}, headers=ORIGIN).text)
