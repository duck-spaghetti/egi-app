"""Compose identified owning provider commands; preserve their reports and artifact identity."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from devchecks.integration import prepare, git
from devchecks.report import Check, report, exit_code
from devchecks.resources import PrerequisiteError


def check_provider(root, entry, target):
    """Run the provider's public command, reject protocol/source drift and retain actual output."""
    environment = dict(os.environ, EGI_DEVTOOLS_SOURCE=str(root))
    destination = root / '.local/integration'
    destination.mkdir(parents=True, exist_ok=True)
    try:
        interpreter = (os.environ.get(entry['python_environment'], str(root / entry['python']))
                       if 'python_environment' in entry else sys.executable)
        result = subprocess.run([interpreter, target / 'scripts/check.py', '--profile', 'integration', '--json'],
            cwd=target, env=environment, capture_output=True, text=True, timeout=900)
        (destination / (entry['name'] + '.json')).write_text(result.stdout)
        (destination / (entry['name'] + '.stderr.log')).write_text(result.stderr[-8192:])
        value = json.loads(result.stdout)
        if (value.get('schema_version') != 1 or value.get('source') != entry['revision']
                or value.get('profile') != 'integration' or value.get('repository') != entry['name']
                or not value.get('checks')):
            return Check(entry['name'], 'failed', 'Invalid provider protocol/source/profile identity')
        state = value['status']
        if state not in ('passed', 'failed', 'blocked') or result.returncode != {'passed':0,'failed':1,'blocked':2}.get(state):
            return Check(entry['name'], 'failed', 'Provider exit/report disagreement')
        if state == 'passed' and any(item['status'] in ('failed','blocked') for item in value['checks']):
            return Check(entry['name'], 'failed', 'Provider aggregate contradicts its stages')
        details = {'source': value['source'], 'report': str(destination / (entry['name'] + '.json')),
                   'stages': [{'name': item['name'], 'status': item['status']} for item in value['checks']]}
        if entry['name'] == 'reviewer' and state == 'passed':
            receipt = json.loads((target / '.local/wheel-last.json').read_text())
            if receipt['source'] != entry['revision'] or receipt['sha256'] != entry['wheel_sha256']:
                return Check('reviewer', 'failed', 'Provider wheel identity differs from the integration pin')
            details['artifact'] = receipt
        return Check(entry['name'], state, json.dumps(details), value.get('seconds', 0))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return Check(entry['name'], 'blocked', 'Provider command/report prerequisite unavailable')


def main():
    """Emit one composed report; a missing or failed provider is never a passed app stage."""
    try:
        context = prepare(ROOT)
        checks = [check_provider(ROOT, entry, context['sources'][entry['name']])
                  for entry in context['policy']['providers']]
        checks.append(Check('native-schema-identity', 'passed', git(context['native_schema'], 'rev-parse', 'HEAD')))
        checks.append(Check('consumer-wheel-identity', 'passed', json.dumps(context['policy']['consumer_wheel'])))
    except (PrerequisiteError, OSError, ValueError, KeyError, subprocess.SubprocessError):
        checks = [Check('integration-prerequisites', 'blocked', 'Identified provider/schema/wheel prerequisites unavailable')]
    result = report('app', 'integration', ROOT, checks)
    destination = ROOT / '.local/integration'
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'combined.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return exit_code(result)


if __name__ == '__main__':
    raise SystemExit(main())
