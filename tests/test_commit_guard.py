"""Real disposable Git histories verify titles, bypass resistance and push checks."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "scripts/commit_guard.py"


class CommitGuardTests(unittest.TestCase):
    """Probe the public guard CLI with actual commit objects and owning check reports."""

    def setUp(self):
        """Create a synthetic Git repository and a controllable owning check command."""
        (ROOT / ".local").mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="git-policy-", dir=ROOT / ".local")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Fixture")
        (self.root / "scripts").mkdir()
        (self.root / "scripts/check.py").write_text(
            "import json,subprocess,sys\nfrom pathlib import Path\n"
            "mode=Path('.git/check-mode').read_text() if Path('.git/check-mode').exists() else 'passed'\n"
            "mode=('blocked' if sys.argv[-1]=='integration' else 'passed') if mode=='integration-only' else mode\n"
            "print(json.dumps({'schema_version':1,'profile':sys.argv[-1],"
            "'source':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'status':mode}))\n")
        self.base = self.commit("EGI-1: Fixture baseline")

    def git(self, *args):
        """Run Git only in this test's owned temporary repository."""
        return subprocess.check_output(["git", "-C", str(self.root), *args], text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self, title):
        """Create an actual object, deliberately bypassing local hooks when requested by a test."""
        self.git("add", ".")
        self.git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-q", "-m", title)
        return self.git("rev-parse", "HEAD")

    def command(self, *args, input=None):
        """Observe public validation exit/messages, including stdin push updates."""
        return subprocess.run([sys.executable, GUARD, "--root", self.root, *args],
                              input=input, text=True, capture_output=True, timeout=30)

    def test_title_and_commit_body(self):
        """The format applies to the subject, with additional references allowed in the body."""
        message = self.root / ".git/message"
        for title, valid in [("EGI-129: Add checks\n\nAlso EGI-130", True), ("EGI-0: Invalid", False),
                             ("Checks (EGI-129)", False), ("EGI-129: ", False), ("Merge branch 'pretend'", False)]:
            message.write_text(title)
            self.assertEqual(self.command("commit-msg", str(message)).returncode == 0, valid, title)

    def test_bypassed_bad_commit_fails_range(self):
        """CI/pre-push sees invalid objects even when commit-msg was not installed."""
        tip = self.commit("Bypassed invalid title")
        self.assertNotEqual(self.command("range", self.base, tip).returncode, 0)

    def test_workflow_changes_require_integration(self):
        """A workflow edit cannot be delivered with only a passing Complete profile."""
        workflow = self.root / '.github/workflows/checks.yml'
        workflow.parent.mkdir(parents=True)
        workflow.write_text('name: Synthetic workflow\n')
        tip = self.commit('EGI-140: Change workflow boundary')
        (self.root / '.git/check-mode').write_text('integration-only')
        update = f'refs/heads/checks {tip} refs/heads/checks {self.base}\n'
        self.assertNotEqual(self.command('pre-push', input=update).returncode, 0)

    def test_exact_legacy_exception_does_not_exempt_another_commit(self):
        """Only an inventoried published identity is grandfathered."""
        legacy = self.commit("Historical fixture")
        (self.root / ".checks").mkdir()
        (self.root / ".checks/commit-exceptions.json").write_text(json.dumps(
            {"schema_version": 1, "commits": {legacy: "Synthetic published exception"}}))
        tip = self.commit("EGI-2: Record exception")
        self.assertEqual(self.command("range", self.base, tip).returncode, 0)
        bad = self.commit("Another invalid commit")
        self.assertNotEqual(self.command("range", self.base, bad).returncode, 0)

    def test_revert_must_identify_an_existing_commit(self):
        """A generated revert has an existing target and the ordinary Git message shape."""
        message = self.root / ".git/message"
        message.write_text('Revert "Fixture baseline"\n\nThis reverts commit ' + self.base + '.\n')
        self.assertEqual(self.command("commit-msg", str(message)).returncode, 0)
        message.write_text('Revert "Fixture baseline"\n\nThis reverts commit ' + '0'*40 + '.\n')
        self.assertNotEqual(self.command("commit-msg", str(message)).returncode, 0)

    def test_push_requires_clean_source_and_passed_complete(self):
        """A zero-exit check with blocked status cannot permit delivery."""
        tip = self.commit("EGI-3: Checkpoint")
        update = f"refs/heads/dev {tip} refs/heads/dev {self.base}\n"
        self.assertEqual(self.command("pre-push", input=update).returncode, 0)
        (self.root / ".git/check-mode").write_text("blocked")
        self.assertNotEqual(self.command("pre-push", input=update).returncode, 0)
        (self.root / ".git/check-mode").write_text("passed")
        (self.root / "uncommitted").write_text("changed source")
        self.assertNotEqual(self.command("pre-push", input=update).returncode, 0)

    def test_shared_change_requires_integration(self):
        """A shared contract edit invokes both Complete and Integration."""
        source = self.root / "app/backend/api"
        source.mkdir(parents=True)
        (source / "fixture.py").write_text("# Fixture shared boundary\n")
        tip = self.commit("EGI-4: Shared boundary")
        update = f"refs/heads/dev {tip} refs/heads/dev {self.base}\n"
        self.assertEqual(self.command("pre-push", input=update).returncode, 0)
        (self.root / ".git/check-mode").write_text("blocked")
        self.assertNotEqual(self.command("pre-push", input=update).returncode, 0)


    def test_actual_merge_parents_are_exempt(self):
        """Generated merge titles require a real merge object, not a spoofed subject."""
        branch=self.git("branch","--show-current")
        self.git("checkout","-q","-b","fixture-other")
        (self.root/"other.txt").write_text("other")
        self.commit("EGI-5: Other side")
        self.git("checkout","-q",branch)
        (self.root/"main.txt").write_text("main")
        self.commit("EGI-6: Main side")
        self.git("merge","--no-ff","--no-edit","fixture-other")
        self.assertEqual(self.command("range",self.base,"HEAD").returncode,0)
        spoofed=self.commit("Merge branch 'pretend'")
        self.assertNotEqual(self.command("range",self.base,spoofed).returncode,0)

    def test_real_hook_rejects_commit_without_running_complete(self):
        """Scoped installation rejects a bad commit but permits valid checkpoints."""
        import shlex
        sys.path.insert(0,str(ROOT/"scripts"))
        from install_hooks import install
        hooks=self.root/".githooks";hooks.mkdir()
        (hooks/"commit-msg").write_text("#!/bin/sh\nexec "+shlex.quote(sys.executable)+" "+shlex.quote(str(GUARD))+" --root "+shlex.quote(str(self.root))+" commit-msg \"$1\"\n")
        (hooks/"pre-push").write_text("#!/bin/sh\nexec "+shlex.quote(sys.executable)+" "+shlex.quote(str(GUARD))+" --root "+shlex.quote(str(self.root))+" pre-push\n")
        remote=self.root/'.git/remote-fixture.git'
        self.git('init','--bare','-q',str(remote))
        self.git('push','-q',str(remote),self.base+':refs/heads/dev')
        sibling=self.root/'.git/other-worktree'
        self.git('worktree','add','--detach','-q',str(sibling),self.base)
        self.addCleanup(lambda:self.git('worktree','remove','--force',str(sibling)))
        install(self.root)
        other=subprocess.run(['git','-C',str(sibling),'config','--get','core.hooksPath'],capture_output=True)
        self.assertNotEqual(other.returncode,0,'hook activation must not leak into another worktree')
        rejected=subprocess.run(["git","-C",str(self.root),"commit","--allow-empty","-m","Invalid title"],capture_output=True)
        self.assertNotEqual(rejected.returncode,0)
        self.assertEqual(self.git("rev-parse","HEAD"),self.base)
        (self.root/".git/check-mode").write_text("blocked")
        self.git("add",".")
        self.git("commit","--allow-empty","-q","-m","EGI-7: Incomplete checkpoint")
        self.assertEqual(self.git("config","--worktree","--get","core.hooksPath"),str(hooks))
        refused=subprocess.run(['git','-C',str(self.root),'push',str(remote),'HEAD:refs/heads/dev'],capture_output=True)
        self.assertNotEqual(refused.returncode,0)
        self.assertEqual(self.git('--git-dir='+str(remote),'rev-parse','refs/heads/dev'),self.base)
        (self.root/'.git/check-mode').write_text('passed')
        self.git('push','-q',str(remote),'HEAD:refs/heads/dev')
        self.assertEqual(self.git('--git-dir='+str(remote),'rev-parse','refs/heads/dev'),self.git('rev-parse','HEAD'))


    def test_integration_failure_survives_complete_success(self):
        """A shared-boundary push stays refused when only Integration is blocked."""
        source=self.root/"app/backend/api";source.mkdir(parents=True)
        (source/"fixture.py").write_text("# changed boundary")
        tip=self.commit("EGI-8: Shared change")
        (self.root/".git/check-mode").write_text("integration-only")
        result=self.command("pre-push",input=f"refs/heads/dev {tip} refs/heads/dev {self.base}\n")
        self.assertNotEqual(result.returncode,0)
        self.assertIn("Required integration checks not passed",result.stderr)

    def test_native_and_orchestration_changes_require_integration(self):
        """Native fixtures and the provider orchestrator cannot pass with Complete alone."""
        for name in ('checks/integration.py', 'tests/native.py', 'tests/test_example_native.py'):
            with self.subTest(path=name):
                base = self.git('rev-parse', 'HEAD')
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('# controlled native boundary\n')
                tip = self.commit('EGI-140: Change native boundary')
                (self.root / '.git/check-mode').write_text('integration-only')
                update = f'refs/heads/checks {tip} refs/heads/checks {base}\n'
                result = self.command('pre-push', input=update)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Required integration checks not passed', result.stderr)
