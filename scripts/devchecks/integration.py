"""Resolve identified provider inputs and explicit domain applicability for app checks.

Only the owning commands execute provider checks. Historical live-pilot and private
importer prerequisites become mandatory when their corresponding contracts change.
"""
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

from .resources import PrerequisiteError

SHA = re.compile(r'[0-9a-f]{40}')
PILOT = 'tests/test_preview_http.py'
IMPORTER_TEST = 'test_transport.ContractDriftTests.test_vendored_fixture_matches_importer'
IMPORTER_REASON = 'sibling egi-importer checkout not present'


def git(root, *args):
    """Read actual checkout identities without inherited Git hook redirection."""
    return subprocess.check_output(['git', '-C', str(root), *args], text=True,
        env={k: v for k, v in os.environ.items() if not k.startswith('GIT_')},
        stderr=subprocess.DEVNULL, timeout=30).strip()


def provider(root, entry):
    """Require an exact clean provider checkout before invoking its code or SQL."""
    path = Path(os.environ.get(entry['environment'], str(root / entry['path']))).resolve()
    revision = entry['revision']
    if not SHA.fullmatch(revision) or git(path, 'rev-parse', 'HEAD') != revision:
        raise PrerequisiteError('Provider source revision mismatch: ' + entry['name'])
    if git(path, 'status', '--porcelain'):
        raise PrerequisiteError('Provider source has uncommitted changes: ' + entry['name'])
    return path


def wheel(root, entry):
    """Verify the exact consumer wheel and installed files without importing its code."""
    path = Path(os.environ.get('EGI_COMMUNITY_WHEEL', str(root / entry['path']))).resolve()
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
        raise PrerequisiteError('Consumer Reviewer wheel hash mismatch')
    spec = importlib.util.find_spec('review')
    if not spec or not spec.origin or importlib.metadata.version('egi-reviewer') != entry['version']:
        raise PrerequisiteError('Install the pinned consumer Reviewer wheel')
    installed = Path(spec.origin).parent
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.startswith('review/') and not name.endswith('/'):
                relative = Path(name).relative_to('review')
                if '..' in relative.parts or (installed / relative).read_bytes() != archive.read(name):
                    raise PrerequisiteError('Installed Reviewer differs from the pinned wheel')
    return path


def prepare(root):
    """Return selected sources and named exclusions, failing before native setup on gaps."""
    root = Path(root).resolve()
    policy = json.loads((root / '.checks/integration.json').read_text())
    if policy['schema_version'] != 1 or not SHA.fullmatch(policy['base']):
        raise PrerequisiteError('Invalid integration identity manifest')
    changed = git(root, 'diff', '--name-only', policy['base'], 'HEAD').splitlines()
    # Include working source when a developer verifies a candidate before committing.
    changed += git(root, 'diff', '--name-only', 'HEAD').splitlines()
    native = provider(root, policy['native_schema'])
    sources = {entry['name']: provider(root, entry) for entry in policy['providers']}
    artifact = wheel(root, policy['consumer_wheel'])
    excluded, optional = {}, {}
    importer = None
    pilot_changed = any(name.startswith(('app/backend/api/preview/', 'app/backend/api/transport/',
        'app/backend/api/cycleways/', 'app/backend/api/map_sources/')) for name in changed)
    if not pilot_changed and not os.environ.get('EGI_APP_BASE_URL'):
        excluded[PILOT] = 'Not applicable: canonical/Community integration; retained 315-record preview cohort/API unchanged. Set EGI_APP_BASE_URL to explicitly select its historical live checks.'
    elif not os.environ.get('EGI_APP_BASE_URL'):
        raise PrerequisiteError('Changed retained-preview contracts require explicit EGI_APP_BASE_URL')
    importer_changed = any(name.startswith(('tests/fixtures/transport-root/',
        'app/backend/api/transport/network.py')) for name in changed)
    if not importer_changed:
        optional[IMPORTER_TEST] = IMPORTER_REASON
    else:
        importer = provider(root, policy['importer_fixture'])
        if not (importer / 'tests/fixtures/transport-root').is_dir():
            raise PrerequisiteError('Changed transport contract requires the identified importer fixture')
    return {'policy': policy, 'sources': sources, 'native_schema': native, 'wheel': artifact,
            'excluded_files': excluded, 'optional_skips': optional, 'importer_source': importer,
            'changed_contract_files': sorted(set(changed))}
