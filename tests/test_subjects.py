"""Check the subject source cache and the routes through FastAPI in-process.

No database or running server is needed: the Postgres adapter receives a fake
query function and the routes receive a StaticSubjectSource.
"""

from __future__ import annotations

import json
import unittest

from fastapi.testclient import TestClient

from app.backend.main import app, subject_source
from app.backend.subjects import (
    RUN_PROBE,
    SUBJECTS,
    PostgresSubjectSource,
    StaticSubjectSource,
    SubjectSourceUnavailable,
)
from tests.test_service_presentation import subject


class FakeDatabase:
    """Answer the two known statements and count how often each is executed."""

    def __init__(self, run_id: str, rows: list[dict]):
        """Start with one run and its subject rows."""
        self.run_id, self.rows = run_id, rows
        self.calls = {"probe": 0, "full": 0}
        self.down = False

    def query(self, sql: str) -> str:
        """Return psql-like unaligned output or fail like an unavailable server."""
        if self.down:
            raise SubjectSourceUnavailable("down")
        if sql == RUN_PROBE:
            self.calls["probe"] += 1
            return self.run_id
        if sql == SUBJECTS:
            self.calls["full"] += 1
            return json.dumps({"run_id": self.run_id or None, "subjects": self.rows})
        raise AssertionError("unexpected SQL")


class PostgresSubjectSourceTests(unittest.TestCase):
    """The cache avoids repeated reads but follows a new normalization run."""

    def setUp(self):
        """Build a source with a controllable clock."""
        self.now = 0.0
        self.db = FakeDatabase("run-1", [{"id": "a"}])
        self.source = PostgresSubjectSource(
            ttl=60, query=self.db.query, clock=lambda: self.now
        )

    def test_reuses_snapshot_within_ttl(self):
        """Within the TTL no statement reaches the database."""
        self.assertEqual(self.source.latest(), [{"id": "a"}])
        self.now = 59
        self.source.latest()
        self.assertEqual(self.db.calls, {"probe": 0, "full": 1})

    def test_probe_after_ttl_skips_full_read_for_same_run(self):
        """An unchanged run costs only the cheap probe."""
        self.source.latest()
        self.now = 61
        self.source.latest()
        self.assertEqual(self.db.calls, {"probe": 1, "full": 1})

    def test_new_run_is_read_after_ttl(self):
        """A newer succeeded run replaces the snapshot."""
        self.source.latest()
        self.db.run_id, self.db.rows = "run-2", [{"id": "b"}]
        self.now = 61
        self.assertEqual(self.source.latest(), [{"id": "b"}])
        self.assertEqual(self.db.calls, {"probe": 1, "full": 2})

    def test_unavailable_database_raises_and_recovers(self):
        """A failed check is reported, and the next success serves data again."""
        with self.assertRaises(SubjectSourceUnavailable):
            self.db.down = True
            self.source.latest()
        self.db.down = False
        self.assertEqual(self.source.latest(), [{"id": "a"}])

    def test_empty_store_is_an_explicit_empty_snapshot(self):
        """Without a succeeded run there are no subjects, not an error."""
        self.db.run_id, self.db.rows = "", []
        self.assertEqual(self.source.latest(), [])


class FailingSource:
    """Simulate an unavailable subject store at the route seam."""

    def latest(self):
        """Always fail like an unreachable database."""
        raise SubjectSourceUnavailable("down")


class InProcessRouteTests(unittest.TestCase):
    """Exercise the real routes with fixture subjects instead of PostgreSQL."""

    def setUp(self):
        """Install a two-service fixture source for each test."""
        rows = [
            subject("svc-1", "Mensa", {"lunedi": "12:00-14:00"}),
            subject("svc-2", "Ascolto", {}),
        ]
        app.dependency_overrides[subject_source] = lambda: StaticSubjectSource(rows)
        self.client = TestClient(app)

    def tearDown(self):
        """Restore the production source."""
        app.dependency_overrides.clear()

    def test_services_health_and_preview_header(self):
        """Routes serve fixture subjects and keep the preview labelling."""
        self.assertEqual(self.client.get("/api/preview/services?area_id=1").json(), [], "fixture services have no coordinates and are hidden")
        response = self.client.get("/api/preview/services?area_id=1&include_unplaced=true")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["X-EGI-Data-Status"], "unreviewed-source-preview"
        )
        self.assertEqual({s["id"] for s in response.json()}, {"svc-1", "svc-2"})
        self.assertEqual(self.client.get("/health").json()["services"], 2)
        self.assertEqual(self.client.get("/api/preview/categories").status_code, 200)
        self.assertEqual(self.client.get("/api/preview/coverage").status_code, 200)
        self.assertEqual(self.client.get("/benchmark").status_code, 200)

    def test_unavailable_source_is_503_not_empty(self):
        """A missing database never looks like an empty map."""
        app.dependency_overrides[subject_source] = FailingSource
        self.assertEqual(self.client.get("/api/preview/services").status_code, 503)
        self.assertEqual(self.client.get("/health").status_code, 503)


if __name__ == "__main__":
    unittest.main()
