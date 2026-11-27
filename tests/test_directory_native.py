"""Exercise the actual public facade on an independently owned disposable cluster.

EGI_DATABASE_REPO selects the schema/fixture prerequisite; see tests/native.py.
No importer, private captures, installed preview or retained database is reused.
"""

import getpass
from pathlib import Path
import subprocess
import sys
import unittest

import psycopg

from app.backend.api.directory.projection import cards
from app.backend.db.database import Db, DirectoryUnavailable
from app.backend.config import DirectorySettings

from tests.native import REPOSITORY, Cluster
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(REPOSITORY, "needs explicit EGI_DATABASE_REPO native schema fixture")
class NativeDirectoryTests(unittest.TestCase):
    """Verify approved, private, draft and error behavior as a real restricted reader."""

    @classmethod
    def setUpClass(cls):
        """Create only this test's socket-only database and load controlled fixtures."""
        cls.cluster = Cluster(65437, "egi_app_contract")
        cls.addClassCleanup(cls.cluster.close)
        cls.base, cls.environment = cls.cluster.base, cls.cluster.environment
        cls.cluster.file(Path(REPOSITORY)/"tests/contract/fixtures.sql", Path(REPOSITORY)/"tests/contract/helpers.sql",
                         ROOT/"tests/canonical-fixture.sql")
        cls.dsn = f"host={cls.base} port=65437 dbname=egi_app_contract user=egi_app_test_reader"

    def test_public_facade_and_role_boundary(self):
        """Native public reads exclude pending/private fields and deny raw table access."""
        facade = Db(DirectorySettings(database_url=self.dsn))
        snapshot = facade.snapshot()
        self.assertEqual([row["name"]["text"] for row in snapshot["services"]], ["Public service"])
        self.assertNotIn("PRIVATE999", str(snapshot))
        self.assertNotIn("PENDING_SECRET", str(snapshot))
        card = cards(snapshot)[0]
        self.assertEqual(card["needs"], ["istruzione"])
        self.assertIsNone(card["place"]["geometry"])
        with psycopg.connect(self.dsn) as reader:
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                reader.execute("SELECT * FROM governance.sync_entries")
        with psycopg.connect(self.dsn) as reader:
            self.assertEqual(reader.execute("SHOW transaction_read_only").fetchone()[0], "on")

    def test_canonical_http_isolation(self):
        """The real app mode serves public cards and refuses all raw/debug endpoints."""
        code = '''from fastapi.testclient import TestClient
from app.backend.main import app
with TestClient(app) as client:
    response=client.get('/api/public/services')
    assert response.status_code==200, response.text
    assert len(response.json())==1
    assert 'PRIVATE999' not in response.text and 'PENDING_SECRET' not in response.text
    identifier=response.json()[0]['id']
    assert client.get('/api/public/services/'+identifier).status_code==200
    for path in ['/api/preview/services','/api/preview/debug/sources','/api/preview/review/overlaps','/benchmark','/revisione/doppioni']:
        assert client.get(path).status_code==404, path
    assert client.get('/health').json()['mode']=='canonical-local'
    assert client.get('/map').status_code==200
    assert client.get('/map').headers['X-EGI-Data-Status']=='approved-canonical-local'
    app.state.resources.geocoder.search_address=lambda query: []
    assert client.post('/api/preview/address-search',json={'query':'Roma'}).status_code==200
    assert client.get('/api/preview/transit/places').status_code==404
    assert all(row['name_native'] for row in client.get('/api/public/languages').json())
'''
        result = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True,
            env={**cls_env(self.environment), "EGI_DATA_MODE": "canonical", "EGI_DATABASE_URL": self.dsn})
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_configured_local_layers_never_read_preview(self):
        """Actual canonical composition enables only selected local readers."""
        code = """from fastapi.testclient import TestClient
from app.backend.main import app

with TestClient(app) as client:
    assert app.state.resources.source is None
    assert client.get('/api/preview/transit/places').status_code==200
    assert client.get('/api/preview/services').status_code==404
"""
        result=subprocess.run([sys.executable,'-c',code],cwd=ROOT,capture_output=True,text=True,
            env={**cls_env(self.environment),'EGI_DATA_MODE':'canonical','EGI_DATABASE_URL':self.dsn,'EGI_LOCAL_LAYERS':'1'})
        self.assertEqual(result.returncode,0,result.stderr)

    def test_unavailable_store_has_no_secret_in_error(self):
        """Connection failures surface explicitly without disclosing the configured DSN."""
        facade = Db(DirectorySettings(database_url=self.dsn.replace("egi_app_contract", "missing_secret_database")))
        with self.assertRaises(DirectoryUnavailable) as caught:
            facade.snapshot()
        self.assertNotIn("secret", str(caught.exception))

    def test_supplement_refresh_is_independent_of_public_sequence(self):
        """A secondary review change is visible even while the core snapshot stays cached."""
        facade = Db(DirectorySettings(database_url=self.dsn))
        first = facade.snapshot()
        revision = first['supplements'][0]['revision_id']
        owner_dsn = self.dsn.replace('user=egi_app_test_reader', f'user={getpass.getuser()}')
        try:
            with psycopg.connect(owner_dsn) as owner:
                owner.execute("SELECT governance.review_revision(%s,NULL,'rejected','test')", [revision])
            second = facade.snapshot()
            self.assertEqual(first['snapshot_sequence'], second['snapshot_sequence'])
            self.assertEqual(first['evaluated_at'], second['evaluated_at'])
            self.assertEqual(second['supplements'], [])
        finally:
            with psycopg.connect(owner_dsn) as owner:
                owner.execute("SELECT governance.review_revision(%s,NULL,'approved','test restore')", [revision])

    def test_publication_and_withdrawal_invalidate_cached_snapshot(self):
        """A reader sees an editor's approved change and withdrawal without an app restart."""
        from psycopg.types.json import Jsonb
        facade = Db(DirectorySettings(database_url=self.dsn))
        first = facade.snapshot()
        owner_dsn = self.dsn.replace('user=egi_app_test_reader', f'user={getpass.getuser()}')
        payload = {"name": "Refresh probe", "description": "Synthetic approved change", "delivery_mode": "telephone",
                   "contacts": [{"channel_type": "phone", "value": "063333333"}],
                   "territories": [first["territory"]["territory_id"]],
                   "evidence": {"record": [{"assertion_id": "57000000-0000-0000-0000-000000000001", "role": "supporting"}]}}
        with psycopg.connect(owner_dsn) as owner:
            revision = owner.execute("SELECT governance.save_revision('service',NULL,NULL,NULL,%s,'test refresh')", [Jsonb(payload)]).fetchone()[0]
            entity = owner.execute("SELECT entity_id FROM governance.entity_revisions WHERE revision_id=%s", [revision]).fetchone()[0]
            decision = owner.execute("SELECT governance.review_revision(%s,NULL,'approved','test refresh')", [revision]).fetchone()[0]
            owner.execute("SELECT governance.publish_revision(%s,%s,NULL)", [revision, decision])
        try:
            second = facade.snapshot()
            self.assertGreater(second["snapshot_sequence"], first["snapshot_sequence"])
            self.assertEqual(len(second["services"]), len(first["services"])+1)
        finally:
            with psycopg.connect(owner_dsn) as owner:
                owner.execute("SELECT governance.withdraw_service(%s,%s,'moderation','remove synthetic refresh probe')", [entity, revision])
        self.assertEqual(len(facade.snapshot()["services"]), len(first["services"]))

    def test_query_values_are_bound(self):
        """SQL-looking language values stay values and do not change canonical state."""
        facade = Db(DirectorySettings(database_url=self.dsn))
        result = facade.snapshot("it'; SELECT pg_sleep(100); --")
        self.assertEqual(len(result['services']), 1)


def cls_env(environment: dict) -> dict:
    """Remove an unrelated mode override from the native child app environment."""
    return {key: value for key, value in environment.items() if key not in {"EGI_DATA_MODE", "EGI_DATABASE_URL", "EGI_LOCAL_LAYERS"}}
