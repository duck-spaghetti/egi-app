"""The moderation queue: grouping, filters, claims and waiting reasons (EGI-24).

Needs EGI_DATABASE_REPO (see tests/native.py). Contributions arrive through the
intake login, as from the public form.
"""
import getpass
import json
import re
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
import psycopg

from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.config import Configuration, DirectorySettings, EditorialSettings, profile
from app.backend.main import create_app
from tests.native import REPOSITORY, Cluster, people

ORIGIN = {'origin': 'http://testserver'}
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(REPOSITORY, 'needs explicit EGI_DATABASE_REPO native schema fixture')
class ModerationQueueTests(unittest.TestCase):
    """Two moderators and the admin work the same queue."""

    @classmethod
    def setUpClass(cls):
        """Deploy, load a public service, create people and three contributions."""
        cls.cluster = Cluster(65443, 'egi_moderation_queue')
        cls.addClassCleanup(cls.cluster.close)
        cls.cluster.file(Path(REPOSITORY)/'tests/contract/fixtures.sql', Path(REPOSITORY)/'tests/contract/helpers.sql',
                         ROOT/'tests/canonical-fixture.sql')
        cls.cluster.sql('CREATE ROLE egi_test_desk LOGIN IN ROLE egi_editorial')
        cls.cluster.sql('CREATE ROLE egi_test_intake LOGIN IN ROLE egi_intake')
        cls.people = people(cls.cluster, 'egi_test_desk')
        cls.owner = psycopg.connect(cls.cluster.dsn(getpass.getuser()), autocommit=True)
        cls.addClassCleanup(cls.owner.close)
        cls.service = cls.owner.execute('SELECT h.entity_id::text FROM governance.published_heads h JOIN data.services USING(entity_id)').fetchone()[0]
        with psycopg.connect(cls.cluster.dsn('egi_test_intake'), autocommit=True) as intake:
            for kind, service, category, text, contact, proposals in (
                    ('report', cls.service, 'hours', 'Chiude alle 12', 'reporter@example.invalid', [{'field': 'hours', 'value': 'Lun 9-12'}]),
                    ('still_valid', cls.service, None, None, None, []),
                    ('new_service', None, None, 'Nuova mensa', None, [{'field': 'name', 'value': 'Mensa San Paolo'}])):
                intake.execute('SELECT editorial.submit_contribution(%s,%s,%s,%s,%s,%s,%s,NULL)',
                               (kind, service, category, text, contact, contact is not None, json.dumps(proposals)))
        cls.ids = dict(cls.owner.execute('SELECT kind,contribution_id::text FROM editorial.contributions').fetchall())
        errors = tempfile.TemporaryDirectory()
        cls.addClassCleanup(errors.cleanup)
        cls.app = create_app(Configuration(profile(), canonical=True, error_dir=Path(errors.name),
            directory=DirectorySettings(database_url=cls.cluster.dsn('egi_app_test_reader')),
            editorial=EditorialSettings(database_url=cls.cluster.dsn('egi_test_desk'), cookie_secret='s' * 40, secure_cookie=False)),
            {'source': StaticSubjectSource([])})

    def browser(self, login: str | None) -> TestClient:
        """Return a client signed in as `login` (or anonymous)."""
        client = TestClient(self.app)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        if login:
            client.cookies.set('egi_moderation', self.people[login]['token'], path='/moderazione')
        return client

    def post(self, client: TestClient, path: str, **data):
        """POST a moderation form with Origin and the page's form token."""
        token = re.search(r'name="form_token" value="([^"]+)"', client.get('/moderazione').text).group(1)
        return client.post(path, data={**data, 'form_token': token}, headers=ORIGIN)

    def events(self, contribution: str):
        """Return (action, actor) of a contribution's history."""
        return [(action, str(actor) if actor else None) for action, actor in self.owner.execute(
            'SELECT action,actor_id FROM editorial.events WHERE contribution_id=%s ORDER BY event_id', (contribution,)).fetchall()]

    def test_queue_groups_filters_and_records_every_step(self):
        """Grouping by service, filters, claim, takeover, reassignment and waiting."""
        anonymous = self.browser(None)
        self.assertEqual(anonymous.get('/moderazione/coda', follow_redirects=False).status_code, 303)
        self.assertNotIn('reporter@example.invalid', anonymous.get(f'/api/public/services/{self.service}').text)

        mod1, mod2, admin = self.browser('mod1'), self.browser('mod2'), self.browser('admin')
        queue = mod1.get('/moderazione/coda').text
        self.assertIn('Public service', queue, 'grouped under the service name')
        self.assertEqual(queue.count('/moderazione/contributo/'), 3)
        self.assertIn('Proposte di nuovi servizi', queue)
        self.assertEqual(mod1.get('/moderazione/coda', params={'tipo': 'report'}).text.count('/moderazione/contributo/'), 1)
        self.assertEqual(mod1.get('/moderazione/coda', params={'categoria': 'hours'}).text.count('/moderazione/contributo/'), 1)

        report = self.ids['report']
        page = mod1.get(f'/moderazione/contributo/{report}').text
        self.assertIn('reporter@example.invalid', page, 'moderators see the contact')
        self.assertIn('Chiude alle 12', page)
        mine = lambda: mod1.get('/moderazione/coda', params={'in_carico': 'me'}).text.count('/moderazione/contributo/')
        before = mine()  # the other test may already have claimed the proposal
        self.post(mod1, f'/moderazione/contributo/{report}/presa', action='claim')
        self.assertIn('in carico a Mod One', mod2.get('/moderazione/coda').text)
        self.assertEqual(mine(), before + 1)
        refused = self.post(mod2, f'/moderazione/contributo/{report}/presa', action='claim')
        self.assertIn('puoi subentrare', refused.text)
        self.post(mod2, f'/moderazione/contributo/{report}/presa', action='take_over')
        self.post(mod2, f'/moderazione/contributo/{report}/attesa', reason='admin')
        self.assertEqual(admin.get('/moderazione/coda', params={'stato': 'waiting', 'attesa': 'admin'}).text
                         .count('/moderazione/contributo/'), 1, "the admin's view")
        self.post(admin, f'/moderazione/contributo/{report}/presa', action='reassign', assignee=self.people['mod1']['actor'])
        self.post(mod1, f'/moderazione/contributo/{report}/attesa', reason='')
        signal = self.ids['still_valid']
        self.assertIn('non ha lasciato un contatto', self.post(mod1, f'/moderazione/contributo/{signal}/attesa', reason='submitter').text)

        mod1_actor, mod2_actor, admin_actor = (self.people[k]['actor'] for k in ('mod1', 'mod2', 'admin'))
        self.assertEqual(self.events(report), [('submitted', None), ('claimed', mod1_actor), ('taken_over', mod2_actor),
                                               ('waiting', mod2_actor), ('reassigned', admin_actor), ('resumed', mod1_actor)])
        history = mod2.get(f'/moderazione/contributo/{report}').text
        for text in ('Mod One', 'Mod Two', 'Admin One', 'subentro', 'riassegnato'):
            self.assertIn(text, history)

    def test_a_claim_does_not_lock(self):
        """Another moderator can still work on a contribution someone has claimed."""
        mod1, mod2 = self.browser('mod1'), self.browser('mod2')
        proposal = self.ids['new_service']
        self.post(mod1, f'/moderazione/contributo/{proposal}/presa', action='claim')
        self.post(mod2, f'/moderazione/contributo/{proposal}/attesa', reason='evidence')
        self.assertEqual(self.events(proposal)[-2:], [('claimed', self.people['mod1']['actor']),
                                                      ('waiting', self.people['mod2']['actor'])])
        self.assertIn('in carico a Mod One', mod2.get(f'/moderazione/contributo/{proposal}').text)
