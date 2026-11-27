"""Controlled CW1 cards-to-groups-to-selective-publication journey on owned fixtures."""
from copy import deepcopy
import json
from time import perf_counter
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient

from app.backend.api.moderation import auth
from tests.native import REPOSITORY
from tests import test_workbench_worker_native as workbench
from tests import test_community_worker_native as worker_fixture
from tests.test_workbench_provider import abstention, response


@unittest.skipUnless(REPOSITORY, 'needs an explicitly verified disposable EGI_DATABASE_REPO')
class WorkbenchJourneyNativeTests(unittest.TestCase):
    """Reuse actual worker/card helpers without inheriting their older test cases."""

    @classmethod
    def setUpClass(cls):
        """Allocate and deploy this test's own controlled worker/editorial fixture."""
        workbench.WorkbenchWorkerNativeTests.setUpClass.__func__(cls)

    setUp = workbench.WorkbenchWorkerNativeTests.setUp
    post = workbench.WorkbenchWorkerNativeTests.post
    worker = workbench.WorkbenchWorkerNativeTests.worker
    cards = workbench.WorkbenchWorkerNativeTests.cards
    plan = workbench.WorkbenchWorkerNativeTests.plan
    coverage = workbench.WorkbenchWorkerNativeTests.coverage
    start = workbench.WorkbenchWorkerNativeTests.start
    editorial = workbench.WorkbenchWorkerNativeTests.editorial

    def get_version(self, workspace, item):
        """Read an exact current owned item version through its normal HTTP route."""
        result = self.client.get(worker_fixture.BASE + '/preparazioni/' + workspace + '/schede/' + item)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()['version']

    def save_payload(self, workspace, item, version, payload):
        """Save one explicit fixture edit through the same typed/CSRF application seam."""
        result = self.post('/preparazioni/' + workspace + '/schede', {'changes': [
            {'item_id': item, 'expected_version': version, 'payload': payload}], 'request_key': str(uuid4())})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()['items'][0]['after']

    def admin_post(self, client, path, body):
        """Use the existing independently authenticated Admin session and CSRF token."""
        headers = {'origin': 'http://testserver', 'X-EGI-Form-Token': auth.form_token(worker_fixture.SECRET, auth.token_hash('admin'))}
        return client.post(path, json=body, headers=headers)

    def drain(self, worker):
        """Run at most the declared small fixture envelope, with no live transport."""
        for _ in range(12):
            if worker.run_once() is None:
                return
        self.fail('controlled declared jobs did not drain within the fixture bound')

    def test_existing_cards_analysis_groups_undo_snapshot_and_explicit_publication(self):
        """Keep partial coverage, human choices, compensation and canonical proof distinct."""
        workspace, items = self.cards(count=3)
        path = '/preparazioni/' + workspace
        plan = self.plan(workspace, items, max_output=2000)
        self.assertEqual(plan['total_packets'], 3)
        calls, chosen, omitted, comparisons = [], {}, [], []

        def handler(message):
            """Return one valid interpretation, an abstention, one missing basis, then comparison."""
            packet = json.loads(json.loads(message.content)['input'][0]['content'][0]['text'])
            calls.append(packet)
            output = abstention(packet)
            if packet['task'] == 'classify_cards':
                if not chosen:
                    basis = next(basis for basis in packet['data']['bases'] if basis['kind'] == 'description')
                    proposal = next(proposal for proposal in output['proposals'] if proposal['basis_key'] == basis['basis_key'])
                    proposal.update(state='proposed', missing_context=[], choices=[{'candidate_key': packet['catalog_context']['entries'][0]['candidate_key'],
                        'reason': 'Controlled interpretation requiring human review', 'support_keys': basis['support_keys']}])
                    chosen.update(item=basis['record_key'], packet=packet['packet_key'], key=proposal['proposal_key'], target=packet['catalog_context']['entries'][0]['target'])
                elif len(calls) == 3:
                    omitted.append(output['proposals'][-1]['basis_key'])
                    output['proposals'].pop()
            else:
                comparisons.append(packet)
                labels = packet['data']['labels']
                self.assertTrue(labels)
                keys = [label['unit_key'] for label in labels]
                supports = sorted({support for label in labels for occurrence in label['occurrences'] for support in occurrence['support_keys']})
                output['proposals'] = [{'proposal_key': 'semantic-group', 'relation': 'equivalent', 'unit_keys': keys,
                    'membership_issues': [], 'choices': [{'candidate_key': packet['catalog_context']['entries'][0]['candidate_key'],
                    'reason': 'Controlled proposed common category', 'support_keys': supports}],
                    'reason': 'Controlled semantic comparison, not a quality claim', 'support_keys': supports}]
                output['unit_results'][0].update(state='analyzed', proposal_keys=['semantic-group'], diagnostics=[])
            return response(output)

        self.start(workspace, plan)
        controlled = self.worker(handler)
        self.drain(controlled)
        first = self.coverage(workspace, plan)
        self.assertEqual(first['record_coverage']['partial_records'], 1)
        self.assertFalse(comparisons, 'a missing basis cannot grant comparison coverage')
        continued = self.post(path + '/piani/' + plan['plan_id'] + '/continua', {'version': plan['version'], 'request_key': str(uuid4())})
        self.assertEqual(continued.status_code, 202, continued.text)
        self.drain(controlled)
        self.assertEqual(len(calls), 5)
        self.assertEqual(len(comparisons), 1)
        self.assertEqual(self.coverage(workspace, plan)['progress'], 'finished')
        self.assertTrue(comparisons[0]['data']['prior_proposals'])

        # Persist a retained AI proposal before any card changes. It assigns nothing.
        bases = self.post(path + '/gruppi/basi', {'item_ids': items, 'offset': 0, 'limit': 100})
        self.assertEqual(bases.status_code, 200, bases.text)
        literal_members = [row['member'] for row in bases.json()['bases'] if row['origin'] == 'source_fact']
        packet = comparisons[0]
        context = {**packet['catalog_context']['context'], 'catalog_digest': packet['catalog_context']['digest'], 'as_of': packet['catalog_context']['as_of']}
        revision = {'group_id': str(uuid4()), 'version': str(uuid4()), 'parent_versions': [], 'preparation_id': workspace,
            'context': context, 'members': literal_members, 'mapping': None, 'state': 'proposed', 'method': 'ai',
            'proposal_id': packet['packet_key'] + ':semantic-group'}
        proposed = self.post(path + '/gruppi', {'expected_version': None, 'revision': revision, 'request_key': str(uuid4())})
        self.assertEqual(proposed.status_code, 201, proposed.text)
        self.assertFalse(self.get_version(workspace, chosen['item'])['payload']['service'].get('classifications'))

        # Select one original description proposal as unconfirmed v3 interpretation.
        job = self.owner.execute('SELECT job_id::text FROM preparation.packet_jobs WHERE packet_id=%s', (chosen['packet'],)).fetchone()[0]
        current = self.get_version(workspace, chosen['item'])
        selected = self.post(path + '/lavori/' + job + '/schede/' + chosen['item'] + '/proposte', {
            'expected_version': current['id'], 'proposal_keys': [chosen['key']], 'request_key': str(uuid4())})
        self.assertEqual(selected.status_code, 200, selected.text)
        current = self.get_version(workspace, chosen['item'])
        self.assertEqual(current['payload']['schema_version'], 3)
        self.assertEqual(current['payload']['interpreted_classifications'][0]['state'], 'proposed')
        self.assertFalse(current['payload']['service'].get('classifications'))

        # A manual correction stays protected when an explicit group mapping is applied.
        protected = next(item for item in items if item != chosen['item'])
        value = self.get_version(workspace, protected)
        value['payload']['source_facts'][0]['value'] = 'A human correction to preserve'
        value['payload']['field_origins']['/source_facts/0/value'] = {'state': 'manual'}
        self.save_payload(workspace, protected, value['id'], value['payload'])
        bases = self.post(path + '/gruppi/basi', {'item_ids': items, 'offset': 0, 'limit': 100}).json()['bases']
        manual = deepcopy(revision)
        manual.update(version=str(uuid4()), parent_versions=[revision['version']], members=[row['member'] for row in bases],
            mapping=chosen['target'], state='accepted', method='manual', proposal_id=None)
        accepted = self.post(path + '/gruppi', {'expected_version': revision['version'], 'revision': manual, 'request_key': str(uuid4())})
        self.assertEqual(accepted.status_code, 201, accepted.text)
        started = perf_counter()
        applied = self.post(path + '/gruppi/' + revision['group_id'] + '/applica', {
            'expected_group_version': manual['version'], 'selection': manual['members'], 'request_key': str(uuid4())})
        apply_ms = (perf_counter() - started) * 1000
        self.assertEqual(applied.status_code, 200, applied.text)
        receipt = applied.json()
        self.assertEqual(receipt['summary']['applied'], 2)
        self.assertEqual(receipt['summary']['skipped'], 1)
        self.assertEqual(self.get_version(workspace, chosen['item'])['payload']['interpreted_classifications'][0]['state'], 'confirmed')
        started = perf_counter()
        undo = self.post(path + '/gruppi/operazioni/' + receipt['operation_id'] + '/annulla', {'request_key': str(uuid4())})
        undo_ms = (perf_counter() - started) * 1000
        self.assertEqual(undo.status_code, 200, undo.text)
        self.assertEqual(undo.json()['summary']['applied'], 2)
        current = self.get_version(workspace, chosen['item'])
        self.assertEqual(current['payload']['schema_version'], 3)
        self.assertEqual(current['payload']['interpreted_classifications'][0]['state'], 'proposed')
        self.assertFalse(current['payload']['service'].get('classifications'))
        self.assertEqual(self.get_version(workspace, protected)['payload']['source_facts'][0]['value'], 'A human correction to preserve')
        operations = self.client.get(worker_fixture.BASE + path + '/gruppi/operazioni?offset=0&limit=1')
        self.assertEqual(operations.status_code, 200, operations.text)
        self.assertEqual(len(operations.json()['operations']), 1)
        self.assertIsNotNone(operations.json()['next_offset'])

        # Freeze exactly one submitted card. Sibling notes never enter moderation.
        current['payload']['service']['delivery_mode'] = 'telephone'
        current['payload']['field_origins']['/service/delivery_mode'] = {'state': 'manual'}
        current['payload']['outcome'] = 'confirmed'
        head = self.save_payload(workspace, chosen['item'], current['id'], current['payload'])
        submitted = self.post(path + '/invii', {'items': [{'item_id': chosen['item'], 'expected_version': head}], 'request_key': str(uuid4())})
        self.assertEqual(submitted.status_code, 200, submitted.text)
        contribution = submitted.json()['items'][0]['receipt']['contribution_id']
        admin = TestClient(self.app)
        admin.__enter__()
        self.addCleanup(admin.__exit__, None, None, None)
        admin.cookies.set('egi_moderation', 'admin', path='/moderazione')
        self.assertEqual(admin.get(worker_fixture.BASE + path).status_code, 404)
        detail = admin.get('/moderazione/contributo/' + contribution)
        self.assertEqual(detail.status_code, 200, detail.text[:300])
        self.assertIn('interpretation_support', detail.text)
        self.assertNotIn('A human correction to preserve', detail.text)
        self.assertNotIn('original_base64', detail.text)
        target = chosen['target']
        service = {'name': 'CW1 explicitly reviewed service', 'description': 'Controlled synthetic service, explicitly checked by the fixture moderator.',
            'delivery_mode': 'telephone', 'contacts': [{'channel_type': 'phone', 'value': '0600000000', 'is_public': True}], 'territories': [context['territory_id']],
            'classifications': [{'adoption_id': target['adoption_id'], 'term_id': target['term_id']}]}
        decision = {'schema_version': 2, 'expected_service_work': None, 'expected_service_public': None,
            'service_operations': [{'op': 'add', 'path': '/' + key, 'value': value, 'evidence_ids': []} for key, value in service.items()],
            'fact_actions': [{'fact_id': fact['fact_id'], 'action': 'keep'} for fact in current['payload']['source_facts']],
            'location': {'kind': 'none'}, 'reason': 'Controlled explicit moderator interpretation',
            'observations': [{'paths': ['/service/' + key for key in service], 'method': 'other', 'note': 'Controlled human interpretation from frozen context; category, description and explicitly public synthetic telephone channel checked by the fixture moderator.'}]}
        canonical = self.admin_post(admin, '/moderazione/contributo/' + contribution + '/accetta-community', {'decision': decision, 'request_key': str(uuid4())})
        self.assertEqual(canonical.status_code, 200, canonical.text)
        result = canonical.json()
        body = self.owner.execute('SELECT editorial.revision_body(%s)', (result['initial_revision_id'],)).fetchone()[0]
        for evidence in body['classifications'][0]['evidence']:
            method = self.owner.execute('SELECT method FROM sources.assertions WHERE assertion_id=%s', (evidence['assertion_id'],)).fetchone()[0]
            self.assertEqual(method, 'editorial_other')
        self.assertIsNone(self.owner.execute('SELECT revision_id FROM governance.published_heads WHERE entity_id=%s', (result['service_id'],)).fetchone())
        snapshot_source = self.owner.execute('SELECT source_id::text FROM editorial.community_snapshots WHERE contribution_id=%s', (contribution,)).fetchone()[0]
        editorial_source = self.owner.execute("SELECT source_id::text FROM sources.registry WHERE code='egi_editorial'").fetchone()[0]
        for source in (snapshot_source, editorial_source):
            admitted = self.admin_post(admin, worker_fixture.BASE + '/fonti/' + source + '/ammetti', {'reason': 'Controlled disposable journey admission'})
            self.assertEqual(admitted.status_code, 200, admitted.text)
        published = admin.post('/moderazione/servizio/' + result['service_id'] + '/pubblica', data={
            'working': result['initial_revision_id'], 'public': '', 'summary': 'Controlled explicit publication',
            'form_token': auth.form_token(worker_fixture.SECRET, auth.token_hash('admin'))}, headers={'origin': 'http://testserver'}, follow_redirects=False)
        self.assertEqual(published.status_code, 303, published.text[:300])
        public = admin.get('/api/public/services/' + result['service_id'])
        self.assertEqual(public.status_code, 200, public.text)
        self.assertIn('CW1 explicitly reviewed service', public.text)
        self.assertNotIn('A human correction to preserve', public.text)
        print('CW1 controlled group HTTP timings: apply4members/3cards=' + format(apply_ms, '.3f') + 'ms; undo2cards=' + format(undo_ms, '.3f') + 'ms')

    def test_manual_variants_work_without_ia_and_do_not_expose_private_contacts(self):
        """Local literal variants are bounded owned reads, not provider eligibility or dispatch."""
        workspace, items = self.cards(count=2)
        path = '/preparazioni/' + workspace
        current = self.get_version(workspace, items[0])
        current['payload']['service']['contacts'] = [{'channel_type': 'phone', 'value': 'PRIVATE-CONTACT-0612345', 'is_public': False}]
        current['payload']['field_origins']['/service/contacts'] = {'state': 'manual'}
        self.save_payload(workspace, items[0], current['id'], current['payload'])
        self.owner.execute('UPDATE preparation.ai_settings SET enabled=false')
        contexts = self.post(path + '/catalogo', {'query': {'kind': 'taxonomy_context'}}).json()['entries']
        selected = contexts[0]
        body = {'item_ids': items, 'territory_id': selected['territory_id'], 'axis_id': selected['axis_id'],
            'offset': 0, 'limit': 1, 'member_offset': 0, 'member_limit': 1}
        first = self.post(path + '/gruppi/varianti', body)
        self.assertEqual(first.status_code, 200, first.text)
        value = first.json()
        self.assertEqual(value['total'], 1)
        self.assertEqual(value['groups'][0]['total_members'], 2)
        self.assertEqual(len(value['groups'][0]['members']), 1)
        self.assertEqual(value['groups'][0]['next_member_offset'], 1)
        self.assertNotIn('PRIVATE-CONTACT', first.text)
        second = self.post(path + '/gruppi/varianti', {**body, 'member_offset': 1})
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()['groups'][0]['variant_key'], value['groups'][0]['variant_key'])
        self.assertNotEqual(second.json()['groups'][0]['members'][0]['item_id'], value['groups'][0]['members'][0]['item_id'])
        self.assertIsNone(second.json()['groups'][0]['next_member_offset'])
        basis = self.post(path + '/gruppi/basi', {'item_ids': items, 'offset': 0, 'limit': 1})
        self.assertEqual(basis.status_code, 200, basis.text)
        self.assertEqual(basis.json()['total'], 2)
        self.assertEqual(basis.json()['next_offset'], 1)
        self.assertNotIn('PRIVATE-CONTACT', basis.text)
        self.assertEqual(self.owner.execute('SELECT count(*) FROM preparation.jobs WHERE workspace_id=%s', (workspace,)).fetchone()[0], 0)
        invalid = self.post(path + '/gruppi/basi', {'item_ids': items, 'offset': True, 'limit': 1})
        self.assertEqual(invalid.status_code, 422)
