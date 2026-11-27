"""Public profile commands must discover new tests and propagate missing/failing work."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ProfileCommandTests(unittest.TestCase):
    """Probe the command with disposable repository contents, not private call order."""

    def setUp(self):
        """Prepare a small owned fixture with a passing Python and Node suite."""
        scratch = ROOT / ".local"
        scratch.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="profile-fixture-", dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "tests").mkdir()
        (self.root / "tests/test_profile_example.py").write_text(
            "import unittest\nclass Example(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n")
        (self.root / "tests/test_example.cjs").write_text("require('node:assert/strict').equal(1,1);\n")

    def command(self, profile="quick", environment=None):
        """Observe the same report and exit interface used by contributors/hooks."""
        run = subprocess.run([sys.executable, ROOT / "scripts/check.py", "--json", "--root", self.root,
                              "--profile", profile], text=True, capture_output=True,
                             env=environment, timeout=60)
        self.assertTrue(run.stdout, run.stderr)
        return run.returncode, json.loads(run.stdout)

    def test_new_suite_and_failure_are_discovered(self):
        """A newly added failing suite changes the command result without a list edit."""
        before, first = self.command()
        self.assertEqual(before, 2)  # ESLint is deliberately absent in this fixture.
        (self.root / "tests/test_newly_added.py").write_text(
            "import unittest\nclass Added(unittest.TestCase):\n def test_bad(self): self.fail('controlled fault')\n")
        after, result = self.command()
        self.assertEqual(after, 1)
        python = next(item for item in result["checks"] if item["name"] == "python")
        self.assertTrue(any("Added.test_bad" in item["name"] for item in python["tests"]))

    def test_missing_node_is_blocked(self):
        """An unavailable runtime is a named blocker, never a successful omission."""
        code, result = self.command(environment={**os.environ, "PATH": "/unavailable-runtime-fixture"})
        self.assertEqual(code, 2)
        self.assertTrue(any(item["name"] == "javascript" and item["status"] == "blocked"
                            for item in result["checks"]))

    def test_complete_requires_unimplemented_stages(self):
        """Complete cannot be reported green while browser/offline/PDF are missing."""
        code, result = self.command("complete")
        self.assertEqual(code, 2)
        blocked = {item["name"] for item in result["checks"] if item["status"] == "blocked"}
        self.assertTrue({"browser", "offline", "pdf"} <= blocked)

    def test_unexpected_skip_blocks_selected_tests(self):
        """A newly skipped required case remains a visible unmet prerequisite."""
        (self.root / "tests/test_profile_example.py").write_text(
            "import unittest\nclass Example(unittest.TestCase):\n @unittest.skip('missing fixture')\n def test_ok(self): pass\n")
        code, result = self.command()
        self.assertEqual(code, 2)
        python = next(item for item in result["checks"] if item["name"] == "python")
        self.assertEqual(python["status"], "blocked")
        self.assertEqual(python["tests"][0]["reason"], "missing fixture")

    def test_hook_git_routing_cannot_redirect_checked_fixture(self):
        """Inherited hook routing cannot redirect fixture Git operations or source identity."""
        clean = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        subprocess.run(['git', 'init', '-q', self.root], env=clean, check=True)
        subprocess.run(['git', '-C', self.root, '-c', 'user.name=Fixture', '-c',
                        'user.email=fixture@example.invalid', 'commit', '--allow-empty',
                        '-qm', 'EGI-140: Fixture'], env=clean, check=True)
        source = subprocess.check_output(['git', '-C', self.root, 'rev-parse', 'HEAD'],
                                         env=clean, text=True).strip()
        (self.root / 'tests/test_profile_example.py').write_text(
            "import subprocess, unittest\nfrom pathlib import Path\nclass Example(unittest.TestCase):\n"
            " def test_ok(self): subprocess.run(['git','-C',str(Path(__file__).resolve().parents[1]),'status','--porcelain'],check=True,capture_output=True)\n")
        code, result = self.command(environment={**os.environ, 'GIT_DIR': '/unavailable-foreign-git'})
        self.assertEqual(code, 2, result)  # Fixture still lacks ESLint; Python must pass.
        self.assertEqual(result['source'], source)
        self.assertEqual(next(item for item in result['checks'] if item['name'] == 'python')['status'], 'passed')
