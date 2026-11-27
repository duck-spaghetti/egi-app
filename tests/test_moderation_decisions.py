"""Proposal decisions through real sessions, native drafts/publication and retention (EGI-85)."""
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

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = {'origin': 'http://testserver'}


@unittest.skipUnless(REPOSITORY, 'needs explicit EGI_DATABASE_REPO native schema fixture')
class DecisionTests(unittest.TestCase):
    """Exercise complete proposal journeys without mocking editorial/canonical operations."""

    @classmethod
    def setUpClass(cls):
        """Create an isolated native cluster, synthetic source evidence and authenticated people."""
        cls.cluster = Cluster(65453, 'egi_decisions')
        cls.addClassCleanup(cls.cluster.close)
        cls.cluster.file(Path(REPOSITORY)/'tests/contract/fixtures.sql', Path(REPOSITORY)/'tests/contract/helpers.sql',
                         ROOT/'tests/canonical-fixture.sql')
        cls.cluster.sql('CREATE ROLE egi_test_desk LOGIN IN ROLE egi_editorial')
        cls.cluster.sql('CREATE ROLE egi_test_intake LOGIN IN ROLE egi_intake')
        cls.cluster.sql('CREATE ROLE egi_test_retention LOGIN IN ROLE egi_retention')
        cls.people = people(cls.cluster, 'egi_test_desk')
        cls.owner = psycopg.connect(cls.cluster.dsn(getpass.getuser()), autocommit=True)
        cls.addClassCleanup(cls.owner.close)
        cls.territory = cls.owner.execute("SELECT entity_id::text FROM geo.territories WHERE code='roma'").fetchone()[0]
        errors = tempfile.TemporaryDirectory()
        cls.addClassCleanup(errors.cleanup)
        cls.app = create_app(Configuration(profile(), canonical=True, error_dir=Path(errors.name),
            directory=DirectorySettings(database_url=cls.cluster.dsn('egi_app_test_reader')),
            intake_url=cls.cluster.dsn('egi_test_intake'),
            editorial=EditorialSettings(database_url=cls.cluster.dsn('egi_test_desk'), cookie_secret='s' * 40,
                                        secure_cookie=False)), {'source': StaticSubjectSource([])})

    def setUp(self):
        """Give every test an independently published service with one real protected phone."""
        body = {'name': 'Decision fixture', 'description': 'A service to check proposals', 'original_language': 'it',
                'delivery_mode': 'telephone', 'territories': [self.territory],
                'contacts': [{'channel_type': 'phone', 'value': '061234567'},
                             {'channel_type': 'phone', 'value': '069999999', 'is_public': False}],
                'evidence': {'record': [{'assertion_id': '57000000-0000-0000-0000-000000000001', 'role': 'supporting'}]}}
        revision = self.owner.execute("SELECT governance.save_revision('service',NULL,NULL,NULL,%s,'fixture')",
                                      (json.dumps(body),)).fetchone()[0]
        self.service = str(self.owner.execute('SELECT entity_id FROM governance.entity_revisions WHERE revision_id=%s',
                                              (revision,)).fetchone()[0])
        decision = self.owner.execute("SELECT governance.review_revision(%s,NULL,'approved','fixture')", (revision,)).fetchone()[0]
        self.owner.execute('SELECT governance.publish_revision(%s,%s,NULL)', (revision, decision))
        self.browser = TestClient(self.app)
        self.browser.__enter__()
        self.addCleanup(self.browser.__exit__, None, None, None)
        self.browser.cookies.set('egi_moderation', self.people['mod1']['token'], path='/moderazione')

    def heads(self):
        """Return current working/public revision strings."""
        row = self.owner.execute('SELECT w.revision_id::text,p.revision_id::text FROM governance.working_heads w '
                                 'LEFT JOIN governance.published_heads p USING(entity_id) WHERE w.entity_id=%s',
                                 (self.service,)).fetchone()
        return {'working': row[0], 'public': row[1]}

    def body(self):
        """Read the current complete working aggregate as the fixture's trusted owner."""
        return self.owner.execute('SELECT editorial.revision_body(%s)', (self.heads()['working'],)).fetchone()[0]

    def post(self, path, **data):
        """Submit a moderator form with real Origin/session-derived CSRF token."""
        token = re.search(r'name="form_token" value="([^"]+)"', self.browser.get('/moderazione').text).group(1)
        return self.browser.post(path, data={**data, 'form_token': token}, headers=ORIGIN)

    def contribute(self, fields, kind='report'):
        """Send proposals through the restricted intake login, returning contribution/proposal IDs."""
        with psycopg.connect(self.cluster.dsn('egi_test_intake'), autocommit=True) as connection:
            connection.execute('SELECT editorial.submit_contribution(%s,%s,%s,%s,%s,true,%s,NULL)',
                               (kind, self.service if kind == 'report' else None,
                                'other' if kind == 'report' else None, 'Visitor description',
                                'reporter@example.invalid', json.dumps([{'field': f, 'value': v} for f, v in fields.items()])))
        identifier = self.owner.execute('SELECT contribution_id::text FROM editorial.contributions ORDER BY created_at DESC LIMIT 1').fetchone()[0]
        proposals = dict(self.owner.execute('SELECT field,proposal_id::text FROM editorial.proposals WHERE contribution_id=%s',
                                           (identifier,)).fetchall())
        return identifier, proposals

    def decide(self, contribution, proposal, decision='accepted', **values):
        """Decide a proposal on the current exact heads unless the caller supplies stale ones."""
        return self.post(f'/moderazione/contributo/{contribution}/proposta/{proposal}',
                         **{**self.heads(), 'decision': decision, 'method': 'document', **values})

    def test_partial_decisions_publish_and_retention(self):
        """Only accepted/amended values reach draft, explicit publication and attributable closure."""
        contribution, proposals = self.contribute({'name': 'Visitor name', 'contacts': 'bad contact', 'conditions': 'Wrong condition'})
        original_public = self.heads()['public']
        original_publication = self.owner.execute('SELECT publication_id::text FROM governance.published_heads WHERE entity_id=%s', (self.service,)).fetchone()[0]
        accepted = self.decide(contribution, proposals['name'])
        self.assertEqual(accepted.status_code, 200, accepted.text[:300])
        self.assertEqual(self.body()['name'], 'Visitor name')
        self.assertEqual(self.heads()['public'], original_public)
        contact = self.body()['contacts'][0]['component_id']
        self.assertEqual(self.decide(contribution, proposals['contacts'], 'amended', value='068765432',
                                    channel='phone', component=contact, public_contact='1').status_code, 200)
        self.assertEqual(self.decide(contribution, proposals['conditions'], 'rejected').status_code, 200)
        body = self.body()
        self.assertEqual(body['conditions'], [])
        self.assertEqual(next(c['value'] for c in body['contacts'] if c['component_id'] == contact), '068765432')
        decisions = dict(self.owner.execute('SELECT field,decision FROM editorial.proposals WHERE contribution_id=%s', (contribution,)))
        self.assertEqual(decisions, {'name': 'accepted', 'contacts': 'amended', 'conditions': 'rejected'})
        self.assertEqual(self.post(f'/moderazione/contributo/{contribution}/chiudi', outcome='published').status_code, 400)
        self.assertEqual(self.post(f'/moderazione/contributo/{contribution}/chiudi', outcome='published', publication=original_publication).status_code, 400)
        self.assertEqual(self.post(f'/moderazione/servizio/{self.service}/pubblica', **self.heads(), summary='Checked visitor correction').status_code, 200)
        publication = self.owner.execute('SELECT publication_id::text FROM governance.published_heads WHERE entity_id=%s', (self.service,)).fetchone()[0]
        closed = self.post(f'/moderazione/contributo/{contribution}/chiudi', outcome='published', publication=publication)
        self.assertEqual(closed.status_code, 200, closed.text[:500])
        row = self.owner.execute('SELECT outcome,closed_by::text FROM editorial.contributions WHERE contribution_id=%s', (contribution,)).fetchone()
        self.assertEqual(row, ('published', self.people['mod1']['actor']))
        card = self.browser.get(f'/api/public/services/{self.service}').text
        self.assertIn('Visitor name', card)
        self.assertNotIn('reporter@example.invalid', card)
        self.owner.execute("UPDATE editorial.contributions SET closed_at=clock_timestamp()-interval '31 days' WHERE contribution_id=%s", (contribution,))
        with psycopg.connect(self.cluster.dsn('egi_test_retention'), autocommit=True) as retention:
            retention.execute('SELECT editorial.purge_expired_contributions()')
        self.assertEqual(self.owner.execute('SELECT text,contact,outcome FROM editorial.contributions WHERE contribution_id=%s', (contribution,)).fetchone(),
                         (None, None, 'published'))
        self.assertTrue(all(v is None for (v,) in self.owner.execute('SELECT value FROM editorial.proposals WHERE contribution_id=%s', (contribution,))))

    def test_stale_forged_and_invalid_decisions_are_atomic(self):
        """Stale revisions, unrelated proposal IDs and invalid structured values make no decision/write."""
        contribution, proposals = self.contribute({'name': 'First', 'hours': 'Monday 9-12'})
        stale = self.heads()
        self.assertEqual(self.decide(contribution, proposals['name']).status_code, 200)
        before = self.heads()
        self.assertEqual(self.decide(contribution, proposals['hours'], **stale).status_code, 409)
        self.assertIsNone(self.owner.execute('SELECT decision FROM editorial.proposals WHERE proposal_id=%s', (proposals['hours'],)).fetchone()[0])
        self.assertEqual(self.decide(contribution, proposals['hours'], weekday='1', day_state='intervals', scope='service',
                                    range_0_opens='09:00', range_0_closes='').status_code, 409)
        self.assertEqual(self.heads(), before)
        other, own = self.contribute({'name': 'Other'})
        self.assertEqual(self.decide(contribution, own['name']).status_code, 404)
        self.assertEqual(self.decide(contribution, proposals['name']).status_code, 409, 'decisions are not silently applied twice')

    def test_structured_hours_and_conditions(self):
        """Human-entered hours/individual conditions are saved with evidence and untouched peers preserved."""
        contribution, proposals = self.contribute({'hours': 'Monday 9-12', 'conditions': 'Appointment required'})
        self.assertEqual(self.decide(contribution, proposals['hours'], weekday='1', day_state='intervals', scope='service',
                                    range_0_opens='09:00', range_0_closes='12:00').status_code, 200)
        self.assertEqual(self.decide(contribution, proposals['conditions'], condition_kind='appointment', requirement_state='required').status_code, 200)
        body = self.body()
        self.assertEqual(body['schedules'][0]['days'][0]['intervals'][0]['opens'], '09:00')
        self.assertEqual(body['conditions'][0]['requirement_state'], 'required')
        self.assertTrue(body['conditions'][0]['evidence'])
        self.assertTrue(body['schedules'][0]['days'][0]['intervals'][0]['evidence'], 'accepted interval cites the checked source assertion')

    def test_new_service_prefill_create_and_no_duplicate_click(self):
        """Selected visitor values prefill a new draft, with a real chosen mode/channel and no auto-publication."""
        contribution, proposals = self.contribute({'name': 'New online desk', 'offer': 'Online consultations',
                                                 'link': 'https://example.invalid/desk', 'online': 'sì'}, 'new_service')
        page = self.browser.get('/moderazione/servizi/nuovo', params={'contributo': contribution})
        self.assertIn('Online consultations', page.text)
        self.assertIn('New online desk', page.text)
        data = {'contribution': contribution, 'name': 'New online desk', 'description': 'Online consultations',
                'service_link': 'https://example.invalid/desk', 'delivery_mode': 'online', 'location': 'none',
                'territory': self.territory, 'method': 'official_website'}
        count = self.owner.execute('SELECT count(*) FROM data.services').fetchone()[0]
        made = self.post('/moderazione/servizi/nuovo', **data)
        self.assertEqual(made.status_code, 200, made.text[:500])
        service = made.url.path.rsplit('/', 1)[-1]
        self.assertEqual(self.owner.execute('SELECT count(*) FROM governance.published_heads WHERE entity_id=%s', (service,)).fetchone()[0], 0)
        self.assertEqual(self.post('/moderazione/servizi/nuovo', **data).status_code, 400)
        self.assertEqual(self.owner.execute('SELECT count(*) FROM data.services').fetchone()[0], count + 1)

    def test_only_admin_can_release_protected_contact(self):
        """Ordinary publication cannot release protection; the explicit Admin operation can."""
        before = self.heads()
        body = self.body()
        for c in body['contacts']:
            c['is_public'] = True
        draft = str(self.owner.execute("SELECT governance.save_revision('service',%s,%s,%s,%s,'review release')",
                                       (self.service, before['working'], before['public'], json.dumps(body))).fetchone()[0])
        protection = self.owner.execute('SELECT protection_id::text FROM governance.contact_protections WHERE origin_service_id=%s',
                                        (self.service,)).fetchone()[0]
        data = {'working': draft, 'public': before['public'], 'protection': protection, 'scope': 'global', 'reason': 'Explicitly verified public phone'}
        self.assertEqual(self.post(f'/moderazione/servizio/{self.service}/protezione', **data).status_code, 403)
        self.assertEqual(self.heads()['public'], before['public'])
        self.browser.cookies.set('egi_moderation', self.people['admin']['token'], path='/moderazione')
        result = self.post(f'/moderazione/servizio/{self.service}/protezione', **data)
        self.assertEqual(result.status_code, 200, result.text[:300])
        self.assertEqual(self.heads()['public'], draft)
        self.assertEqual(self.owner.execute('SELECT actor_id::text FROM governance.contact_protection_resolutions WHERE protection_id=%s',
                                            (protection,)).fetchone()[0], self.people['admin']['actor'])

    def test_large_existing_components_and_ranges_survive_scalar_edit(self):
        """Existing collections above UI insertion bounds are not silently truncated."""
        from tests.test_moderation_workspace import ServiceWorkspaceTests

        before = self.heads()
        body = self.body()
        body['contacts'] = [{'channel_type': 'other', 'value': f'Contact {n}'} for n in range(51)]
        body['schedules'] = [{'scope': 'service', 'timezone': 'Europe/Rome', 'completeness': 'partial',
                              'days': [{'weekday': 1, 'state': 'intervals', 'completeness': 'complete',
                                        'intervals': [{'opens': f'{n:02d}:00', 'closes': f'{n:02d}:30'} for n in range(7)]}]}]
        self.owner.execute("SELECT governance.save_revision('service',%s,%s,%s,%s,'large fixture')",
                           (self.service, before['working'], before['public'], json.dumps(body)))
        before_body = self.body()
        html = self.browser.get(f'/moderazione/servizio/{self.service}').text
        form = ServiceWorkspaceTests.fields(html, f'action="/moderazione/servizio/{self.service}/bozza"')
        form['name'] = 'Only the name changed'
        result = self.post(f'/moderazione/servizio/{self.service}/bozza', **form)
        self.assertEqual(result.status_code, 200, result.text[:300])
        after = self.body()
        self.assertEqual(after['contacts'], before_body['contacts'])
        self.assertEqual(after['schedules'][0]['days'][0]['intervals'], before_body['schedules'][0]['days'][0]['intervals'])

    def test_invalid_hours_keep_other_unsaved_schedule_values(self):
        """A half-filled range does not discard another day's valid but unsaved correction."""
        from tests.test_moderation_workspace import ServiceWorkspaceTests

        html = self.browser.get(f'/moderazione/servizio/{self.service}').text
        form = ServiceWorkspaceTests.fields(html, f'action="/moderazione/servizio/{self.service}/bozza"')
        form.update(schedule_0_scope='service', schedule_0_day_1_state='intervals',
                    schedule_0_day_1_0_opens='10:00', schedule_0_day_1_0_closes='',
                    schedule_0_day_2_state='intervals', schedule_0_day_2_0_opens='11:00', schedule_0_day_2_0_closes='15:00')
        before = self.heads()
        result = self.post(f'/moderazione/servizio/{self.service}/bozza', **form)
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.heads(), before)
        restored = ServiceWorkspaceTests.fields(result.text, f'action="/moderazione/servizio/{self.service}/bozza"')
        for name in ('schedule_0_day_1_0_opens', 'schedule_0_day_2_0_opens', 'schedule_0_day_2_0_closes'):
            self.assertEqual(restored[name], form[name])
