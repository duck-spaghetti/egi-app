"""Observe real PostgreSQL ownership, partial failures and runner reconciliation."""
from pathlib import Path
import os
import subprocess
import sys
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from devchecks.resources import CleanupError, OwnedCluster, PrerequisiteError, ResourceRun, run_check
PG = Path('/Library/PostgreSQL/18/bin')


class ResourceLifecycleTests(unittest.TestCase):
    """Use only new synthetic clusters and verify process plus filesystem outcomes."""

    def test_success_and_repeated_close(self):
        """Successful teardown removes the resource and tolerates a second close."""
        cluster = OwnedCluster(ROOT, PG, 65479, 'egi_resource_success')
        path = cluster.path
        cluster.close()
        cluster.close()
        self.assertFalse(path.exists())

    def test_failed_setup_rolls_back_before_caller_can_register_cleanup(self):
        """An actual server started before createdb failure does not leak."""
        with ResourceRun(ROOT).activate() as run:
            command = OwnedCluster.command
            def fail_createdb(resource, program, *args):
                """Inject only the post-start database creation failure."""
                if program == 'createdb':
                    raise RuntimeError('controlled post-start failure')
                return command(resource, program, *args)
            with patch.object(OwnedCluster, 'command', fail_createdb):
                with self.assertRaisesRegex(RuntimeError, 'controlled post-start'):
                    OwnedCluster(ROOT, PG, 65479, 'egi_resource_failure')
            self.assertEqual([p.name for p in run.path.iterdir()], ['run.json'])

    def test_stop_failure_preserves_data(self):
        """Failed shutdown must not remove a live server's files."""
        cluster = OwnedCluster(ROOT, PG, 65479)
        command = cluster.command
        def fail_stop(program, *args):
            """Simulate unsuccessful pg_ctl stop while leaving PostgreSQL alive."""
            if program == 'pg_ctl' and args[-1] == 'stop':
                raise subprocess.CalledProcessError(1, 'controlled stop failure')
            return command(program, *args)
        try:
            with patch.object(cluster, 'command', side_effect=fail_stop):
                with self.assertRaises(subprocess.CalledProcessError):
                    cluster.close()
            self.assertTrue((cluster.data / 'postmaster.pid').exists())
            self.assertTrue((cluster.data / 'PG_VERSION').exists())
        finally:
            cluster.close()

    def test_concurrent_resources_remain_independent(self):
        """Closing one private socket cluster leaves the other operational."""
        with OwnedCluster(ROOT, PG, 65479) as first, OwnedCluster(ROOT, PG, 65479) as second:
            first.close()
            self.assertEqual(second.command('psql', '-XAt', '-c', 'SELECT 1').stdout.strip(), '1')

    def test_tampered_record_and_reused_pid_are_preserved(self):
        """Contradictory metadata cannot authorize stopping another process."""
        with OwnedCluster(ROOT, PG, 65479) as cluster:
            original = dict(cluster.record)
            cluster.record['server_pid'] = os.getpid()
            cluster.save()
            with self.assertRaises(CleanupError):
                cluster.close()
            self.assertTrue(cluster.data.exists())
            cluster.record = original
            cluster.save()

    def test_symlink_substitution_is_refused(self):
        """A substituted resource directory never grants access to its link target."""
        with OwnedCluster(ROOT, PG, 65479) as cluster:
            path = cluster.path
            moved = path.with_name(path.name + '-held')
            path.rename(moved)
            path.symlink_to(moved, target_is_directory=True)
            try:
                with self.assertRaises(CleanupError):
                    cluster.close()
            finally:
                path.unlink()
                moved.rename(path)

    def test_low_space_allocates_no_cluster(self):
        """A missing disk prerequisite blocks before initdb or resource allocation."""
        with patch('devchecks.resources.preflight', side_effect=PrerequisiteError('controlled low disk')):
            with patch.object(OwnedCluster, 'command') as command:
                with self.assertRaises(PrerequisiteError):
                    OwnedCluster(ROOT, PG)
                command.assert_not_called()

    def test_parent_timeout_reconciles_independent_postgres(self):
        """Timed-out children cannot leave their independently running daemon behind."""
        code = ("from pathlib import Path; from devchecks.resources import OwnedCluster; import time; "
                f"c=OwnedCluster(Path.cwd(),{str(PG)!r},65479); "
                "print(c.path,flush=True); time.sleep(30)")
        before = set(Path('/private/tmp').glob('egi-resource-*'))
        result = run_check('timeout', [sys.executable, '-c', code], ROOT, timeout=2,
                           environment={**os.environ, 'PYTHONPATH': str(ROOT / 'scripts')})
        self.assertEqual(result.status, 'blocked')
        self.assertEqual(set(Path('/private/tmp').glob('egi-resource-*')) - before, set())

    def test_primary_and_cleanup_errors_are_both_reported(self):
        """Failed cleanup retains the original diagnostic."""
        with ResourceRun(ROOT).activate():
            cluster = OwnedCluster(ROOT, PG, 65479)
            with patch.object(cluster, 'close', side_effect=CleanupError('controlled cleanup')):
                with self.assertRaisesRegex(CleanupError, 'original.*controlled cleanup'):
                    with cluster:
                        raise RuntimeError('original')
            cluster.close()

    def test_catchable_signal_unwinds_own_run(self):
        """SIGTERM unwinds a live scope and stops the actual PostgreSQL daemon."""
        code = '''from pathlib import Path
import os, signal
from devchecks.resources import OwnedCluster, ResourceRun
with ResourceRun(Path.cwd()).activate():
    c=OwnedCluster(Path.cwd(), '/Library/PostgreSQL/18/bin',65479)
    os.kill(os.getpid(),signal.SIGTERM)
'''
        before = set(Path('/private/tmp').glob('egi-resource-*'))
        result = run_check('signal', [sys.executable, '-c', code], ROOT,
                           environment={**os.environ, 'PYTHONPATH': str(ROOT / 'scripts')})
        self.assertEqual(result.status, 'failed')
        self.assertEqual(set(Path('/private/tmp').glob('egi-resource-*')) - before, set())

    def test_app_fixture_schema_failure_rolls_back(self):
        """The actual app fixture cleans even when schema deployment fails in its constructor."""
        import importlib.util
        spec = importlib.util.spec_from_file_location('resource_app_fixture', ROOT / 'tests/native.py')
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        with ResourceRun(ROOT).activate() as run:
            with patch.object(fixture, 'REPOSITORY', str(ROOT)), patch.object(fixture.Cluster, 'sql', side_effect=RuntimeError('controlled schema failure')):
                with self.assertRaisesRegex(RuntimeError, 'controlled schema'):
                    fixture.Cluster(65479, 'egi_fixture_rollback')
            self.assertEqual([p.name for p in run.path.iterdir()], ['run.json'])
