"""Run one-dispatch interpretation jobs and retain usage outside semantic validation.

build_request filters the eligible envelope to the pinned Reviewer contract.
Heartbeat renews only lease authority. Worker processes jobs without holding a
canonical transaction across provider I/O and never silently retries a provider.
"""
from contextlib import AbstractContextManager
from threading import Event, Thread
from uuid import uuid4

from review.insertion import OUTPUT_SHAPE, OUTPUT_SHAPE_V2, interpret, validate_request
from review.insertion_fields import VERSION, VERSION_V2, ContractError

from .provider import ConfigurationError, OpenAIAdapter, validate_config


def build_request(claim: dict) -> dict:
    """Select the frozen protocol and use only eligible text/metadata and its map."""
    config = validate_config(claim['provider_config'])
    if claim['task'] in ('classify_cards', 'group_labels'):
        from review import workbench
        request = workbench.validate_request(claim['eligible_payload'])
        if request['task'] != claim['task'] or request['config_version'] != claim['config_version']:
            raise ConfigurationError('invalid_workbench_claim')
        return request
    version = config.get('interpretation_version', 1)
    eligible = claim['eligible_payload']
    request = {'schema_version':version,'task':claim['task'],
        'input_id':claim['input_id'],'input_hash':eligible['input_hash'],
        'config_version':claim['config_version'],'text':eligible['text'],
        'source_metadata':eligible['source_metadata'],'locator_map':claim['locator_map'],
        'field_dictionary_version':VERSION if version == 1 else VERSION_V2,'language_version':config['language_version'],
        'taxonomy_version':config['taxonomy_version'],'requested_output_shape':OUTPUT_SHAPE if version == 1 else OUTPUT_SHAPE_V2}
    if 'catalog_context' in config:
        request['catalog_context'] = config['catalog_context']
    return validate_request(request)


class Heartbeat(AbstractContextManager):
    """Renew a running lease separately; revoked/expired authority never revives."""

    def __init__(self, queue, claim: dict, dispatch, interval=20):
        """Keep the lease and a stoppable renewal thread without application data logs."""
        self.queue, self.claim, self.dispatch = queue, claim, dispatch
        self.interval, self.stopped = interval, Event()
        self.thread = Thread(target=self._run, daemon=True)

    def _run(self):
        """Stop on refusal or connectivity failure; late accounting is still attempted."""
        while not self.stopped.wait(self.interval):
            try:
                if not self.queue.heartbeat(self.claim,self.dispatch):
                    return
            except Exception:
                return

    def __enter__(self):
        """Start renewal after dispatch commit and before provider I/O."""
        self.thread.start()
        return self

    def __exit__(self, *_):
        """Stop renewal and allow the bounded SQL call to return before leaving."""
        self.stopped.set()
        self.thread.join(timeout=14)
        return False


class Worker:
    """Process one leased job using an isolated queue and one adapter instance."""

    def __init__(self, queue, api_key, adapter_factory=OpenAIAdapter, heartbeat_interval=20):
        """Inject transport/accounting seams for controlled provider/native tests."""
        self.queue, self.api_key = queue, api_key
        self.adapter_factory, self.heartbeat_interval = adapter_factory, heartbeat_interval
        self.worker_id = uuid4()

    def run_once(self) -> dict | None:
        """Claim, commit dispatch, interpret once and settle known or uncertain usage."""
        claim = self.queue.claim(self.worker_id)
        if claim is None:
            return None
        dispatched = False
        try:
            request = build_request(claim)
            dispatch = self.queue.start(claim)
            if dispatch['state'] != 'running':
                return dispatch
            dispatched = True
            adapter = self.adapter_factory(dispatch['provider_config'],self.api_key,
                dispatch['max_input_tokens'],dispatch['max_output_tokens'])
            with Heartbeat(self.queue,claim,dispatch['dispatch_id'],self.heartbeat_interval):
                if claim['task'] in ('classify_cards', 'group_labels'):
                    from review import workbench
                    result = workbench.interpret(request,adapter)
                else:
                    result = interpret(request,adapter)
            retained = adapter.response
            if not isinstance(retained,dict) or retained.get('usage') is None:
                code = {'timeout':'provider_timeout','transport':'provider_transport'}.get(
                    retained.get('error_code') if isinstance(retained,dict) else None,'provider_failure')
                return self.queue.fail(claim,code,True)
            usage = {**retained['usage'],'provider_request_id':retained.get('provider_request_id')}
            return self.queue.finish(claim,dispatch['dispatch_id'],result,usage)
        except (ConfigurationError,ContractError,KeyError,TypeError,ValueError):
            return self.queue.fail(claim,'provider_failure',dispatched)
        except BaseException:
            # Keyboard/process interruptions never cause another provider call.
            # A database outage can also prevent this marker; lease recovery then
            # makes a committed dispatch uncertain without repeating it.
            try:
                self.queue.fail(claim,'worker_interrupted',dispatched)
            except Exception:
                pass
            raise
