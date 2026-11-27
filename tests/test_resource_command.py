"""Probe app public-runner resource prerequisites and child exit-code propagation."""
from pathlib import Path
import json
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ResourceCommandTests(unittest.TestCase):
    """Verify schema1 cannot hide blocked native or browser prerequisites."""

    def test_integration_low_disk_blocks_before_tests(self):
        """No native setup is entered when the disk prerequisite is blocked."""
        code = '''from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0,'scripts')
from devchecks.resources import PrerequisiteError
from check import main
with patch('check.preflight',side_effect=PrerequisiteError('controlled below15 GiB')):
    raise SystemExit(main(['--profile','integration','--json']))
'''
        result = subprocess.run([sys.executable, '-c', code], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['status'], 'blocked')
        self.assertEqual([x['name'] for x in report['checks']], ['resource-preflight'])

    def test_stage_exit_two_remains_blocked(self):
        """Browser/offline/PDF exit2 is blocked rather than a false product failure."""
        code = '''from pathlib import Path
import sys
sys.path.insert(0,'scripts')
from devchecks.resources import run_check
r=run_check('stage',[sys.executable,'-c','raise SystemExit(2)'],Path.cwd())
print(r.status)
'''
        result = subprocess.run([sys.executable, '-c', code], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'blocked')
