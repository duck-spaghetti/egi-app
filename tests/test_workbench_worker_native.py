"""Run declared workbench packets through real PostgreSQL and the actual mock adapter."""
from copy import deepcopy
from datetime import date
import json
import unittest
from uuid import uuid4

import httpx
import psycopg
from psycopg.types.json import Jsonb
from review.matching import make_context

from app.backend.api.moderation import auth
from tests import test_community_worker_native as existing
from tests.native import REPOSITORY
from tests.test_workbench_provider import abstention, response


@unittest.skipUnless(REPOSITORY, 'needs an explicit disposable EGI_DATABASE_REPO')
class WorkbenchWorkerNativeTests(unittest.TestCase):
    """Reuse owned schema/login fixtures without inheriting the older test cases."""

    @classmethod
    def setUpClass(cls):
        """Deploy the existing controlled editorial/worker fixture under this class."""
        existing.WorkerNativeTests.setUpClass.__func__(cls)

    setUp = existing.WorkerNativeTests.setUp
    post = existing.WorkerNativeTests.post
    worker = existing.WorkerNativeTests.worker

    def editorial(self, statement, parameters):
        """Execute one fixed test contract with a fresh verified editorial session."""
        with psycopg.connect(self.cluster.dsn('egi_community_desk')) as connection:
            connection.execute('SELECT access.verify_session(%s)', (auth.token_hash('mod1'),))
            return connection.execute(statement, parameters).fetchone()[0]

    def cards(self, count=2):
        """Create actual editor-selected literal labels and source-bound descriptions."""
        workspace, input_id = existing.WorkerNativeTests.prepare(self, text='Mensa\nSupporto pubblico\n')
        path = '/preparazioni/' + workspace
        ids = []
        for index in range(count):
            created = self.post(path + '/schede/crea', {'input_id': input_id, 'job_id': None,
                'selections': [{'creation_key': str(uuid4())}], 'request_key': str(uuid4())})
            self.assertEqual(created.status_code, 201, created.text)
            item = created.json()['items'][0]
            item_id = item['item_id']
            version = self.client.get(existing.BASE + path + '/schede/' + item_id).json()['version']
            fragment = self.post(path + '/schede/' + item_id + '/fatto-preparato', {
                'input_id': input_id, 'kind': 'category_label', 'subject': 'service',
                'selection': {'start': 0, 'end': 5}})
            self.assertEqual(fragment.status_code, 200, fragment.text)
            fragment = fragment.json()
            payload = version['payload']
            payload.update(schema_version=2, source_facts=[fragment['fact']], resolutions=[])
            payload['service'] = {'name': 'Servizio sintetico ' + str(index), 'description': 'Mensa'}
            evidence = deepcopy(fragment['evidence'])
            evidence.update(id=str(uuid4()), path='/service/description')
            payload['evidence'] = [fragment['evidence'], evidence]
            payload['field_origins'].update(fragment['field_origins'])
            payload['field_origins']['/service/name'] = {'state': 'manual'}
            saved = self.post(path + '/schede', {'changes': [{'item_id': item_id,
                'expected_version': version['id'], 'payload': payload}], 'request_key': str(uuid4())})
            self.assertEqual(saved.status_code, 200, saved.text)
            ids.append(item_id)
        return workspace, ids

    def plan(self, workspace, items, max_output=20000):
        """Freeze one fixture-only configuration and preview its bounded declared plan."""
        path = '/preparazioni/' + workspace
        contexts = self.post(path + '/catalogo', {'query': {'kind': 'taxonomy_context'}})
        self.assertEqual(contexts.status_code, 200, contexts.text)
        selected = contexts.json()['entries'][0]
        query = {'kind': 'classification', 'territory_id': selected['territory_id'], 'axis_id': selected['axis_id']}
        catalog = self.post(path + '/catalogo', {'query': query})
        self.assertEqual(catalog.status_code, 200, catalog.text)
        page = catalog.json()
        context = make_context(page, as_of=date.fromisoformat(page['as_of']))
        configuration = {**existing.CONFIG, 'interpretation_version': 2, 'catalog_context': context}
        version = 'workbench-app/' + str(uuid4())
        self.owner.execute('INSERT INTO preparation.ai_configurations(version,provider_config,max_input_tokens,max_output_tokens,input_rate_microusd_per_million,cached_rate_microusd_per_million,output_rate_microusd_per_million,verified_at,price_reference) VALUES(%s,%s,300000,%s,1000,500,1000,clock_timestamp(),%s)',
            (version, Jsonb(configuration), max_output, 'Synthetic app fixture; no provider calls'))
        self.owner.execute('UPDATE preparation.ai_settings SET config_version=%s,enabled=true', (version,))
        limits = {'max_total_packets': 10, 'max_followup_packets': 5,
            'max_reserved_micro_usd': 1000000,
            'allowed_followup_kinds': ['remaining_record_analysis', 'cross_packet_comparison']}
        return self.editorial('SELECT preparation.preview_analysis_plan(%s,%s,%s,%s,%s)',
            (workspace, items, version, Jsonb(limits), uuid4()))

    def coverage(self, workspace, plan):
        """Read server-reconciled coverage independently from displayed packet pages."""
        return self.editorial('SELECT preparation.read_analysis_coverage(%s,%s,%s)',
            (workspace, plan['plan_id'], plan['version']))

    def start(self, workspace, plan):
        """Deliberately start exactly the reviewed plan version once."""
        return self.editorial('SELECT preparation.start_analysis_plan(%s,%s,%s,%s)',
            (workspace, plan['plan_id'], plan['version'], uuid4()))

    def test_manual_source_selection_still_reaches_declared_comparison(self):
        """Raw quoted labels remain analyzable despite their operator-selection provenance."""
        workspace, items = self.cards()
        plan = self.plan(workspace, items)
        self.assertEqual(plan['planned_request_count'], 2, 'one record packet and its declared comparison')
        before = self.owner.execute('SELECT count(*) FROM preparation.jobs WHERE workspace_id=%s', (workspace,)).fetchone()[0]
        self.assertEqual(before, 0, 'preview cannot dispatch or create a job')
        self.start(workspace, plan)
        calls = []

        def handler(message):
            """Accept actual source-safe packets and return explicit controlled abstentions."""
            request = json.loads(json.loads(message.content)['input'][0]['content'][0]['text'])
            calls.append(request)
            self.assertEqual(self.owner.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'").fetchone()[0], 0)
            self.assertNotIn('source_context', [basis['kind'] for basis in request['data']['bases']])
            return response(abstention(request))

        worker = self.worker(handler)
        for _ in range(10):
            if worker.run_once() is None:
                break
        else:
            self.fail('bounded fixture did not drain its declared jobs')
        self.assertEqual([request['task'] for request in calls], ['classify_cards', 'group_labels'])
        self.assertEqual(calls[0]['shared_context'], calls[1]['shared_context'])
        self.assertEqual(set(calls[1]['coverage']['reference_record_keys']), set(items))
        self.assertEqual(calls[1]['coverage']['required_record_keys'], [])
        self.assertTrue(calls[1]['data']['prior_proposals'], 'comparison needs the actual retained alternatives')
        coverage = self.coverage(workspace, plan)
        self.assertEqual(coverage['record_coverage']['selected_records'], 2)
        self.assertEqual(coverage['record_coverage']['insufficient_context_records'], 2)
        self.assertEqual(coverage['record_coverage']['validated_records'], 0)
        self.assertEqual(coverage['progress'], 'finished')
        self.assertEqual(len(coverage['comparison_coverage']['completed_scope_keys']), 1)
        self.assertEqual(coverage['comparison_coverage']['pending_scope_keys'], [])
        with psycopg.connect(self.cluster.dsn('egi_community_desk')) as connection:
            connection.execute('SELECT access.verify_session(%s)', (auth.token_hash('mod1'),))
            for item in items:
                payload = connection.execute('SELECT preparation.read_item(%s,%s,NULL)', (workspace, item)).fetchone()[0]['version']['payload']
                self.assertEqual(payload['schema_version'], 2, 'analysis never materializes proposals automatically')
                self.assertFalse(payload['service'].get('classifications'))

    def test_unknown_dispatch_requires_explicit_retry_and_keeps_old_cost_held(self):
        """Restart makes no second call; a deliberate replacement can finish declared work."""
        workspace, items = self.cards(count=1)
        plan = self.plan(workspace, items)
        self.start(workspace, plan)
        calls = []

        def timeout(message):
            """Simulate an ambiguous transport result after the committed dispatch."""
            calls.append('uncertain')
            raise httpx.ReadTimeout('synthetic timeout', request=message)

        first = self.worker(timeout).run_once()
        self.assertEqual(first['state'], 'uncertain')
        self.assertIsNone(self.worker(timeout).run_once())
        self.assertEqual(calls, ['uncertain'])
        self.assertEqual(self.coverage(workspace, plan)['progress'], 'waiting_retry')
        old_packet, key = plan['packets'][0]['packet_id'], uuid4()
        retried = self.editorial('SELECT preparation.retry_uncertain_analysis_packet(%s,%s,%s)',
            (workspace, old_packet, key))
        replay = self.editorial('SELECT preparation.retry_uncertain_analysis_packet(%s,%s,%s)',
            (workspace, old_packet, key))
        self.assertEqual(retried, replay)

        def complete(message):
            """Return known outcomes only for the separately authorized new dispatches."""
            request = json.loads(json.loads(message.content)['input'][0]['content'][0]['text'])
            calls.append(request['task'])
            return response(abstention(request))

        worker = self.worker(complete)
        for _ in range(10):
            if worker.run_once() is None:
                break
        else:
            self.fail('explicit replacement did not drain its declared work')
        self.assertEqual(calls, ['uncertain', 'classify_cards', 'group_labels'])
        self.assertEqual(self.coverage(workspace, plan)['progress'], 'finished')
        held = self.owner.execute('SELECT b.state FROM preparation.budget_reservations b JOIN preparation.packet_jobs q ON q.job_id=b.job_id WHERE q.packet_id=%s', (old_packet,)).fetchone()[0]
        self.assertEqual(held, 'uncertain', 'replacement cannot erase the original possible charge')

    def test_multi_packet_continuation_targets_only_the_unresolved_basis(self):
        """A missing basis stays partial while valid records survive and comparison waits."""
        workspace, items = self.cards(count=3)
        plan = self.plan(workspace, items, max_output=2000)
        self.assertEqual(plan['total_packets'], 3)
        self.assertEqual(plan['planned_request_count'], 4)
        self.start(workspace, plan)
        calls, missing_record, missing_basis = [], [], []

        def handler(message):
            """Omit exactly one requested outcome once, preserving all other explicit results."""
            request = json.loads(json.loads(message.content)['input'][0]['content'][0]['text'])
            calls.append(request)
            value = abstention(request)
            if request['task'] == 'classify_cards' and not missing_record:
                missing_record.append(request['data']['units'][0]['record_key'])
                missing_basis.append(value['proposals'][-1]['basis_key'])
                value['proposals'].pop()
            return response(value)

        worker = self.worker(handler)
        for _ in range(10):
            if worker.run_once() is None:
                break
        self.assertEqual(len(calls), 3, 'comparison cannot start with an unresolved required basis')
        coverage = self.coverage(workspace, plan)
        self.assertEqual(coverage['record_coverage']['partial_records'], 1)
        self.assertEqual(coverage['record_coverage']['insufficient_context_records'], 2)
        self.assertEqual(coverage['progress'], 'finished_with_gaps')
        self.editorial('SELECT preparation.continue_analysis_plan(%s,%s,%s,%s)',
            (workspace, plan['plan_id'], plan['version'], uuid4()))
        for _ in range(10):
            if worker.run_once() is None:
                break
        self.assertEqual(len(calls), 5, 'one residual packet and its separately declared comparison')
        self.assertEqual(calls[3]['task'], 'classify_cards')
        self.assertEqual(calls[3]['coverage']['required_record_keys'], missing_record)
        self.assertEqual([basis['basis_key'] for basis in calls[3]['data']['bases']], missing_basis)
        self.assertEqual(calls[4]['task'], 'group_labels')
        self.assertEqual(len({p['proposal_key'] for p in calls[4]['data']['prior_proposals']}),
            len(calls[4]['data']['prior_proposals']))
        coverage = self.coverage(workspace, plan)
        self.assertEqual(coverage['record_coverage']['selected_records'], 3)
        self.assertEqual(coverage['record_coverage']['insufficient_context_records'], 3)
        self.assertEqual(coverage['record_coverage']['partial_records'], 0)
        self.assertEqual(coverage['progress'], 'finished')


if __name__ == '__main__':
    unittest.main()
