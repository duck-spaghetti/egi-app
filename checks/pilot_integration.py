"""Run composed Integration against an explicitly supplied authentic private pilot.

The checksum-pinned bundle contains the retained 315-service dump and immutable
schedule/cycleway inputs. Only owned disposable PostgreSQL and a pre-bound loopback
HTTP socket are used. No source acquisition, worker or provider dispatch runs.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from devchecks.resources import OwnedCluster, ResourceRun


def validate_fixture(folder):
    """Refuse incomplete, substituted or unauthenticated retained inputs."""
    manifest = json.loads((folder / 'manifest.json').read_text())
    if manifest.get('format') != 1 or manifest.get('cohort') != {'services': 315, 'placed': 313}:
        raise ValueError('Wrong retained pilot cohort')
    files = manifest['files']
    if not all(name in files for name in ('pilot.dump', 'transport/active.json', 'rail/active.json', 'cycleways/active.json')):
        raise ValueError('Missing retained pilot inputs')
    for name, entry in files.items():
        path = (folder / name).resolve()
        if folder not in path.parents or not path.is_file() or path.stat().st_size != entry['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('Retained pilot fixture integrity failed')
    if files['pilot.dump']['sha256'] != '1852ca735cc02c659cd853f47159b253d1a7904c50b992d6f3b77f1dc6d100b9':
        raise ValueError('Retained pilot backup is not the accepted original')


def run_integration(env, report, timeout=900):
    """Allow the owned check group to unwind its resource scopes before forced teardown."""
    process = subprocess.Popen([sys.executable, 'scripts/check.py', '--profile', 'integration', '--json'],
                               cwd=ROOT, env=env, stdout=report, start_new_session=True)
    try:
        return process.wait(timeout=timeout)
    except BaseException:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=10)
        raise


def run(folder):
    """Restore, exercise and tear down the owned pilot while preserving other previews."""
    validate_fixture(folder)
    pg = Path(os.environ['EGI_PG_BIN'])
    output = ROOT / '.local/integration/pilot'
    output.mkdir(parents=True, exist_ok=True)
    with ResourceRun(ROOT).activate(), OwnedCluster(ROOT, pg, database='egi_preview') as cluster:
        env = dict(cluster.environment)
        subprocess.run([pg / 'psql', '-Xq', '-v', 'ON_ERROR_STOP=1', '-c',
                        'CREATE ROLE egi_reader; CREATE ROLE egi_writer; CREATE ROLE egi_preview_reader LOGIN;'], env=env, check=True)
        with (output / 'restore.log').open('w') as log:
            subprocess.run([pg / 'pg_restore', '--exit-on-error', '--no-owner', '--dbname', 'egi_preview', folder / 'pilot.dump'],
                           env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            port = listener.getsockname()[1]
            env.update(EGI_PSQL=str(pg / 'psql'), EGI_DATA_MODE='preview', EGI_LOCAL_LAYERS='1', EGI_COMMUNITY_LIVE_AUTHORIZED='0',
                       EGI_PREVIEW_DSN=f"host={cluster.path} port={env['PGPORT']} dbname=egi_preview user=egi_preview_reader",
                       EGI_TRANSPORT_ROOT=str(folder / 'transport'), EGI_RAIL_ROOT=str(folder / 'rail'),
                       EGI_CYCLEWAYS_ROOT=str(folder / 'cycleways'), EGI_ERROR_DIR=str(output / 'errors'),
                       EGI_APP_BASE_URL=f'http://127.0.0.1:{port}')
            # Keep inherited editorial/provider credentials away from the historical web child.
            web_env = {key: value for key, value in env.items() if not key.startswith(('OPENAI_', 'EGI_EDITORIAL_', 'EGI_INTAKE_'))}
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with (output / 'server.log').open('w') as log:
                web = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.backend.main:app', '--fd', str(listener.fileno()), '--no-access-log'],
                                       cwd=ROOT, env=web_env, pass_fds=(listener.fileno(),), stdout=log, stderr=subprocess.STDOUT)
                try:
                    deadline = time.monotonic() + 15
                    while True:
                        if web.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError('Owned pilot did not become healthy')
                        try:
                            with opener.open(env['EGI_APP_BASE_URL'] + '/health', timeout=.5) as response:
                                health = json.load(response)
                            break
                        except OSError:
                            time.sleep(.05)
                    if health.get('services') != 315:
                        raise ValueError('Restored pilot cohort differs from accepted original')
                    (output / 'receipt.json').write_text(json.dumps({'health': health, 'fixture': str(folder), 'owned': True}))
                    with (ROOT / '.local/ci-integration.json').open('w') as report:
                        return run_integration(env, report)
                finally:
                    if web.poll() is None:
                        web.terminate()
                        try:
                            web.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            web.kill()
                            web.wait(timeout=5)


def main():
    """Select the explicit unpacked private fixture and return the owning check status."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture-root', type=Path, required=True)
    args = parser.parse_args()
    return run(args.fixture_root.resolve())


if __name__ == '__main__':
    raise SystemExit(main())
