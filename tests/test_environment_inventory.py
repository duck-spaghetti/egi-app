"""Observe inventory classification, partial access and non-mutation on isolated roots."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from devchecks.environments import Inventory


class EnvironmentInventoryTests(unittest.TestCase):
    """Keep data and process snapshots independent from lifecycle mutation."""

    def setUp(self):
        """Create an isolated workspace/temporary root with controlled process discovery."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name).resolve()
        self.temporary = self.workspace / 'temporary'
        self.temporary.mkdir()
        self.patch = patch.object(Inventory, 'servers', lambda instance: None)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_persistent_backup_unknown_and_read_only(self):
        """All categories are visible and data bytes/mtime remain unchanged."""
        local = self.workspace / '.local'
        data = local / 'demo-db/data'
        data.mkdir(parents=True)
        file = data / 'PG_VERSION'
        file.write_text('18')
        backup = local / 'backups/snapshot'
        backup.mkdir(parents=True)
        unknown = self.temporary / 'egi-app-native-old'
        unknown.mkdir()
        before = (file.read_bytes(), file.stat().st_mtime_ns)
        result = Inventory(self.workspace, self.temporary).collect()
        self.assertEqual({x['category'] for x in result['entries']}, {'persistent', 'backup', 'unknown'})
        self.assertEqual((file.read_bytes(), file.stat().st_mtime_ns), before)
        self.assertTrue(result['read_only'])
        self.assertEqual(result['errors'], [])

    def test_active_other_run_is_preserved_and_dead_owner_needs_review(self):
        """An active owner is never called an orphan; an absent owner is review-only."""
        run_path = self.temporary / 'egi-resource-recorded'
        run_path.mkdir()
        record = {'run_id': 'synthetic', 'repository': str(ROOT), 'owner_pid': os.getpid(),
                  'owner_identity': 'controlled', 'created_at': 1}
        (run_path / 'run.json').write_text(json.dumps(record))
        with patch('devchecks.environments.process_identity', return_value='controlled'):
            result = Inventory(self.workspace, self.temporary).collect()
        self.assertEqual(result['entries'][0]['disposition'], 'active-run-preserve')
        with patch('devchecks.environments.process_identity', return_value=None):
            result = Inventory(self.workspace, self.temporary).collect()
        self.assertEqual(result['entries'][0]['disposition'], 'residue-for-review')
        self.assertTrue(run_path.exists())

    def test_symlink_is_not_followed(self):
        """A temporary candidate pointing outside the selected roots stays unverified."""
        outside = self.workspace / 'outside'
        outside.mkdir()
        (outside / 'secret').write_text('PRIVATE_SENTINEL')
        candidate = self.temporary / 'egi-resource-link'
        candidate.symlink_to(outside, target_is_directory=True)
        result = Inventory(self.workspace, self.temporary).collect()
        self.assertEqual(result['status'], 'partial')
        self.assertIsNone(result['entries'][0]['allocated_bytes'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_inaccessible_size_is_unknown_not_zero(self):
        """A filesystem error remains partial rather than silently understating allocation."""
        candidate = self.temporary / 'egi-app-native-denied'
        candidate.mkdir()
        original = os.scandir
        def denied(path):
            """Deny just the candidate subtree, preserving ordinary discovery."""
            if Path(path) == candidate:
                raise PermissionError('controlled')
            return original(path)
        with patch('devchecks.environments.os.scandir', side_effect=denied):
            result = Inventory(self.workspace, self.temporary).collect()
        self.assertEqual(result['status'], 'partial')
        self.assertIsNone(result['entries'][0]['allocated_bytes'])
        self.assertEqual(result['errors'][0]['error'], 'PermissionError')

    def test_duplicate_process_path_is_not_double_counted(self):
        """A cluster seen through a root and process list yields one entry."""
        candidate = self.temporary / 'egi-app-native-once'
        (candidate / 'data').mkdir(parents=True)
        inventory = Inventory(self.workspace, self.temporary)
        inventory.processes[str(candidate / 'data')] = {'pid': 321, 'uid': os.getuid()}
        result = inventory.collect()
        self.assertEqual(len(result['entries']), 1)
        self.assertEqual(result['entries'][0]['state'], 'running')

    def test_process_failure_is_explicit(self):
        """No process visibility produces unverifiable states and a partial report."""
        self.patch.stop()
        candidate = self.temporary / 'egi-app-native-no-process-access'
        candidate.mkdir()
        with patch('devchecks.environments.subprocess.run', side_effect=PermissionError('controlled')):
            result = Inventory(self.workspace, self.temporary).collect()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['entries'][0]['state'], 'unverifiable')

    def test_command_arguments_and_metadata_secrets_are_not_published(self):
        """Only curated process and metadata fields enter the output."""
        self.patch.stop()
        candidate = self.temporary / 'egi-resource-private'
        candidate.mkdir()
        record = {'run_id': 'synthetic', 'owner_pid': 900, 'owner_identity': 'x',
                  'capability_hash': 'PRIVATE_SENTINEL', 'dsn': 'PRIVATE_SENTINEL'}
        (candidate / 'run.json').write_text(json.dumps(record))
        process = subprocess.CompletedProcess([], 0, f'123 {os.getuid()} /bin/postgres -D {candidate}/data --password=PRIVATE_SENTINEL\n')
        with patch('devchecks.environments.subprocess.run', return_value=process), patch('devchecks.environments.process_identity', return_value=None):
            result = Inventory(self.workspace, self.temporary).collect()
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_cli_partial_result_has_non_success_exit(self):
        """The public command retains partial errors in its JSON and exit2."""
        import importlib.util
        import io
        from contextlib import redirect_stdout
        spec=importlib.util.spec_from_file_location('inventory_cli',ROOT/'scripts/environments.py')
        cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
        result={'schema_version':1,'status':'partial','entries':[],
                'errors':[{'operation':'controlled','path':str(self.workspace),'error':'PermissionError'}],
                'read_only':True}
        output=io.StringIO()
        with patch.object(cli.Inventory,'collect',return_value=result),redirect_stdout(output):
            status=cli.main(['status','--workspace',str(self.workspace),'--json'])
        self.assertEqual(status,2)
        self.assertEqual(json.loads(output.getvalue()),result)
