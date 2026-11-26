"""Real HTTP/session/private preparation contracts on disposable PostgreSQL; no AI calls."""
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
from app.backend.api.moderation import auth
from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.config import Configuration, DirectorySettings, EditorialSettings, profile
from app.backend.main import create_app
from tests.native import REPOSITORY, Cluster, people

BASE = '/moderazione/contribuisci/api'
SECRET = 'c' * 40
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(REPOSITORY, 'needs explicit EGI_DATABASE_REPO native schema fixture')
class PreparationHttpTests(unittest.TestCase):
    """Exercise real access, retained bytes, versions and bounded malformed requests."""

    @classmethod
    def setUpClass(cls):
        """Deploy schema and real people in an isolated socket-only cluster."""
        cls.cluster = Cluster.__new__(Cluster)
        cls.addClassCleanup(cls.cluster.close)
        cls.cluster.__init__(65457, 'egi_preparation_http')
        cls.cluster.file(Path(REPOSITORY)/'tests/contract/fixtures.sql', Path(REPOSITORY)/'tests/contract/helpers.sql', ROOT/'tests/canonical-fixture.sql')
        cls.cluster.sql('CREATE ROLE egi_preparation_http LOGIN IN ROLE egi_editorial')
        cls.people = people(cls.cluster, 'egi_preparation_http')
        cls.errors = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.errors.cleanup)
        cls.app = create_app(Configuration(profile(), canonical=True, error_dir=Path(cls.errors.name),
            directory=DirectorySettings(database_url=cls.cluster.dsn('egi_app_test_reader')),
            editorial=EditorialSettings(database_url=cls.cluster.dsn('egi_preparation_http'), cookie_secret=SECRET, secure_cookie=False)), {'source': StaticSubjectSource([])})

    def browser(self, login=None):
        """Open a real application browser with an existing database-backed session."""
        client = TestClient(self.app)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        if login:
            client.cookies.set('egi_moderation', login, path='/moderazione')
        return client

    def headers(self, login='mod1', **extra):
        """Use the existing Origin and per-session form-token algorithm."""
        return {'origin': 'http://testserver', 'X-EGI-Form-Token': auth.form_token(SECRET, auth.token_hash(login)), **extra}

    def prepare(self, client):
        """Register source metadata and create a private preparation through HTTP."""
        source = client.post(BASE+'/fonti', json={'metadata': {'name': 'Public test source', 'source_kind': 'directory'}, 'request_key': str(uuid4())}, headers=self.headers())
        self.assertEqual(source.status_code, 201, source.text)
        created = client.post(BASE+'/preparazioni', json={'source_id': source.json()['source_id'], 'title': 'Private HTTP preparation', 'request_key': str(uuid4())}, headers=self.headers())
        self.assertEqual(created.status_code, 201, created.text)
        return created.json()['id']

    def upload(self, client, workspace, raw=b'Sportello', expected=1, key=None, **extra):
        """Send raw text with explicit upload preconditions and attestation."""
        headers = self.headers(**{'Content-Type': 'text/plain; charset=utf-8', 'X-EGI-Expected-Revision': str(expected), 'X-EGI-Public-Material': 'false', 'X-EGI-Request-Key': key or str(uuid4()), **extra})
        return client.post(f'{BASE}/preparazioni/{workspace}/input', content=raw, headers=headers)

    def test_access_replay_versions_history_and_trash(self):
        """Owner/edit/read/outsider rights apply to reads, mutations and replays."""
        owner, reader, admin = (self.browser(login) for login in ('mod1', 'mod2', 'admin'))
        self.assertEqual(self.browser().get(BASE+'/preparazioni').status_code, 401)
        workspace = self.prepare(owner)
        path = f'{BASE}/preparazioni/{workspace}'
        self.assertEqual(admin.get(path).status_code, 404)
        key = str(uuid4())
        uploaded = self.upload(owner, workspace, b'\xef\xbb\xbfSportello\r\n', key=key)
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        self.assertEqual(self.upload(owner, workspace, b'\xef\xbb\xbfSportello\r\n', key=key).json(), uploaded.json())
        self.assertEqual(self.upload(owner, workspace, b'Changed', key=key).status_code, 409)
        input_id = uploaded.json()['input_id']
        raw_path = path+'/input/'+input_id
        raw = owner.get(raw_path)
        self.assertEqual(raw.content, b'\xef\xbb\xbfSportello\r\n')
        self.assertEqual(raw.headers['x-egi-schema-version'], '1')
        self.assertEqual(admin.get(raw_path).status_code, 404)
        grant = {'actor_id': self.people['mod2']['actor'], 'permission': 'read', 'expected_revision': 2, 'request_key': str(uuid4())}
        shared = owner.post(path+'/accessi', json=grant, headers=self.headers())
        self.assertEqual(shared.status_code, 200, shared.text)
        self.assertEqual(reader.get(raw_path).content, raw.content)
        self.assertEqual(reader.get(path).json()['permission'], 'read')
        self.assertEqual(reader.post(path+'/cestina', json={'expected_revision': 3, 'request_key': str(uuid4())}, headers=self.headers('mod2')).status_code, 403)
        manual = {'input_id': input_id, 'job_id': None, 'selections': [{'creation_key': str(uuid4())}], 'request_key': str(uuid4())}
        self.assertEqual(reader.post(path+'/schede/crea', json=manual, headers=self.headers('mod2')).status_code, 403)
        grant.update(permission='edit', expected_revision=3, request_key=str(uuid4()))
        self.assertEqual(owner.post(path+'/accessi', json=grant, headers=self.headers()).status_code, 200)
        created = reader.post(path+'/schede/crea', json=manual, headers=self.headers('mod2'))
        self.assertEqual(created.status_code, 201, created.text)
        card = created.json()['items'][0]
        card_path = path+'/schede/'+card['item_id']
        payload = reader.get(card_path).json()['version']['payload']
        payload['service'] = {'name': 'Manual correction'}
        save = {'changes': [{'item_id': card['item_id'], 'expected_version': card['version_id'], 'payload': payload}], 'request_key': str(uuid4())}
        saved = reader.post(path+'/schede', json=save, headers=self.headers('mod2'))
        self.assertEqual(saved.status_code, 200, saved.text)
        save['request_key'] = str(uuid4())
        self.assertEqual(reader.post(path+'/schede', json=save, headers=self.headers('mod2')).status_code, 409)
        self.assertEqual(len(owner.get(card_path+'/cronologia').json()['versions']), 2)
        self.assertEqual(owner.get(card_path+'/cronologia?limit=101').status_code, 422)
        self.assertNotIn('payload', owner.get(path).json()['items'][0])
        self.assertEqual(reader.post(path+'/accessi', json=grant, headers=self.headers('mod2')).status_code, 403)
        undo = owner.post(path+'/operazioni/'+saved.json()['operation_id']+'/annulla', json={'request_key': str(uuid4())}, headers=self.headers())
        self.assertEqual(undo.status_code, 200, undo.text)
        self.assertEqual(owner.get(card_path).json()['version']['payload']['service'], {})
        grant.update(permission=None, expected_revision=4, request_key=str(uuid4()))
        self.assertEqual(owner.post(path+'/accessi', json=grant, headers=self.headers()).status_code, 200)
        self.assertEqual(reader.get(raw_path).status_code, 404)
        self.assertEqual(reader.post(path+'/schede/crea', json=manual, headers=self.headers('mod2')).status_code, 404)
        self.assertEqual(owner.post(path+'/cestina', json={'expected_revision': 5, 'request_key': str(uuid4())}, headers=self.headers()).status_code, 200)
        restored = owner.post(path+'/ripristina', json={'expected_revision': 6, 'request_key': str(uuid4())}, headers=self.headers())
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(owner.get(raw_path).content, raw.content)

    def test_editor_shell_uses_csp_and_safe_source_metadata(self):
        """The real editor uses external scripts and safely encodes untrusted source names."""
        owner = self.browser('mod1')
        source = owner.post(BASE+'/fonti', json={'metadata': {'name': '</script><script>PRIVATE_TEST</script>', 'source_kind': 'directory'}, 'request_key': str(uuid4())}, headers=self.headers())
        self.assertEqual(source.status_code, 201)
        page = owner.get('/moderazione/contribuisci')
        self.assertEqual(page.status_code, 200, page.text)
        self.assertIn('/static/js/features/preparations/editor.js', page.text)
        self.assertIn('application/json', page.text)
        self.assertNotIn('<script>PRIVATE_TEST</script>', page.text)
        self.assertNotIn("unsafe-inline", page.headers['content-security-policy'])
        self.assertEqual(page.headers['cache-control'], 'no-store')
        self.assertEqual(self.browser().get('/moderazione/contribuisci').status_code, 401)

    def test_people_sources_and_invalid_sessions(self):
        """Existing people listing and separate source admission keep their role boundary."""
        moderator, admin = self.browser('mod1'), self.browser('admin')
        people_response = moderator.get(BASE+'/persone')
        self.assertEqual(people_response.status_code, 200, people_response.text)
        self.assertTrue(all(set(person)=={'actor_id', 'display_name', 'role'} for person in people_response.json()['items']))
        source = moderator.post(BASE+'/fonti', json={'metadata': {'name': 'Admission test', 'source_kind': 'directory'}, 'request_key': str(uuid4())}, headers=self.headers()).json()['source_id']
        path = BASE+'/fonti/'+source+'/ammetti'
        self.assertEqual(moderator.post(path, json={'reason': 'Reviewed'}, headers=self.headers()).status_code, 403)
        self.assertEqual(admin.post(path, json={'reason': 'Reviewed'}, headers=self.headers('admin')).status_code, 200)
        invalid = self.browser('not-a-real-session').get(BASE+'/preparazioni')
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(invalid.json()['schema_version'], 1)
        malformed = moderator.post(BASE+'/preparazioni', content=b'{"title":"a","title":"b"}', headers=self.headers(**{'Content-Type': 'application/json'}))
        self.assertEqual(malformed.status_code, 422)

    def test_bounded_utf8_csrf_and_safe_errors(self):
        """Declared and chunked limits, exact UTF-8 and safe errors use the real app."""
        client = self.browser('mod1')
        workspace = self.prepare(client)
        path = f'{BASE}/preparazioni/{workspace}'
        body = {'expected_revision': 1, 'request_key': str(uuid4())}
        self.assertEqual(client.post(path+'/cestina', json=body).status_code, 403)
        self.assertEqual(client.post(path+'/cestina', json=body, headers=self.headers(origin='https://other.invalid')).status_code, 403)
        self.assertEqual(self.upload(client, workspace, b'\xffPRIVATE').status_code, 422)
        self.assertEqual(self.upload(client, workspace, b'x', **{'X-EGI-Public-Material': 'True'}).status_code, 422)
        self.assertEqual(self.upload(client, workspace, b'x', **{'X-EGI-Request-Key': 'bad'}).status_code, 422)
        self.assertEqual(self.upload(client, workspace, b'x', **{'Content-Type': 'text/csv; charset=utf-8'}).status_code, 422)
        accepted = self.upload(client, workspace, ('\ufeff'+'😀'*50000).encode())
        self.assertEqual(accepted.status_code, 201, accepted.text)
        self.assertEqual(self.upload(client, workspace, ('é'*50001).encode(), expected=2).status_code, 413)
        chunked = self.upload(client, workspace, (b'x'*10000 for _ in range(21)), expected=2)
        self.assertEqual(chunked.status_code, 413, chunked.text)
        malformed = client.post(path+'/cestina', content=b'{"PRIVATE":NaN}', headers=self.headers(**{'Content-Type': 'application/json'}))
        self.assertEqual(malformed.status_code, 422)
        self.assertNotIn('PRIVATE', malformed.text)
        too_large = client.post(path+'/schede', content=(b'x'*10000 for _ in range(106)), headers=self.headers(**{'Content-Type': 'application/json'}))
        self.assertEqual(too_large.status_code, 413)
        for response in (malformed, too_large, chunked):
            self.assertEqual(response.json()['schema_version'], 1)
            self.assertIn('request_id', response.json())
            self.assertEqual(response.headers['cache-control'], 'no-store')
        for file in Path(self.errors.name).glob('*.json'):
            self.assertNotIn('PRIVATE', file.read_text())
