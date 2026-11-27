"""Check disk-policy boundaries without consuming real filesystem capacity."""
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from devchecks.resources import GIB, PrerequisiteError, preflight


class DiskPolicyTests(unittest.TestCase):
    """Exercise exact byte boundaries of the approved 30/15 GiB policy."""

    def test_boundaries(self):
        """Block below15, warn from15 to below30, and proceed normally at30."""
        with tempfile.TemporaryDirectory() as root:
            for free in (15 * GIB - 1, 0):
                with self.subTest(free=free), self.assertRaises(PrerequisiteError):
                    preflight(root, free)
            for free, warning in ((15 * GIB, True), (15 * GIB + 1, True),
                                  (30 * GIB - 1, True), (30 * GIB, False), (30 * GIB + 1, False)):
                with self.subTest(free=free):
                    self.assertEqual(preflight(root, free)['warning'], warning)

    def test_run_metadata_records_revision_without_command_secrets(self):
        """A receipt contains source identity and a fingerprint, never raw argv credentials."""
        import json, os
        from unittest.mock import patch
        from devchecks.resources import ResourceRun
        root=Path(__file__).resolve().parents[1]
        details={'uid':os.getuid(),'birth':'controlled birth','command':'python --password=PRIVATE_SENTINEL'}
        with patch('devchecks.resources.process_details',return_value=details):
            run=ResourceRun(root)
        try:
            serialized=(run.path/'run.json').read_text()
            self.assertNotIn('PRIVATE_SENTINEL',serialized)
            self.assertEqual(run.record['worktree'],str(root))
            self.assertGreaterEqual(len(run.record['source']),40)
        finally:
            run.close()

    def test_metadata_failures_roll_back_before_postgres_start(self):
        """Unavailable identity or metadata storage cannot leave unrecorded directories."""
        from contextlib import ExitStack
        from unittest.mock import patch
        from devchecks.resources import OwnedCluster, ResourceRun
        root=Path(__file__).resolve().parents[1]
        for target in ('process_identity','source_identity','_write'):
            with tempfile.TemporaryDirectory() as parent, ExitStack() as stack:
                parent=Path(parent).resolve()
                stack.enter_context(patch('devchecks.resources.process_identity',return_value='controlled'))
                stack.enter_context(patch('devchecks.resources.source_identity',return_value={'source':'0'*40,'worktree':str(root)}))
                stack.enter_context(patch('devchecks.resources.'+target,side_effect=PermissionError('controlled metadata failure')))
                with self.assertRaises(PermissionError):
                    ResourceRun(root,parent)
                self.assertEqual(list(parent.iterdir()),[])
        with patch('devchecks.resources.process_identity',return_value='controlled'):
            run=ResourceRun(root)
        with run.activate():
            with patch.object(OwnedCluster,'save',side_effect=OSError('controlled record failure')):
                with patch.object(OwnedCluster,'command') as command:
                    with self.assertRaises(OSError):
                        OwnedCluster(root,'/Library/PostgreSQL/18/bin')
                    command.assert_not_called()
            self.assertEqual([p.name for p in run.path.iterdir()],['run.json'])
