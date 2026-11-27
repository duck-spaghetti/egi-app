"""Provider command failures and explicit test applicability remain observable."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class IntegrationCommandTests(unittest.TestCase):
    """Probe the provider subprocess boundary with exact owned Git source identities."""

    def setUp(self):
        """Create a provider command whose source is immutable and outcome is controllable."""
        self.temp = tempfile.TemporaryDirectory(prefix='egi-integration-command-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.provider = self.root / 'provider'; self.provider.mkdir()
        (self.provider / 'scripts').mkdir()
        (self.provider / 'scripts/check.py').write_text('''import json,subprocess,sys
from pathlib import Path
source=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
mode=Path('.git/outcome').read_text() if Path('.git/outcome').exists() else 'passed'
state='passed' if mode in ('wrong-source','wrong-exit') else mode
print(json.dumps({'schema_version':1,'repository':'database','profile':'integration',
 'source':'f'*40 if mode=='wrong-source' else source,'status':state,'seconds':0,
 'checks':[{'name':'actual-provider-fixture','status':state}]}))
sys.exit(1 if mode=='wrong-exit' else {'passed':0,'failed':1,'blocked':2}[state])
''')
        subprocess.run(['git', 'init', '-q', self.provider], check=True)
        subprocess.run(['git', '-C', self.provider, 'add', '.'], check=True)
        subprocess.run(['git', '-C', self.provider, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                        'commit', '-qm', 'EGI-140: Synthetic provider fixture'], check=True)
        revision = subprocess.check_output(['git', '-C', self.provider, 'rev-parse', 'HEAD'], text=True).strip()
        self.entry = {'name': 'database', 'revision': revision}
        spec = importlib.util.spec_from_file_location('app_provider_integration', ROOT / 'checks/integration.py')
        self.module = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.module)

    def test_failed_and_blocked_provider_results_propagate(self):
        """Actual child exits/report states remain non-success at the consumer boundary."""
        for state in ('passed', 'failed', 'blocked'):
            (self.provider / '.git/outcome').write_text(state)
            result = self.module.check_provider(self.root, self.entry, self.provider)
            self.assertEqual(result.status, state)
            retained = json.loads((self.root / '.local/integration/database.json').read_text())
            self.assertEqual(retained['source'], self.entry['revision'])

    def test_source_or_exit_disagreement_cannot_pass(self):
        """A success label cannot conceal another source or a nonzero child exit."""
        for mode in ('wrong-source', 'wrong-exit'):
            (self.provider / '.git/outcome').write_text(mode)
            self.assertEqual(self.module.check_provider(self.root, self.entry, self.provider).status, 'failed')

    def test_applicability_exclusion_does_not_hide_unknown_skips(self):
        """Declared unrelated files stay named; an unapproved skipped selected test blocks."""
        tests = self.root / 'tests'; tests.mkdir()
        (tests / 'test_retained.py').write_text("raise AssertionError('must not import unselected live setup')\n")
        (tests / 'test_selected.py').write_text("import unittest\nclass Selected(unittest.TestCase):\n @unittest.skip('missing selected fixture')\n def test_case(self): pass\n")
        program = '''import sys,json
from dataclasses import asdict
sys.path.insert(0,sys.argv[1])
from devchecks.python_tests import check
print(json.dumps(asdict(check(sys.argv[2],'integration',excluded_files={'tests/test_retained.py':'Unchanged retained-pilot contract'}))))
'''
        result = subprocess.run([sys.executable, '-c', program, ROOT / 'scripts', self.root], capture_output=True, text=True, check=True)
        observed = json.loads(result.stdout)
        self.assertEqual(observed['status'], 'blocked')
        self.assertTrue(any(t['name'] == 'tests/test_retained.py' and 'Unchanged' in t['reason'] for t in observed['tests']))
        self.assertTrue(any(t['name'].endswith('Selected.test_case') and t['status'] == 'skipped' for t in observed['tests']))
