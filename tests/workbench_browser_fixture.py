"""Serve a loopback-only synthetic workbench with an injected mock worker for visual QA.

The unique *.localhost host keeps fixture cookies separate from normal local app
sessions. This module never calls load_settings or reads an API key. Stop with SIGINT
to shut down the owned server, worker and disposable PostgreSQL cluster together.
"""
import argparse
import json
from pathlib import Path
import socket
from threading import Event, Thread
import time
from uuid import uuid4

from fastapi.responses import RedirectResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
import uvicorn

from scripts.cw1_checks import resources
from tests.test_workbench_http_native import WorkbenchHttpTests
from tests.test_workbench_provider import abstention, response


def main():
    """Prepare synthetic private cards and supervise the complete local browser fixture."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--proposals', action='store_true', help='Return explicit synthetic category/group proposals for review')
    options = parser.parse_args()
    if not 0 <= options.port <= 65535:
        parser.error('port must be between 0 and 65535')
    root = Path(__file__).resolve().parents[1]
    stopped = Event()
    server = worker_thread = server_thread = listener = None
    fixture = None
    failures = []
    with resources().ResourceRun(root).activate():
        try:
            WorkbenchHttpTests.setUpClass()
            fixture = WorkbenchHttpTests()
            fixture.setUp()
            workspace, items = fixture.cards(count=3)
            fixture.plan(workspace, items, max_output=2000)
            app = fixture.app
            fixture.doCleanups()
            hostname = 'cw1-' + uuid4().hex[:10] + '.localhost'
            for middleware in app.user_middleware:
                if middleware.cls is TrustedHostMiddleware:
                    middleware.kwargs['allowed_hosts'] = [*middleware.kwargs['allowed_hosts'], hostname]
            app.middleware_stack = None

            @app.get('/_fixture/access', include_in_schema=False)
            async def access():
                """Enter only the synthetic fixture session on its unique loopback host."""
                result = RedirectResponse('/moderazione/contribuisci?id=' + workspace, status_code=303)
                result.set_cookie('egi_moderation', 'mod1', path='/moderazione', httponly=True, samesite='strict')
                return result

            def handler(message):
                """Return controlled decisions or abstentions without external transport."""
                packet = json.loads(json.loads(message.content)['input'][0]['content'][0]['text'])
                output = abstention(packet)
                if options.proposals and packet['catalog_context']['entries']:
                    candidate = packet['catalog_context']['entries'][0]['candidate_key']
                    if packet['task'] == 'classify_cards':
                        basis = next((basis for basis in packet['data']['bases'] if basis['kind'] == 'description'), None)
                        if basis is not None:
                            proposal = next(row for row in output['proposals'] if row['basis_key'] == basis['basis_key'])
                            proposal.update(state='proposed', missing_context=[], choices=[{
                                'candidate_key': candidate, 'reason': 'Proposta sintetica da controllare',
                                'support_keys': basis['support_keys']}])
                    else:
                        labels = packet['data']['labels']
                        supports = sorted({key for label in labels for occurrence in label['occurrences'] for key in occurrence['support_keys']})
                        output['proposals'] = [{'proposal_key': 'synthetic-group', 'relation': 'equivalent',
                            'unit_keys': [label['unit_key'] for label in labels], 'membership_issues': [],
                            'choices': [{'candidate_key': candidate, 'reason': 'Categoria comune sintetica da controllare', 'support_keys': supports}],
                            'reason': 'Confronto sintetico, nessuna misura di qualità IA', 'support_keys': supports}]
                        for unit in output['unit_results']:
                            unit.update(state='analyzed', proposal_keys=['synthetic-group'], diagnostics=[])
                return response(output)

            worker = fixture.worker(handler)

            def process():
                """Process declared fixture jobs until the owning run requests shutdown."""
                try:
                    while not stopped.is_set():
                        worker.run_once()
                        stopped.wait(.1)
                except Exception as error:
                    failures.append(type(error).__name__)
                    stopped.set()

            listener = socket.socket()
            listener.bind(('127.0.0.1', options.port))
            listener.listen(128)
            port = listener.getsockname()[1]
            server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, access_log=False, log_level='error'))
            server_thread = Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
            worker_thread = Thread(target=process, daemon=True)
            server_thread.start()
            worker_thread.start()
            deadline = time.monotonic() + 15
            while not server.started:
                if not server_thread.is_alive() or time.monotonic() > deadline:
                    raise RuntimeError('Synthetic browser server did not start')
                stopped.wait(.05)
            print(json.dumps({'url': f'http://{hostname}:{port}/_fixture/access',
                'workspace_id': workspace, 'synthetic': True, 'provider': 'MockTransport'}), flush=True)
            while server_thread.is_alive():
                if failures:
                    raise RuntimeError('Synthetic worker failed: ' + failures[0])
                stopped.wait(.25)
        finally:
            stopped.set()
            if server is not None:
                server.should_exit = True
            for thread in (worker_thread, server_thread):
                if thread is not None:
                    thread.join(timeout=15)
                    if thread.is_alive():
                        raise RuntimeError('Owned fixture thread did not stop cleanly')
            if listener is not None:
                listener.close()
            if fixture is not None:
                fixture.doCleanups()
            WorkbenchHttpTests.doClassCleanups()


if __name__ == '__main__':
    main()
