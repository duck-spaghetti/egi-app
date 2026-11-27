"""Run controlled native suites with verified, externally owned resource tooling.

The app consumes the selected resource checkout; it neither copies that module nor
adopts another run's databases. This module is developer tooling, never runtime code.
"""
import argparse
import importlib
import os
from pathlib import Path
import subprocess
import sys

RESOURCE_REVISION = '84044a266dcbabab8319c9f5682d0437c7bea732'
ROOT = Path(__file__).resolve().parents[1]


def resources():
    """Import resource helpers only after their selected checkout matches the pin."""
    selected = os.environ.get('EGI_RESOURCE_TOOLS_REPO')
    if not selected:
        raise RuntimeError('EGI_RESOURCE_TOOLS_REPO must select the pinned resource checkout')
    checkout = Path(selected).resolve(strict=True)
    environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    head = subprocess.run(['git', '-C', str(checkout), 'rev-parse', 'HEAD'],
        env=environment, check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    if head != RESOURCE_REVISION:
        raise RuntimeError('Resource tooling revision differs from the reviewed pin')
    for relative in ('scripts/devchecks/__init__.py', 'scripts/devchecks/resources.py',
                     'scripts/devchecks/report.py'):
        original = subprocess.run(['git', '-C', str(checkout), 'show', f'{head}:{relative}'],
            env=environment, check=True, capture_output=True, timeout=10).stdout
        if (checkout / relative).read_bytes() != original:
            raise RuntimeError('Resource tooling bytes differ from the reviewed pin')
    directory = checkout / 'scripts'
    for name in ('devchecks', 'devchecks.resources', 'devchecks.report'):
        module = sys.modules.get(name)
        if module is not None and not Path(module.__file__).resolve().is_relative_to(directory):
            raise RuntimeError('Another resource tooling checkout is already imported')
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))
    return importlib.import_module('devchecks.resources')


def main():
    """Execute only the requested unittest suites under timeout and owned cleanup."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('suites', nargs='+')
    args = parser.parse_args()
    if not 1 <= args.timeout <= 1800:
        parser.error('timeout must be between 1 and 1800 seconds')
    result = resources().run_check('cw1-native',
        [sys.executable, '-B', '-m', 'unittest', *args.suites, '-v'], ROOT,
        timeout=args.timeout, environment={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    print(f'{result.name}: {result.status} ({result.seconds:.3f}s)')
    print(result.reason)
    return 0 if result.status == 'passed' else 2 if result.status == 'blocked' else 1


if __name__ == '__main__':
    raise SystemExit(main())
