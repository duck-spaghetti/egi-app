"""Observe real PostgreSQL ownership, partial failures and runner reconciliation."""
from pathlib import Path
from contextlib import contextmanager
import os
import subprocess
import sys
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from devchecks.resources import CleanupError, OwnedCluster, PrerequisiteError, ResourceRun, run_check
PG = Path(os.environ.get('EGI_PG_BIN', '/Library/PostgreSQL/18/bin'))


@contextmanager
def parent_runs():
    """Capture only runs allocated by this test parent, leaving concurrent work uncounted."""
    allocated = []
    original = ResourceRun.__init__
    def remember(run, *args, **kwargs):
        """Retain the parent-held capability solely for this test's cleanup assertions."""
        original(run, *args, **kwargs)
        allocated.append(run)
    with patch.object(ResourceRun, '__init__', remember):
        yield allocated


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
                with self.assertRaises(CleanupError):
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
        with parent_runs() as allocated:
            result = run_check('timeout', [sys.executable, '-c', code], ROOT, timeout=2,
                               environment={**os.environ, 'PYTHONPATH': str(ROOT / 'scripts')})
        self.assertEqual(result.status, 'blocked')
        self.assertTrue(allocated)
        self.assertTrue(all(not run.path.exists() for run in allocated))

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
with ResourceRun(Path.cwd()).activate() as run:
    print(run.path,flush=True)
    c=OwnedCluster(Path.cwd(), os.environ.get('EGI_PG_BIN', '/Library/PostgreSQL/18/bin'),65479)
    os.kill(os.getpid(),signal.SIGTERM)
'''
        with parent_runs() as allocated:
            result = run_check('signal', [sys.executable, '-c', code], ROOT,
                               environment={**os.environ, 'PYTHONPATH': str(ROOT / 'scripts')})
        self.assertEqual(result.status, 'failed')
        self.assertTrue(all(not run.path.exists() for run in allocated))
        child_paths=[Path(line) for line in result.reason.splitlines() if line.startswith('/private/tmp/egi-resource-')]
        self.assertEqual(len(child_paths),1)
        self.assertFalse(child_paths[0].exists())

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

    def test_inherited_run_checks_its_actual_allocation_root(self):
        """An inherited custom root is checked rather than the constructor default."""
        from devchecks.resources import preflight
        with ResourceRun(ROOT).activate() as run:
            with patch('devchecks.resources.preflight',wraps=preflight) as observed:
                with OwnedCluster(ROOT,PG,65479):
                    pass
            observed.assert_called_once_with(run.path)

    def test_parent_shutdown_errors_are_failed_and_preserve_evidence(self):
        """Real parent reconciliation converts nonzero and timed-out stops into failed."""
        original_init=ResourceRun.__init__
        code=("from pathlib import Path; from devchecks.resources import OwnedCluster; "
              f"c=OwnedCluster(Path.cwd(),{str(PG)!r},65479)")
        for failure in (subprocess.CalledProcessError(1,'controlled'),subprocess.TimeoutExpired('controlled',.01)):
            allocated=[]
            def remember(run,*args,**kwargs):
                """Retain the test's own capability for cleanup after the injected fault."""
                original_init(run,*args,**kwargs);allocated.append(run)
            original_command=OwnedCluster.command
            def fail_stop(resource,program,*args):
                """Inject shutdown failure only in the supervising parent process."""
                if program=='pg_ctl' and args[-1]=='stop':
                    raise failure
                return original_command(resource,program,*args)
            try:
                with patch.object(ResourceRun,'__init__',remember),patch.object(OwnedCluster,'command',fail_stop):
                    result=run_check('stop-fault',[sys.executable,'-c',code],ROOT,
                                     environment={**os.environ,'PYTHONPATH':str(ROOT/'scripts')})
                self.assertEqual(result.status,'failed',result.reason)
                self.assertIn('files preserved',result.reason)
                receipt=ROOT/'.local/resource-last-failure.json'
                self.assertTrue(receipt.exists())
                self.assertTrue(any(allocated[0].path.glob('pg-*/data/PG_VERSION')))
            finally:
                for run in allocated:
                    run.close()

    def test_initial_capture_rejects_data_path_prefix_collision(self):
        """A foreign -D argument with the owned path as prefix is not an exact identity."""
        with OwnedCluster(ROOT,PG,65479) as cluster:
            from devchecks.resources import process_details
            actual=process_details(cluster.record['server_pid'])
            foreign={**actual,'command':str(PG/'postgres')+' -D '+str(cluster.data)+'-other'}
            with patch('devchecks.resources.process_details',return_value=foreign):
                with self.assertRaises(CleanupError):
                    cluster.capture_server()

    def test_forced_owner_death_is_discoverable_without_automatic_cleanup(self):
        """SIGKILL leaves attributable resources; the inspector only reports them."""
        import json
        import select
        from devchecks.environments import Inventory
        code = '''from pathlib import Path
import json,time,os
from devchecks.resources import ResourceRun,OwnedCluster
with ResourceRun(Path.cwd()).activate() as run:
    print(json.dumps({'path':str(run.path),'capability':run.token}),flush=True)
    cluster=OwnedCluster(Path.cwd(),os.environ.get('EGI_PG_BIN', '/Library/PostgreSQL/18/bin'),65479)
    print('ready',flush=True)
    time.sleep(30)
'''
        child=subprocess.Popen([sys.executable,'-c',code],cwd=ROOT,
                               env={**os.environ,'PYTHONPATH':str(ROOT/'scripts')},
                               stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        run=None
        try:
            self.assertTrue(select.select([child.stdout],[],[],10)[0])
            receipt=json.loads(child.stdout.readline())
            with patch.dict(os.environ,{'EGI_RESOURCE_RUN':receipt['path'],
                                        'EGI_RESOURCE_CAPABILITY':receipt['capability']}):
                run=ResourceRun.inherited()
            self.assertTrue(select.select([child.stdout],[],[],10)[0])
            self.assertEqual(child.stdout.readline().strip(),'ready')
            child.kill();child.wait(timeout=5)
            result=Inventory(ROOT).collect()
            entries=[entry for entry in result['entries'] if entry.get('run_id')==run.record['run_id']]
            self.assertEqual(len(entries),1)
            self.assertEqual(entries[0]['disposition'],'residue-for-review')
            self.assertEqual(entries[0]['state'],'running')
            self.assertTrue(Path(entries[0]['path']).exists())
        finally:
            if child.poll() is None:
                child.kill();child.wait(timeout=5)
            child.stdout.close();child.stderr.close()
            if run:
                run.close()

    def test_direct_app_fixture_records_app_not_schema_provider(self):
        """Standalone fixture ownership refers to the app checkout, not the selected schema repo."""
        import importlib.util
        spec=importlib.util.spec_from_file_location('direct_app_fixture',ROOT/'tests/native.py')
        fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
        with patch.dict(os.environ):
            os.environ.pop('EGI_RESOURCE_RUN',None)
            os.environ.pop('EGI_RESOURCE_CAPABILITY',None)
            with parent_runs() as allocated:
                with patch.object(fixture,'REPOSITORY','/private/tmp/selected-schema-provider'),patch.object(fixture.Cluster,'sql',side_effect=RuntimeError('controlled schema failure')):
                    with self.assertRaisesRegex(RuntimeError,'controlled schema'):
                        fixture.Cluster(65479,'egi_direct_fixture')
        self.assertEqual(allocated[0].record['repository'],str(ROOT))
        self.assertFalse(allocated[0].path.exists())
