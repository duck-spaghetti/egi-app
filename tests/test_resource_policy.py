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
