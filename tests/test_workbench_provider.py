"""Exercise the actual worker/Responses adapter using a synthetic SQL-owned packet."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from uuid import uuid4

import httpx
from pydantic import SecretStr
from review.matching import context_digest
from review import workbench

from app.backend.api.preparations.interpretation.provider import ConfigurationError, OpenAIAdapter
from app.backend.api.preparations.interpretation.runner import Worker, build_request
from tests.community_fixtures import CONFIG

FIXTURE = Path(__file__).parent / 'fixtures' / 'workbench-request.json'
DIGEST = 'b0c761337c08c09745588926af210478ae270dce93221ab3ac4445a76ba49bd0'


def packet():
    """Load only the source-safe synthetic request exported by the native DB fixture."""
    return json.loads(FIXTURE.read_text())


def configuration(request):
    """Use the real frozen catalog with the existing mock-only provider grant."""
    catalog = deepcopy(request['catalog_context'])
    for entry in catalog['entries']:
        entry.pop('definition')
        entry.pop('aliases')
    catalog['digest'] = context_digest(catalog)
    return {**CONFIG, 'interpretation_version': 2, 'catalog_context': catalog}


def comparison_packet():
    """Derive an explicitly synthetic description comparison from the retained packet."""
    request = packet()
    request['task'] = 'group_labels'
    labels = []
    context = workbench.scope_key(request['shared_context'])
    for basis in request['data']['bases']:
        if basis['kind'] != 'description':
            continue
        labels.append({'unit_key': 'interpretation:' + basis['record_key'], 'label': basis['value'],
            'variants': [], 'context_key': context, 'count': 1,
            'occurrences': [{'record_key': basis['record_key'], 'basis_key': basis['basis_key'],
                'support_keys': basis['support_keys']}]})
    request['data']['labels'] = labels
    request['data']['units'] = [{'unit_key': 'comparison:synthetic', 'record_key': None,
        'basis_keys': [], 'member_keys': [label['unit_key'] for label in labels]}]
    request['coverage'].update(total_units=1, supplied_units=1, omitted_units=0,
        required_record_keys=[], reference_record_keys=[r['record_key'] for r in request['data']['records']],
        required_unit_keys=['comparison:synthetic'], limitations=[])
    shared = request['shared_context']
    shared['label_inventory'] = [{'label': labels[0]['label'], 'context_key': context, 'count': len(labels)}]
    shared['inventory_coverage'] = {'complete': True, 'total_labels': 1,
        'supplied_labels': 1, 'omitted_labels': 0}
    shared['digest'] = context_digest(shared)
    return request


def abstention(request):
    """Explicitly abstain for every supplied required basis, without invented categories."""
    proposals, units = [], []
    for unit in request['data']['units']:
        keys = []
        for basis in unit['basis_keys']:
            key = 'outcome:' + basis
            keys.append(key)
            proposals.append({'proposal_key': key, 'basis_key': basis,
                'state': 'insufficient_context', 'choices': [], 'missing_context': ['insufficient_context']})
        units.append({'unit_key': unit['unit_key'], 'record_key': unit['record_key'],
            'state': 'insufficient_context', 'processed_basis_keys': unit['basis_keys'],
            'unprocessed_basis_keys': [], 'proposal_keys': keys, 'hypotheses': [],
            'diagnostics': ['insufficient_context']})
    return {'schema_version': 1, 'task': request['task'], 'request_digest': workbench.request_digest(request),
        'state': 'complete', 'unit_results': units, 'unprocessed_unit_keys': [],
        'proposals': proposals, 'diagnostics': []}


def response(value):
    """Wrap controlled JSON in one Responses message with separately known accounting."""
    return httpx.Response(200, headers={'x-request-id': 'synthetic-workbench'}, json={
        'status': 'completed', 'usage': {'input_tokens': 100, 'output_tokens': 20},
        'output': [{'type': 'message', 'role': 'assistant', 'content': [
            {'type': 'output_text', 'text': json.dumps(value, ensure_ascii=False)}]}]})


class Queue:
    """Inject only lease/accounting seams while the actual worker and adapter execute."""

    def __init__(self, request):
        """Retain one frozen claim and the observed settlement for assertions."""
        self.pending = {'job_id': str(uuid4()), 'task': request['task'],
            'config_version': request['config_version'], 'eligible_payload': request,
            'provider_config': configuration(request), 'lease': 'synthetic-lease'}
        self.settlement = None

    def claim(self, worker):
        """Yield this synthetic job once without implementing durable queue policy."""
        value, self.pending = self.pending, None
        return value

    def start(self, claim):
        """Return the already selected test-only transport limits and dispatch handle."""
        return {'state': 'running', 'dispatch_id': str(uuid4()),
            'provider_config': claim['provider_config'], 'max_input_tokens': 300000, 'max_output_tokens': 30000}

    def heartbeat(self, claim, dispatch):
        """Allow the isolated worker renewal thread to stop normally."""
        return True

    def finish(self, claim, dispatch, result, usage):
        """Observe actual composition output without emulating SQL reconciliation."""
        self.settlement = (result, usage)
        return {'settled': True}

    def fail(self, claim, code, dispatched):
        """Observe a safe failure instead of hiding an unexpected worker path."""
        self.settlement = (code, dispatched)
        return {'failed': code}


class WorkbenchProviderTests(unittest.TestCase):
    """Transport tests prove mechanics only; native suites own durable behavior."""

    def test_sql_packet_digest_and_claim_binding(self):
        """The installed Reviewer accepts the real SQL projection and exact task/config."""
        request = packet()
        self.assertEqual(workbench.request_digest(request), DIGEST)
        workbench.validate_request(request)
        queue = Queue(request)
        claim = queue.pending
        self.assertEqual(build_request(claim), request)
        for field in ('task', 'config_version'):
            changed = deepcopy(claim)
            changed[field] = 'group_labels' if field == 'task' else 'other-config'
            with self.assertRaises(ConfigurationError):
                build_request(changed)

    def test_one_exchange_uses_owned_prompt_schema_and_actual_context(self):
        """One bounded call carries actual shared content and the task-specific schema."""
        request, calls = packet(), []
        value = abstention(request)

        def handler(message):
            """Inspect the actual HTTP payload before returning a controlled abstention."""
            body = json.loads(message.content)
            calls.append(body)
            self.assertEqual(body['instructions'], workbench.instructions(request))
            self.assertEqual(body['text']['format']['schema'], workbench.output_schema(request))
            self.assertEqual(body['text']['format']['name'], 'egi_workbench')
            self.assertEqual(json.loads(body['input'][0]['content'][0]['text']), request)
            self.assertIs(body['store'], False)
            self.assertNotIn('tools', body)
            return response(value)

        adapter = OpenAIAdapter(configuration(request), SecretStr('synthetic-key'),
            300000, 30000, httpx.MockTransport(handler))
        result = workbench.interpret(request, adapter)
        self.assertEqual(result, value)
        self.assertEqual(len(calls), 1)
        self.assertEqual(adapter.response['usage']['input_tokens'], 100)
        with self.assertRaises(ConfigurationError):
            adapter(request)

    def test_worker_retains_partial_units_and_usage_without_legacy_cleaning(self):
        """A malformed unit cannot erase a valid sibling or separately known usage."""
        request, calls = packet(), []
        value = abstention(request)
        value['unit_results'][0]['foreign_null'] = None
        queue = Queue(request)

        def handler(message):
            """Return parseable partial semantics; no external request is possible."""
            calls.append(message)
            return response(value)

        def factory(config, key, input_limit, output_limit):
            """Replace only the transport of the actual production adapter."""
            return OpenAIAdapter(config, key, input_limit, output_limit, httpx.MockTransport(handler))

        worker = Worker(queue, SecretStr('synthetic-key'), factory)
        self.assertEqual(worker.run_once(), {'settled': True})
        result, usage = queue.settlement
        self.assertEqual(result['state'], 'incomplete')
        self.assertEqual(len(result['unit_results']), 1)
        self.assertEqual(result['unprocessed_unit_keys'], [request['data']['units'][0]['unit_key']])
        self.assertEqual(usage['output_tokens'], 20)
        self.assertIsNone(worker.run_once())
        self.assertEqual(len(calls), 1)

    def test_comparison_is_a_separate_request_with_reference_only_records(self):
        """The grouping profile never treats original-record context as record coverage."""
        request, calls = comparison_packet(), []
        workbench.validate_request(request)

        def handler(message):
            """Inspect the task-specific grouping schema and declared comparison scope."""
            body = json.loads(message.content)
            supplied = json.loads(body['input'][0]['content'][0]['text'])
            calls.append(supplied)
            self.assertEqual(body['text']['format']['schema'], workbench.output_schema(request))
            self.assertEqual(supplied['coverage']['required_record_keys'], [])
            self.assertEqual(len(supplied['coverage']['reference_record_keys']), 2)
            return response(abstention(request))

        adapter = OpenAIAdapter(configuration(request), SecretStr('synthetic-key'),
            300000, 30000, httpx.MockTransport(handler))
        result = workbench.interpret(request, adapter)
        self.assertEqual(result['state'], 'complete')
        self.assertIsNone(result['unit_results'][0]['record_key'])
        self.assertEqual(len(calls), 1)

    def test_input_limit_prevents_any_transport_and_settles_known_zero(self):
        """The final serialized provider framing is bounded before the mock is invoked."""
        request, calls = packet(), []

        def handler(message):
            """Detect any forbidden dispatch after local preflight refusal."""
            calls.append(message)
            return response(abstention(request))

        adapter = OpenAIAdapter(configuration(request), SecretStr('synthetic-key'),
            100, 30000, httpx.MockTransport(handler))
        result = workbench.interpret(request, adapter)
        self.assertEqual(result['state'], 'incomplete')
        self.assertEqual(calls, [])
        self.assertEqual(adapter.response['usage']['input_tokens'], 0)


if __name__ == '__main__':
    unittest.main()
