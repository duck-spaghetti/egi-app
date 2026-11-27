"""Discover selected unittest cases and expose every skip by identity/reason."""
import io
from pathlib import Path
import sys
import time
import unittest

from .report import Check


class Results(unittest.TextTestResult):
    """Retain public unittest outcomes without parsing its human output."""

    def __init__(self, *args):
        """Initialize the ordinary unittest result and structured observations."""
        super().__init__(*args)
        self.observations = []

    def addSuccess(self, test):
        """Record one successful behavior test."""
        super().addSuccess(test)
        self.observations.append({"name": test.id(), "status": "passed"})

    def addSkip(self, test, reason):
        """Keep every skipped prerequisite explicit; policy is applied afterward."""
        super().addSkip(test, reason)
        self.observations.append({"name": test.id(), "status": "skipped", "reason": reason})

    def addFailure(self, test, error):
        """Record the failing test independently of its traceback formatting."""
        super().addFailure(test, error)
        self.observations.append({"name": test.id(), "status": "failed"})

    def addError(self, test, error):
        """Treat discovery/runtime errors as non-successful test outcomes."""
        super().addError(test, error)
        self.observations.append({"name": test.id(), "status": "failed"})


def integration_file(path):
    """Identify existing live/backend suites before importing their setup code."""
    return path.stem.endswith("_native") or path.name == "test_preview_http.py"


def check(root, profile, *, excluded_files=None, optional_skips=None):
    """Run selected cases; retain domain exclusions and exact optional prerequisite reasons."""
    started = time.monotonic()
    root = Path(root)
    sys.path.insert(0, str(root))
    suite = unittest.TestSuite()
    omitted = []
    excluded_files = excluded_files or {}
    optional_skips = optional_skips or {}
    for path in sorted((root / "tests").rglob("test*.py")):
        relative = str(path.relative_to(root))
        if relative in excluded_files:
            omitted.append({'name': relative, 'status': 'skipped', 'reason': excluded_files[relative]})
            continue
        if integration_file(path) and profile != "integration":
            omitted.append({"name": str(path.relative_to(root)), "status": "skipped",
                            "reason": "Selected by Integration, not fixture-backed Quick"})
            continue
        suite.addTests(unittest.TestLoader().discover(str(path.parent), pattern=path.name,
                                                      top_level_dir=str(root / "tests")))
    if suite.countTestCases() == 0:
        return Check("python", "blocked", "No Python test cases discovered")
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2, resultclass=Results).run(suite)
    unexpected = [item for item in result.observations if item["status"] == "skipped" and
        optional_skips.get(item['name']) != item.get('reason') and not (
        profile != "integration" and
        item["name"].endswith("test_transport.ContractDriftTests.test_vendored_fixture_matches_importer") and
        item["reason"] == "sibling egi-importer checkout not present")]
    state = "failed" if not result.wasSuccessful() else "blocked" if unexpected else "passed"
    return Check("python", state, stream.getvalue()[-4000:] if state != "passed" else "",
                 round(time.monotonic()-started, 3), result.observations + omitted)
