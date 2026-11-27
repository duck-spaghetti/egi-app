"""Inspect/start/restart only this worktree's owned loopback preview.

Receipts, a per-start HTTP identity and the OS process fingerprint establish
ownership independently. This command never starts/stops a database or worker.
"""
import argparse
import fcntl
import importlib
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.local/preview'
IDENTITY = '/__egi_preview_identity'


def git(*args):
    """Read the actual owning checkout identity without changing Git state."""
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def fingerprint(pid):
    """Identify a running process using creation time and exact invocation."""
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'command='],
                            capture_output=True, text=True)
    if result.returncode:
        return None
    observed = result.stdout.strip()
    # macOS venv launchers exec Python.app without changing PID/creation time.
    # Keep exact script/arguments and creation time; do not pin that launcher name.
    script = str(Path(__file__).resolve())
    position = observed.find(script)
    return observed[:24] + ' ' + observed[position:] if position >= 0 else observed


def get(url):
    """Read bounded local JSON without proxy routing or exposing response errors."""
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=.6) as response:
            return json.loads(response.read(32768))
    except (OSError, ValueError):
        return None


def available(port):
    """Check the exact loopback port; do not choose a replacement origin."""
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def state():
    """Observe receipt/process/server separately and withhold the ownership token."""
    receipt = json.loads((RUNTIME / 'runtime.json').read_text()) if (RUNTIME / 'runtime.json').exists() else None
    result = {'worktree': str(ROOT), 'branch': git('branch', '--show-current'),
              'source': git('rev-parse', 'HEAD'), 'logs': str(RUNTIME / 'server.log'),
              'server': 'stopped', 'ownership': 'unregistered', 'database': 'unprobed',
              'worker_provider': 'disabled', 'browser': 'unprobed'}
    if not receipt:
        return result, None
    result.update(url=receipt['url'], pid=receipt['pid'], started_source=receipt['source'])
    identity = get(receipt['url'] + IDENTITY)
    alive = fingerprint(receipt['pid'])
    matches = (receipt['worktree'] == str(ROOT) and alive == receipt['fingerprint']
               and identity == {'token': receipt['token'], 'worktree': str(ROOT)})
    result['ownership'] = 'owned' if matches else 'conflict' if alive or identity or not available(receipt['port']) else 'stale'
    result['server'] = 'healthy' if matches else 'unverified' if alive else 'stopped'
    if matches:
        health = get(receipt['url'] + '/health')
        result['database'] = 'selected-reader-responding' if health and health.get('status') == 'ok' else 'unavailable-or-unprobed'
    return result, receipt


def stop(receipt):
    """Terminate only a revalidated owned web server; preserve all data/other processes."""
    observed, current = state()
    if observed['ownership'] != 'owned' or current != receipt:
        raise RuntimeError('Ownership cannot be established; refusing to stop process')
    os.kill(receipt['pid'], signal.SIGTERM)
    deadline = time.monotonic() + 8
    while not available(receipt['port']) and time.monotonic() < deadline:
        time.sleep(.05)
    if not available(receipt['port']):
        raise RuntimeError('Owned server did not release its port; inspect logs')


def start(port, target, timeout):
    """Start a loopback-only child with provider dispatch unavailable and record identity."""
    if port in (4328, 4335):
        raise RuntimeError('Reserved existing Community/saved-list origin; preserve its current owner')
    if not available(port):
        raise RuntimeError('Port occupied; refusing substitution or foreign process termination')
    token = secrets.token_hex(24)
    env = {k: v for k, v in os.environ.items() if not k.startswith(('OPENAI_', 'EGI_COMMUNITY_'))}
    env.update(EGI_PREVIEW_TOKEN=token, EGI_COMMUNITY_LIVE_AUTHORIZED='0')
    with (RUNTIME / 'server.log').open('a') as log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--serve',
                                  '--port', str(port), '--target', target], cwd=ROOT,
                                 env=env, stdout=log, stderr=log, start_new_session=True)
    try:
        receipt = {'pid': child.pid, 'fingerprint': fingerprint(child.pid), 'token': token,
                   'port': port, 'url': f'http://127.0.0.1:{port}', 'worktree': str(ROOT),
                   'source': git('rev-parse', 'HEAD'), 'target': target}
        path = RUNTIME / 'runtime.json'
        path.write_text(json.dumps(receipt)); path.chmod(0o600)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError('Preview startup failed; inspect the recorded server log')
            if state()[0]['ownership'] == 'owned':
                return
            time.sleep(.05)
        raise RuntimeError('Preview startup timed out; inspect the recorded server log')
    except BaseException:
        # The Popen handle is the capability for this newly acquired child only.
        try:
            discard_startup(child)
        except (OSError, subprocess.SubprocessError) as error:
            raise RuntimeError('Owned preview startup cleanup failed; inspect the recorded server log') from error
        raise


def discard_startup(child):
    """Reap a just-created preview after any failed acquisition, with bounded kill fallback."""
    if child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=8)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=8)


def serve(target, port):
    """Wrap the selected existing ASGI app with an internal lifecycle identity probe."""
    sys.path.insert(0, str(ROOT))
    import uvicorn
    module, name = target.split(':')
    application = getattr(importlib.import_module(module), name)

    async def owned(scope, receive, send):
        """Expose no app credentials or data through the ownership probe."""
        if scope['type'] == 'http' and scope['path'] == IDENTITY:
            body = json.dumps({'token': os.environ['EGI_PREVIEW_TOKEN'], 'worktree': str(ROOT)}).encode()
            await send({'type': 'http.response.start', 'status': 200, 'headers': [(b'content-type', b'application/json'), (b'cache-control', b'no-store')]})
            await send({'type': 'http.response.body', 'body': body})
        else:
            await application(scope, receive, send)

    uvicorn.run(owned, host='127.0.0.1', port=port, access_log=False, log_level='warning')


def main():
    """Serialize lifecycle mutations and print bounded safe machine-readable status."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', nargs='?', choices=['status', 'start', 'restart', 'stop'], default='status')
    parser.add_argument('--port', type=int, default=None)
    parser.add_argument('--target', default=None, help='Trusted local ASGI module:app')
    parser.add_argument('--timeout', type=float, default=12)
    parser.add_argument('--serve', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        serve(args.target, args.port)
        return 0
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    started = time.monotonic()
    with (RUNTIME / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            observed, receipt = state()
            if args.operation != 'status':
                if observed['ownership'] == 'conflict':
                    raise RuntimeError('Conflicting or stale process identity; refusing lifecycle mutation')
                if receipt and ((args.port is not None and args.port != receipt['port']) or (args.target and args.target != receipt['target'])):
                    raise RuntimeError('Recorded origin/target differs; refusing silent substitution')
                if args.operation in ('restart', 'stop') and observed['ownership'] == 'owned':
                    stop(receipt)
                if args.operation in ('start', 'restart') and not (args.operation == 'start' and observed['ownership'] == 'owned'):
                    start(receipt['port'] if receipt else args.port or 4340,
                          receipt['target'] if receipt else args.target or 'app.backend.main:app', args.timeout)
                observed, receipt = state()
            observed['seconds'] = round(time.monotonic() - started, 3)
            print(json.dumps(observed))
            return 2 if observed['ownership'] == 'conflict' else 0
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError):
            print(json.dumps({'status': 'blocked', 'reason': 'Preview ownership, origin or startup check failed; inspect configuration and local server log', 'logs': str(RUNTIME / 'server.log')}))
            return 2


if __name__ == '__main__':
    raise SystemExit(main())
