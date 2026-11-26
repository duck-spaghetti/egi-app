"""The service workspace: edit, save a draft, compare and publish (EGI-83); hours,
locations and new services (EGI-84).

Needs EGI_DATABASE_REPO (see tests/native.py) with 013_editorial_observations. The
canonical fixture's "Public service" has a public and a private phone; the private one
stays protected even when a moderator marks it public.
"""
import getpass
import json
import re
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
import psycopg

from app.backend.api.moderation.desk import Refused
from app.backend.api.moderation.hours import edited_schedules
from app.backend.api.moderation.workspace import edited
from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.config import Configuration, DirectorySettings, EditorialSettings, profile
from app.backend.main import create_app
from tests.native import REPOSITORY, Cluster, people

ORIGIN = {'origin': 'http://testserver'}
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(REPOSITORY, 'needs explicit EGI_DATABASE_REPO native schema fixture')
class ServiceWorkspaceTests(unittest.TestCase):
    """Two moderators edit the same service; only publication changes the public card."""

    @classmethod
    def setUpClass(cls):
        """Deploy, load the public fixture and create the people."""
        cls.cluster = Cluster(65444, 'egi_moderation_workspace')
        cls.addClassCleanup(cls.cluster.close)
        cls.cluster.file(Path(REPOSITORY)/'tests/contract/fixtures.sql', Path(REPOSITORY)/'tests/contract/helpers.sql',
                         ROOT/'tests/canonical-fixture.sql')
        cls.cluster.sql('CREATE ROLE egi_test_desk LOGIN IN ROLE egi_editorial')
        cls.people = people(cls.cluster, 'egi_test_desk')
        cls.owner = psycopg.connect(cls.cluster.dsn(getpass.getuser()), autocommit=True)
        cls.addClassCleanup(cls.owner.close)
        cls.service = cls.owner.execute("""SELECT h.entity_id::text FROM governance.published_heads h JOIN data.services USING(entity_id)
            JOIN data.service_revisions r USING(revision_id) JOIN i18n.content_units n ON n.content_id=r.name_content_id
            WHERE n.original_text='Public service'""").fetchone()[0]
        with cls.owner.transaction():  # a service with a real private number, published as the fixture's editor
            territory = cls.owner.execute("SELECT entity_id::text FROM governance.entity_revisions WHERE entity_kind='territory' LIMIT 1").fetchone()[0]
            revision = cls.owner.execute("""SELECT governance.save_revision('service',NULL,NULL,NULL,
                jsonb_build_object('territories',jsonb_build_array(%s::uuid))||'{"name":"Protected service","description":"Has a private number","delivery_mode":"telephone","original_language":"it",
                  "contacts":[{"channel_type":"phone","value":"06 1111111"},{"channel_type":"phone","value":"06 99999999","is_public":false}],
                  "evidence":{"record":[{"assertion_id":"57000000-0000-0000-0000-000000000001","role":"supporting"}]}}','test')""",
                (territory,)).fetchone()[0]
            decision = cls.owner.execute("SELECT governance.review_revision(%s,NULL,'approved','test')", (revision,)).fetchone()[0]
            cls.owner.execute('SELECT governance.publish_revision(%s,%s,NULL)', (revision, decision))
            cls.protected = cls.owner.execute('SELECT entity_id::text FROM governance.entity_revisions WHERE revision_id=%s',
                                              (revision,)).fetchone()[0]
            cls.territory = territory
            # Two published locations; two services share the first.
            cls.shared, cls.other = (cls.publish(f"""SELECT governance.save_revision('location',NULL,NULL,NULL,
                jsonb_build_object('name',%s::text,'location_kind','building','coordinate_state','unknown','territories',jsonb_build_array(%s::uuid),
                  'evidence','{{"record":[{{"assertion_id":"57000000-0000-0000-0000-000000000001","role":"supporting"}}]}}'::jsonb),'test')""",
                (name, territory)) for name in ('Casa comune', 'Altra sede'))
            cls.first, cls.second = (cls.publish("""SELECT governance.save_revision('service',NULL,NULL,NULL,
                jsonb_build_object('name',%s::text,'description','Shared place','delivery_mode','in_person','territories',jsonb_build_array(%s::uuid),
                  'place',jsonb_build_object('location_id',%s::uuid),
                  'evidence','{"record":[{"assertion_id":"57000000-0000-0000-0000-000000000001","role":"supporting"}]}'::jsonb),'test')""",
                (name, territory, cls.shared)) for name in ('First tenant', 'Second tenant'))
        errors = tempfile.TemporaryDirectory()
        cls.addClassCleanup(errors.cleanup)
        cls.app = create_app(Configuration(profile(), canonical=True, error_dir=Path(errors.name),
            directory=DirectorySettings(database_url=cls.cluster.dsn('egi_app_test_reader')),
            editorial=EditorialSettings(database_url=cls.cluster.dsn('egi_test_desk'), cookie_secret='s' * 40, secure_cookie=False)),
            {'source': StaticSubjectSource([])})

    @classmethod
    def publish(cls, statement: str, params: tuple) -> str:
        """Save and publish one revision as the fixture's editor; return its entity."""
        revision = cls.owner.execute(statement, params).fetchone()[0]
        decision = cls.owner.execute("SELECT governance.review_revision(%s,NULL,'approved','test')", (revision,)).fetchone()[0]
        cls.owner.execute('SELECT governance.publish_revision(%s,%s,NULL)', (revision, decision))
        return cls.owner.execute('SELECT entity_id::text FROM governance.entity_revisions WHERE revision_id=%s', (revision,)).fetchone()[0]

    def published(self, entity: str) -> tuple:
        """Return an entity's published revision and the location its service points at."""
        return self.owner.execute("""SELECT h.revision_id::text,p.location_id::text,pub.actor_id::text FROM governance.published_heads h
            JOIN governance.publications pub USING(publication_id) LEFT JOIN data.service_places p ON p.revision_id=h.revision_id
            WHERE h.entity_id=%s""", (entity,)).fetchone()

    def card(self, service: str) -> dict:
        """Return a service's public card."""
        response = self.browser(None).get(f'/api/public/services/{service}')
        self.assertEqual(response.status_code, 200, response.text[:300])
        return response.json()

    def browser(self, login: str | None) -> TestClient:
        """Return a client signed in as `login` (or anonymous)."""
        client = TestClient(self.app)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        if login:
            client.cookies.set('egi_moderation', self.people[login]['token'], path='/moderazione')
        return client

    @staticmethod
    def fields(page: str, form: str) -> dict:
        """Return the named inputs, textareas and selected options of one form on a page."""
        start = page.index(f'action="/moderazione/servizio/') if form == 'any' else page.index(form)
        html = page[start:page.index('</form>', start)]
        found = {name: value for name, value in re.findall(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', html)}
        found = {k: v for k, v in found.items() if not re.search(rf'<input type="checkbox" name="{re.escape(k)}"', html)}
        found.update(re.findall(r'<input type="checkbox" name="([^"]+)" value="(1)"[^>]*checked', html))
        found.update({name: value.strip() for name, value in re.findall(r'<textarea name="([^"]+)"[^>]*>([^<]*)</textarea>', html)})
        for name, options in re.findall(r'<select name="([^"]+)"[^>]*>(.*?)</select>', html, re.S):
            chosen = re.search(r'<option value="([^"]*)"\s*selected', options) or re.search(r'<option value="([^"]*)"', options)
            found[name] = chosen.group(1) if chosen else ''
        return found

    def workspace(self, client: TestClient) -> str:
        """Open the service's workspace."""
        page = client.get(f'/moderazione/servizio/{self.service}')
        self.assertEqual(page.status_code, 200, page.text[:500])
        return page.text

    def edit_form(self, page: str) -> dict:
        """Return the draft form's current values."""
        return self.fields(page, f'action="/moderazione/servizio/{self.service}/bozza"')

    def publish_form(self, page: str) -> dict:
        """Return the publish form's values."""
        return self.fields(page, f'action="/moderazione/servizio/{self.service}/pubblica"')

    def public(self) -> str:
        """Return the public card's JSON text, without the instants it was evaluated at."""
        text = self.browser(None).get(f'/api/public/services/{self.service}').text
        return re.sub(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?[+-]\d\d:\d\d', 'INSTANT', text)

    def latest(self) -> tuple:
        """Return the working head's actor and evidence of its description."""
        return self.owner.execute("""SELECT r.actor_id::text,(SELECT count(*) FROM governance.value_decisions d
            JOIN governance.value_evidence e USING(value_decision_id) WHERE d.revision_id=r.revision_id AND d.field_code='description')
            FROM governance.working_heads w JOIN governance.entity_revisions r USING(revision_id) WHERE w.entity_id=%s""",
                                  (self.service,)).fetchone()

    def test_edit_save_compare_publish(self):
        """A draft changes nothing public; publication does, attributed to the person; stale work is refused."""
        self.assertEqual(self.browser(None).get('/moderazione/servizi', follow_redirects=False).status_code, 303)
        mod1, mod2 = self.browser('mod1'), self.browser('mod2')
        found = mod1.get('/moderazione/servizi', params={'q': 'service'}).text
        self.assertIn(f'/moderazione/servizio/{self.service}', found)
        self.assertIn('Never approved', mod1.get('/moderazione/servizi', params={'q': 'never'}).text, 'unpublished drafts are found')

        page = self.workspace(mod1)
        self.assertIn('synthetic service', page, 'the source text is shown')
        self.assertIn('nessuna bozza', page)
        self.assertIn('name="schedule_0_scope"', page, 'hours are edited here')
        before = self.public()
        self.assertIn('Approved description', before)
        self.assertNotIn('PRIVATE999', before)

        form = self.edit_form(page)
        self.assertEqual(form['name'], 'Public service')
        stale_mod2 = self.edit_form(self.workspace(mod2))  # built on the same revisions
        form.update({'description': 'Descrizione corretta',
                     'contact_2_channel': 'email', 'contact_2_value': 'info@example.invalid',
                     'condition_0_kind': 'appointment', 'condition_0_state': 'required', 'condition_0_details': 'Chiamare prima'})
        self.assertEqual(mod1.post(f'/moderazione/servizio/{self.service}/bozza', data=form, headers=ORIGIN,
                                   follow_redirects=False).status_code, 303)
        self.assertEqual(self.public(), before, 'a draft changes nothing public')
        actor, evidence = self.latest()
        self.assertEqual(actor, self.people['mod1']['actor'], 'the draft is the signed-in person\'s')
        self.assertEqual(evidence, 0, "the moderator's description cites no source")

        page = self.workspace(mod1)
        self.assertIn('Descrizione corretta', page)
        self.assertIn('modificato', page, 'the comparison marks the change')
        unchanged = self.edit_form(page)
        self.assertIn('Non hai modificato nulla', mod1.post(f'/moderazione/servizio/{self.service}/bozza',
                      data=unchanged, headers=ORIGIN).text)

        stale_mod2['description'] = 'Versione di Mod Two'
        refused = mod2.post(f'/moderazione/servizio/{self.service}/bozza', data=stale_mod2, headers=ORIGIN)
        self.assertEqual(refused.status_code, 409)
        self.assertIn('versione più recente', refused.text)
        self.assertIn('Versione di Mod Two', refused.text, 'the refused values stay on the page')
        self.assertEqual(self.latest()[0], self.people['mod1']['actor'], 'nothing was overwritten')

        publish = self.publish_form(page)
        self.assertEqual(mod1.post(f'/moderazione/servizio/{self.service}/pubblica', data={**publish, 'summary': ''},
                                   headers=ORIGIN).status_code, 400)
        stale_publish = self.publish_form(self.workspace(mod2))
        done = mod1.post(f'/moderazione/servizio/{self.service}/pubblica', data={**publish, 'summary': 'Descrizione e contatti'},
                         headers=ORIGIN, follow_redirects=False)
        self.assertEqual(done.status_code, 303, done.text[:500])
        after = self.public()
        self.assertIn('Descrizione corretta', after)
        self.assertIn('info@example.invalid', after)
        self.assertEqual(self.owner.execute("""SELECT p.actor_id::text,d.reason FROM governance.published_heads h
            JOIN governance.publications p USING(publication_id) JOIN governance.review_decisions d ON d.decision_id=p.review_decision_id
            WHERE h.entity_id=%s""", (self.service,)).fetchone(), (self.people['mod1']['actor'], 'Descrizione e contatti'))
        self.assertIn('nessuna bozza', self.workspace(mod1))

        again = mod2.post(f'/moderazione/servizio/{self.service}/pubblica', data={**stale_publish, 'summary': 'Vecchia bozza'},
                          headers=ORIGIN)
        self.assertEqual(again.status_code, 409, 'publishing a draft that is no longer current is refused')
        self.assertIn('Descrizione corretta', self.public())

    def test_a_protected_number_stays_hidden(self):
        """Marking a private number public and publishing it does not show it: only the admin releases it."""
        mod1, url = self.browser('mod1'), f'/moderazione/servizio/{self.protected}'
        form = self.fields(mod1.get(url).text, f'action="{url}/bozza"')
        private = next(k[:-5] for k, v in form.items() if k.endswith('value') and v == '06 99999999')
        form[private + 'public'] = '1'
        self.assertEqual(mod1.post(url + '/bozza', data=form, headers=ORIGIN, follow_redirects=False).status_code, 303)
        page = mod1.get(url).text
        publish = self.fields(page, f'action="{url}/pubblica"')
        self.assertEqual(mod1.post(url + '/pubblica', data={**publish, 'summary': 'Numero reso pubblico'}, headers=ORIGIN,
                                   follow_redirects=False).status_code, 303)
        public = self.browser(None).get(f'/api/public/services/{self.protected}').text
        self.assertIn('06 1111111', public)
        self.assertNotIn('99999999', public, 'the number was protected when it stopped being private')
        self.assertIn('Protezioni attive', mod1.get(url).text, 'the workspace says so')

    def test_post_needs_origin_and_session(self):
        """Forms without Origin or token, or with a malformed revision, are refused."""
        mod1 = self.browser('mod1')
        self.assertEqual(mod1.post(f'/moderazione/servizio/{self.service}/bozza', data={'name': 'x'}).status_code, 403)
        form = self.edit_form(self.workspace(mod1))
        self.assertEqual(mod1.post(f'/moderazione/servizio/{self.service}/bozza', data={**form, 'working': 'nope'},
                                   headers=ORIGIN).status_code, 400)
        self.assertEqual(mod1.get('/moderazione/servizio/00000000-0000-0000-0000-000000000000').status_code, 404)

    def week(self, form: dict, index: int, state: str, opens: str = '', closes: str = '') -> dict:
        """Fill one schedule row of a workspace form with the same day seven times."""
        for day in range(1, 8):
            form[f'schedule_{index}_day_{day}_state'] = state
            form[f'schedule_{index}_day_{day}_0_opens'], form[f'schedule_{index}_day_{day}_0_closes'] = opens, closes
        return form

    def test_create_service_with_location_hours_and_publish(self):
        """A created location and service are drafts until published, cite the editorial source and open as edited."""
        mod1 = self.browser('mod1')
        start = mod1.get('/moderazione/servizi/nuovo').text
        self.assertIn('Prima il luogo', start)
        new = {'form_token': self.fields(start, 'method="post" action="/moderazione/servizi/nuovo"')['form_token'], 'location': 'new', 'location_name': 'Sportello nuovo', 'location_kind': 'building',
               'location_street': 'Via Prova 3', 'location_postal_code': '00100', 'location_locality': 'Roma',
               'location_latitude': '41,9', 'location_longitude': '12.49', 'location_territory': self.territory,
               'territory': self.territory, 'name': 'Servizio nuovo', 'delivery_mode': 'in_person', 'method': ''}
        refused = mod1.post('/moderazione/servizi/nuovo', data=new, headers=ORIGIN)
        self.assertEqual(refused.status_code, 400)
        self.assertIn('Indica come hai verificato', refused.text)
        self.assertIn('Sportello nuovo', refused.text, 'the values stay on the page')
        made = mod1.post('/moderazione/servizi/nuovo', data={**new, 'method': 'phone_call', 'note': 'Sentiti al telefono'},
                         headers=ORIGIN, follow_redirects=False)
        self.assertEqual(made.status_code, 303, made.text[:500])
        service = made.headers['location'].rsplit('/', 1)[1]
        self.assertEqual(self.browser(None).get(f'/api/public/services/{service}').status_code, 404, 'a draft is not public')
        location = self.owner.execute("""SELECT p.location_id::text FROM governance.working_heads w JOIN data.service_places p USING(revision_id)
            WHERE w.entity_id=%s""", (service,)).fetchone()[0]
        self.assertIsNone(self.owner.execute('SELECT revision_id FROM governance.published_heads WHERE entity_id=%s', (location,)).fetchone())
        self.assertEqual(self.owner.execute("""SELECT l.latitude,l.longitude,r.name FROM governance.working_heads w JOIN data.location_revisions l USING(revision_id)
            JOIN governance.value_decisions d ON d.revision_id=w.revision_id JOIN governance.value_evidence e USING(value_decision_id)
            JOIN sources.assertions a USING(assertion_id) JOIN sources.normalized_subjects n USING(subject_id)
            JOIN sources.record_versions v USING(record_version_id) JOIN sources.registry r ON r.source_id=(SELECT source_id FROM sources.datasets WHERE dataset_id=v.dataset_id)
            WHERE w.entity_id=%s LIMIT 1""", (location,)).fetchone(), (41.9, 12.49, 'Redazione EGI'))

        url = f'/moderazione/servizio/{service}'
        page = mod1.get(url).text
        self.assertIn('Sportello nuovo', page)
        self.assertIn('non ancora pubblicato', page)
        form = self.fields(page, f'action="{url}/bozza"')
        form.update(self.week({'description': 'Aperto sempre', 'schedule_0_scope': 'service', 'schedule_0_completeness': 'complete'},
                              0, 'intervals', '00:00', '00:00'))
        self.assertEqual(mod1.post(url + '/bozza', data=form, headers=ORIGIN,
                                   follow_redirects=False).status_code, 303)
        page = mod1.get(url).text
        self.assertIn('Apertura del servizio: Lun 00:00–00:00', page, 'the comparison shows the hours')
        missing = mod1.post(url + '/pubblica', data={**self.fields(page, f'action="{url}/pubblica"'), 'summary': ''}, headers=ORIGIN)
        self.assertEqual(missing.status_code, 400)
        done = mod1.post(url + '/pubblica', data={**self.fields(page, f'action="{url}/pubblica"'), 'summary': 'Nuovo servizio verificato'},
                         headers=ORIGIN, follow_redirects=False)
        self.assertEqual(done.status_code, 303, done.text[:800])
        actor = self.people['mod1']['actor']
        self.assertEqual(self.published(service)[1:], (location, actor), 'published with its place, by the person')
        self.assertEqual(self.published(location)[2], actor, 'the new location was published with it')
        card = self.card(service)
        self.assertEqual(card['canonical_opening']['status'], 'open', json.dumps(card['canonical_opening']))
        self.assertIn('Redazione EGI', [source['name'] for source in card['sources']])
        self.assertEqual(card['place']['id'], location)

        form = self.week(self.fields(mod1.get(url).text, f'action="{url}/bozza"'), 0, 'closed')
        self.assertEqual(mod1.post(url + '/bozza', data=form, headers=ORIGIN, follow_redirects=False).status_code, 303)
        page = mod1.get(url).text
        self.assertEqual(mod1.post(url + '/pubblica', data={**self.fields(page, f'action="{url}/pubblica"'), 'summary': 'Chiuso'},
                                   headers=ORIGIN, follow_redirects=False).status_code, 303)
        self.assertEqual(self.card(service)['canonical_opening']['status'], 'closed')

        form = self.fields(mod1.get(url).text, f'action="{url}/bozza"')
        overlap = mod1.post(url + '/bozza', data=self.week({**form, 'schedule_1_scope': 'service'}, 1, 'unknown'), headers=ORIGIN)
        self.assertEqual(overlap.status_code, 400)
        self.assertIn('stesso pubblico', overlap.text)
        empty = mod1.post(url + '/bozza', data=self.week(dict(form), 0, 'intervals'), headers=ORIGIN)
        self.assertEqual(empty.status_code, 400)
        self.assertIn('Orari non validi', empty.text)

    def test_moving_a_service_leaves_its_old_location_and_neighbours(self):
        """A service moved to another location changes alone: the old location and its other service stay."""
        mod1, url = self.browser('mod1'), f'/moderazione/servizio/{self.first}'
        before = {entity: self.published(entity) for entity in (self.shared, self.other, self.second)}
        page = mod1.get(url, params={'luogo': 'Altra'}).text
        self.assertIn('Altra sede', page)
        choice = self.fields(page, f'action="{url}/luogo"')
        self.assertEqual(choice['location'], self.other)
        self.assertEqual(mod1.post(url + '/luogo', data=choice, headers=ORIGIN, follow_redirects=False).status_code, 303)
        page = mod1.get(url).text
        self.assertEqual(mod1.post(url + '/pubblica', data={**self.fields(page, f'action="{url}/pubblica"'), 'summary': 'Trasferito'},
                                   headers=ORIGIN, follow_redirects=False).status_code, 303)
        self.assertEqual(self.published(self.first)[1], self.other)
        self.assertEqual({entity: self.published(entity) for entity in before}, before, 'nothing else changed')
        self.assertEqual(self.card(self.second)['place']['id'], self.shared)


class EditedBodyTests(unittest.TestCase):
    """The form-to-body mapping, without a database."""

    BASE = {'name': 'Mensa', 'original_language': 'it', 'delivery_mode': 'in_person',
            'contacts': [{'component_id': 'c1', 'channel_type': 'phone', 'value': '06 1', 'normalized_value': '+3961',
                          'is_public': True, 'sort_order': 1, 'evidence': [{'assertion_id': 'a1', 'role': 'supporting'}]}],
            'classifications': [{'adoption_id': 'ad', 'term_id': 't1', 'evidence': [{'assertion_id': 'a2'}]}], 'conditions': [],
            'evidence': {'record': [{'assertion_id': 'a0'}], 'name': [{'assertion_id': 'a0'}]}}
    TERMS = [{'adoption_id': 'ad', 'term_id': 't1', 'name': 'Cibo'}, {'adoption_id': 'ad', 'term_id': 't2', 'name': 'Casa'}]
    FORM = {'name': 'Mensa', 'delivery_mode': 'in_person', 'contacts': '2', 'contact_0_component': 'c1',
            'contact_0_channel': 'phone', 'contact_0_value': '06 1', 'contact_0_public': '1', 'conditions': '1',
            'needs': '1', 'need_ad_t1': '1'}

    def test_an_unchanged_form_gives_the_same_body(self):
        """Nothing changed, nothing to save."""
        self.assertEqual(edited(self.BASE, self.FORM, self.TERMS), self.BASE)

    def test_changed_values_cite_no_source_and_untouched_ones_keep_theirs(self):
        """A moderator's value has empty evidence; components keep their identifiers."""
        body = edited(self.BASE, {**self.FORM, 'name': 'Mensa nuova', 'contact_0_value': '06 2', 'need_ad_t2': '1'}, self.TERMS)
        self.assertEqual((body['name'], body['evidence']['name'], body['evidence']['record']), ('Mensa nuova', [], [{'assertion_id': 'a0'}]))
        self.assertEqual(body['contacts'], [{'component_id': 'c1', 'channel_type': 'phone', 'value': '06 2', 'is_public': True,
                                             'sort_order': 1, 'evidence': []}])
        self.assertEqual(body['classifications'], [self.BASE['classifications'][0], {'adoption_id': 'ad', 'term_id': 't2', 'evidence': []}])

    def test_missing_lists_stay_and_a_component_counts_once(self):
        """A form without a list leaves it; a repeated component is not saved twice."""
        form = {key: value for key, value in self.FORM.items() if key not in ('contacts', 'needs')}
        body = edited(self.BASE, form, self.TERMS)
        self.assertEqual((body['contacts'], body['classifications']), (self.BASE['contacts'], self.BASE['classifications']))
        twice = {**self.FORM, 'contacts': '2', 'contact_1_component': 'c1', 'contact_1_channel': 'phone', 'contact_1_value': '06 9'}
        self.assertEqual([c.get('component_id') for c in edited(self.BASE, twice, self.TERMS)['contacts']], ['c1', None])


class EditedSchedulesTests(unittest.TestCase):
    """The hours form, without a database."""

    SCHEDULE = {'component_id': 's1', 'scope': 'service', 'timezone': 'Europe/Rome', 'completeness': 'complete',
                'evidence': [{'assertion_id': 'a1', 'role': 'supporting'}],
                'days': [{'weekday': day, 'state': 'intervals' if day == 1 else 'closed', 'completeness': 'complete',
                          'intervals': [{'component_id': 'i1', 'opens': '09:00', 'closes': '12:00', 'end_day_offset': 0,
                                         'evidence': [{'assertion_id': 'a2', 'role': 'supporting'}]}] if day == 1 else []}
                         for day in range(1, 8)]}
    BASE = {'schedules': [SCHEDULE], 'calendar_links': [{'schedule_id': 's1', 'calendar_id': 'c1', 'effects': []}]}

    def form(self, **changes) -> dict:
        """Return the form the workspace shows for BASE, with `changes`."""
        form = {'schedules': '2', 'schedule_0_component': 's1', 'schedule_0_scope': 'service', 'schedule_0_slots': '2',
                'schedule_0_completeness': 'complete', 'schedule_1_scope': '', 'schedule_1_slots': '2'}
        for day in range(1, 8):
            form[f'schedule_0_day_{day}_state'] = 'intervals' if day == 1 else 'closed'
            form[f'schedule_1_day_{day}_state'] = 'unknown'
        form.update({'schedule_0_day_1_0_opens': '09:00', 'schedule_0_day_1_0_closes': '12:00'})
        return {**form, **changes}

    def test_an_unchanged_form_keeps_schedules_and_calendars(self):
        """Nothing changed, nothing to save; calendar exceptions stay."""
        self.assertEqual(edited_schedules(self.BASE, self.form(), []), (self.BASE['schedules'], self.BASE['calendar_links']))

    def test_a_new_range_is_the_moderators_and_the_kept_one_keeps_its_source(self):
        """A night range ends the next day; untouched ranges keep component and evidence."""
        schedules, links = edited_schedules(self.BASE, self.form(schedule_0_day_1_1_opens='22:00', schedule_0_day_1_1_closes='02:00'), [])
        monday = schedules[0]['days'][0]
        self.assertEqual(monday['intervals'], [self.SCHEDULE['days'][0]['intervals'][0],
                                               {'opens': '22:00', 'closes': '02:00', 'end_day_offset': 1, 'evidence': []}])
        self.assertEqual((schedules[0]['evidence'], schedules[0]['component_id'], links), ([], 's1', self.BASE['calendar_links']))

    def test_refusals(self):
        """Overlapping audiences, contact hours without a saved contact, broken ranges; removal drops calendars."""
        with self.assertRaisesRegex(Refused, 'schedule_overlap'):
            edited_schedules(self.BASE, self.form(schedule_1_scope='service'), [])
        seasonal = edited_schedules(self.BASE, self.form(schedule_0_until='2026-06-30', schedule_1_scope='service',
                                                         schedule_1_from='2026-07-01'), [])[0]
        self.assertEqual(len(seasonal), 2, 'seasonal schedules of one audience may follow each other')
        with self.assertRaisesRegex(Refused, 'schedule_contact'):
            edited_schedules(self.BASE, self.form(schedule_1_scope='contact', schedule_1_contact='x'), [{'component_id': 'c9'}])
        with self.assertRaisesRegex(Refused, 'invalid_hours'):
            edited_schedules(self.BASE, self.form(schedule_0_day_1_0_closes='25:00'), [])
        with self.assertRaisesRegex(Refused, 'invalid_hours'):
            edited_schedules(self.BASE, self.form(schedule_0_day_1_0_opens='', schedule_0_day_1_0_closes=''), [])
        self.assertEqual(edited_schedules(self.BASE, self.form(schedule_0_remove='1'), []), ([], []))
