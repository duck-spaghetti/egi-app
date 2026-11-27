"""Exercise the same controlled workbench journeys through protected HTTP contracts."""
from copy import deepcopy
import json
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient

from app.backend.api.moderation import auth
from tests import test_community_worker_native as legacy
from tests import test_workbench_worker_native as worker_tests
from tests.native import REPOSITORY
from tests.test_workbench_provider import abstention, response


@unittest.skipUnless(REPOSITORY, 'needs an explicit disposable EGI_DATABASE_REPO')
class WorkbenchHttpTests(worker_tests.WorkbenchWorkerNativeTests):
    """Reuse worker outcomes while replacing every plan-control call with actual HTTP."""

    def checked(self, response, status=200):
        """Assert the shared protected JSON response boundary before returning its body."""
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
        return response.json()

    def editorial(self, statement, parameters):
        """Bridge only the fixed plan contracts used by the shared journey to HTTP."""
        workspace = str(parameters[0])
        path = '/preparazioni/' + workspace
        if statement == 'SELECT preparation.preview_analysis_plan(%s,%s,%s,%s,%s)':
            return self.checked(self.post(path + '/piani/anteprima', {
                'item_ids': [str(item) for item in parameters[1]], 'configuration_version': parameters[2],
                'limits': parameters[3].obj, 'request_key': str(parameters[4])}), 201)
        if statement == 'SELECT preparation.read_analysis_coverage(%s,%s,%s)':
            return self.checked(self.client.get(legacy.BASE + path + '/piani/' + str(parameters[1]) +
                '/copertura', params={'version': parameters[2]}))
        if statement == 'SELECT preparation.start_analysis_plan(%s,%s,%s,%s)':
            return self.checked(self.post(path + '/piani/' + str(parameters[1]) + '/avvia', {
                'version': parameters[2], 'request_key': str(parameters[3])}), 202)
        if statement == 'SELECT preparation.continue_analysis_plan(%s,%s,%s,%s)':
            return self.checked(self.post(path + '/piani/' + str(parameters[1]) + '/continua', {
                'version': parameters[2], 'request_key': str(parameters[3])}), 202)
        if statement == 'SELECT preparation.retry_uncertain_analysis_packet(%s,%s,%s)':
            return self.checked(self.post(path + '/pacchetti/' + str(parameters[1]) + '/ripeti', {
                'request_key': str(parameters[2])}), 202)
        raise AssertionError('The HTTP journey attempted an undeclared direct plan operation')

    def test_preview_pages_csrf_access_loss_and_exact_shapes(self):
        """Bounded pages reconcile global totals and no read/session permits a write."""
        workspace, items = self.cards(count=3)
        plan = self.plan(workspace, items, max_output=2000)
        path = '/preparazioni/' + workspace
        plan_path = legacy.BASE + path + '/piani/' + plan['plan_id']
        page = self.checked(self.client.get(plan_path, params={'limit': 1}))
        self.assertEqual(len(page['packets']), 1)
        self.assertEqual(page['total_packets'], 3)
        coverage = self.checked(self.client.get(plan_path + '/copertura', params={'limit': 1}))
        self.assertEqual(len(coverage['records']), 1)
        self.assertEqual(coverage['record_coverage']['selected_records'], 3)
        self.assertEqual(coverage['next_record_offset'], 1)
        self.checked(self.client.get(plan_path, params={'limit': 101}), 422)
        self.checked(self.client.get(plan_path + '/eventi', params={'limit': 1}))
        self.checked(self.client.post(plan_path + '/avvia', json={'version': 1, 'request_key': str(uuid4())}), 403)
        self.checked(self.post(path + '/piani/' + plan['plan_id'] + '/avvia', {
            'version': True, 'request_key': str(uuid4())}), 422)
        self.assertEqual(self.owner.execute('SELECT count(*) FROM preparation.jobs WHERE workspace_id=%s', (workspace,)).fetchone()[0], 0)
        with TestClient(self.app) as other:
            other.cookies.set('egi_moderation', 'admin', path='/moderazione')
            self.checked(other.get(plan_path), 404)
            state = self.client.get(legacy.BASE + path).json()
            self.checked(self.post(path + '/accessi', {'actor_id': self.people['mod2']['actor'],
                'permission': 'read', 'expected_revision': state['metadata_revision'], 'request_key': str(uuid4())}))
            other.cookies.set('egi_moderation', 'mod2', path='/moderazione')
            self.checked(other.get(plan_path))
            headers = {'origin': 'http://testserver', 'X-EGI-Form-Token': auth.form_token(legacy.SECRET, auth.token_hash('mod2'))}
            self.checked(other.post(plan_path + '/avvia', json={'version': 1, 'request_key': str(uuid4())}, headers=headers), 403)
            state = self.client.get(legacy.BASE + path).json()
            self.checked(self.post(path + '/accessi', {'actor_id': self.people['mod2']['actor'],
                'permission': None, 'expected_revision': state['metadata_revision'], 'request_key': str(uuid4())}))
            self.checked(other.get(plan_path), 404)

    def test_group_only_plan_declares_no_classification_and_preserves_record_credit(self):
        """An explicit comparison-only plan dispatches no hidden record-analysis task."""
        workspace, items = self.cards()
        baseline = self.plan(workspace, items)
        path = '/preparazioni/' + workspace
        body = {'item_ids': items, 'configuration_version': None,
            'limits': baseline['followup_limits'], 'tasks': ['group_labels'], 'request_key': str(uuid4())}
        for invalid in (None, [], ['extract_text'], ['group_labels', 'group_labels'], [True]):
            self.checked(self.post(path + '/piani/anteprima', {**body, 'tasks': invalid}), 422)
        plan = self.checked(self.post(path + '/piani/anteprima', body), 201)
        self.assertEqual(plan['stage_policy']['tasks'], ['group_labels'])
        self.assertTrue(plan['packets'])
        self.assertTrue(all(packet['task'] == 'group_labels' and not packet['predecessor_packet_ids'] for packet in plan['packets']))
        before = {item: self.owner.execute('SELECT current_version_id FROM preparation.items WHERE id=%s', (item,)).fetchone()[0] for item in items}
        coverage = self.coverage(workspace, plan)
        self.assertFalse(coverage['analysis_requested'])
        self.assertEqual(coverage['selected_record_count'], len(items))
        self.assertEqual(coverage['record_coverage']['selected_records'], 0)
        self.assertEqual(coverage['record_coverage']['pending_records'], 0)
        calls = []

        def handler(message):
            """Return only declared scoped comparison abstentions through MockTransport."""
            packet = json.loads(json.loads(message.content)['input'][0]['content'][0]['text'])
            calls.append(packet)
            self.assertEqual(packet['task'], 'group_labels')
            self.assertEqual(packet['coverage']['required_record_keys'], [])
            return response(abstention(packet))

        self.start(workspace, plan)
        self.assertEqual(self.coverage(workspace, plan)['progress'], 'running')
        worker = self.worker(handler)
        for _ in range(4):
            if worker.run_once() is None:
                break
        coverage = self.coverage(workspace, plan)
        self.assertTrue(calls)
        self.assertEqual(coverage['progress'], 'finished')
        self.assertEqual(coverage['record_coverage']['validated_records'], 0)
        self.assertFalse(coverage['comparison_coverage']['pending_scope_keys'])
        for item, version in before.items():
            self.assertEqual(self.owner.execute('SELECT current_version_id FROM preparation.items WHERE id=%s', (item,)).fetchone()[0], version)
        self.assertEqual(self.checked(self.post(path + '/piani/anteprima', body), 201)['plan_id'], plan['plan_id'])

    def test_explicit_amendment_previews_a_new_identity_without_starting(self):
        """An amended visible envelope leaves the old plan and every item untouched."""
        workspace, items = self.cards()
        plan = self.plan(workspace, items)
        limits = deepcopy(plan['followup_limits'])
        limits['max_total_packets'] += 1
        path = '/preparazioni/' + workspace + '/piani/' + plan['plan_id']
        body = {'version': plan['version'], 'item_ids': items, 'configuration_version': None,
            'limits': limits, 'request_key': str(uuid4())}
        changed = self.checked(self.post(path + '/modifica', body), 201)
        self.assertNotEqual(changed['plan_id'], plan['plan_id'])
        self.assertEqual(self.checked(self.post(path + '/modifica', body), 201)['plan_id'], changed['plan_id'])
        self.assertEqual(self.owner.execute('SELECT count(*) FROM preparation.jobs WHERE workspace_id=%s', (workspace,)).fetchone()[0], 0)
        self.checked(self.client.get(legacy.BASE + path))


if __name__ == '__main__':
    unittest.main()
