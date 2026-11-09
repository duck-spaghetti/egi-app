"""Supply the latest succeeded source interpretations to the preview routes.

Sources: the preserved Helpinet extract and every map export (My Maps) with its
latest geocoding run.

SubjectSource is the single seam for imported service subjects. PostgresSubjectSource
reads the restricted preview database through psql and caches one snapshot per
normalization run; StaticSubjectSource serves fixed rows for in-process tests.
Neither creates canonical entities or publication decisions.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

PSQL = os.environ.get("EGI_PSQL", "/Library/PostgreSQL/18/bin/psql")
PROJECT = Path(__file__).resolve().parents[3]

# One latest succeeded normalization run per displayed source: the preserved
# Helpinet extract, every map export (Google My Maps) and every open-data CSV source. A map run's position
# candidates come from its latest succeeded geocode child run, matched by locator.
LATEST_RUN = """WITH latest AS (
 SELECT DISTINCT ON (r.code) r.code,r.name,r.homepage,r.attribution,d.resource_url,p.run_id,
  c.retrieved_at,c.retrieval_status,c.source_metadata_snapshot
 FROM sources.processing_runs p JOIN sources.captures c USING(capture_id)
 JOIN sources.datasets d USING(dataset_id) JOIN sources.registry r USING(source_id)
 WHERE p.run_kind='normalize' AND p.status='succeeded'
 AND ((r.code='helpinet' AND d.external_key='helpinet-preserved-api-extract') OR r.source_kind IN ('map_export','open_data'))
 ORDER BY r.code,p.started_at DESC,p.finished_at DESC,p.run_id
), geo AS (
 SELECT DISTINCT ON (g.parent_run_id) g.parent_run_id,g.run_id
 FROM sources.processing_runs g JOIN latest l ON g.parent_run_id=l.run_id
 WHERE g.run_kind='geocode' AND g.status='succeeded'
 ORDER BY g.parent_run_id,g.started_at DESC,g.finished_at DESC,g.run_id
), snapshot AS (
 SELECT COALESCE(string_agg(l.run_id::text||COALESCE('+'||g.run_id::text,''),',' ORDER BY l.code),'') AS id
 FROM latest l LEFT JOIN geo g ON g.parent_run_id=l.run_id
)"""
RUN_PROBE = f"{LATEST_RUN}\nSELECT id FROM snapshot;"
SUBJECTS = f"""BEGIN READ ONLY;
{LATEST_RUN}
SELECT json_build_object('run_id',NULLIF((SELECT id FROM snapshot),''),'subjects',
 COALESCE(json_agg(json_build_object('id',s.subject_id,'payload',s.normalized_payload,
 'run_id',s.run_id,'source_locator',s.subject_locator,'observed_at',l.retrieved_at,
 'retrieval_status',l.retrieval_status,'metadata',l.source_metadata_snapshot,
 'source_code',l.code,'source_name',l.name,'source_homepage',l.homepage,
 'source_attribution',l.attribution,'dataset_url',l.resource_url,'geocode',gs.normalized_payload)
 ORDER BY l.code,s.subject_locator),'[]'::json))
FROM sources.normalized_subjects s JOIN latest l USING(run_id)
LEFT JOIN geo g ON g.parent_run_id=l.run_id
LEFT JOIN sources.normalized_subjects gs ON gs.run_id=g.run_id
 AND gs.subject_kind='location_candidate'
 AND gs.subject_locator=regexp_replace(s.subject_locator,':service$',':geocode')
WHERE s.subject_kind='service';
COMMIT;"""


class SubjectSourceUnavailable(RuntimeError):
    """Raised when the subject store cannot be read; routes map it to HTTP 503."""


class SubjectSource(Protocol):
    """Provide the service subjects of the latest succeeded normalization run."""

    def latest(self) -> list[dict[str, Any]]:
        """Return subject rows ordered by source locator, or raise SubjectSourceUnavailable."""
        ...


class StaticSubjectSource:
    """Serve a fixed list of subject rows, for tests and offline inspection."""

    def __init__(self, rows: list[dict[str, Any]]):
        """Keep the given rows as the only snapshot."""
        self.rows = rows

    def latest(self) -> list[dict[str, Any]]:
        """Return the fixed rows unchanged."""
        return self.rows


def connection_string() -> str:
    """Use the restricted preview reader, with runtime state outside repository history."""
    if os.environ.get("EGI_PREVIEW_DSN"):
        return os.environ["EGI_PREVIEW_DSN"]
    config = json.loads((PROJECT / ".local/preview-db/runtime.json").read_text())
    return f"host={config['socket']} port={config['port']} dbname={config['database']} user=egi_preview_reader"


def run_psql(sql: str) -> str:
    """Run one read-only statement batch through psql and return its unaligned output."""
    try:
        result = subprocess.run(
            [PSQL, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "--dbname", connection_string()],
            input=sql,
            text=True,
            capture_output=True,
            env={**os.environ, "PGCONNECT_TIMEOUT": "3"},
            timeout=10,
        )
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        raise SubjectSourceUnavailable("Preview database unavailable") from exc
    if result.returncode:
        raise SubjectSourceUnavailable("Preview database unavailable")
    return result.stdout.strip()


class PostgresSubjectSource:
    """Read subjects from PostgreSQL, reusing one snapshot while its run is current.

    Within ttl seconds of the last successful check the cached snapshot is returned
    without contacting the database. After that a cheap run_id probe decides whether
    the full read is needed. Database availability is therefore observed at most
    every ttl seconds; a failed check raises and keeps the previous snapshot for
    the next successful probe.
    """

    def __init__(
        self,
        ttl: float = 60.0,
        query: Callable[[str], str] = run_psql,
        clock: Callable[[], float] = time.monotonic,
    ):
        """Configure the freshness window; query and clock are injectable for tests."""
        self.ttl = ttl
        self.query = query
        self.clock = clock
        self.lock = threading.Lock()
        self.run_id: str | None = None
        self.rows: list[dict[str, Any]] | None = None
        self.checked_at = float("-inf")

    def latest(self) -> list[dict[str, Any]]:
        """Return the cached snapshot, refreshing it when the latest run changed."""
        with self.lock:
            now = self.clock()
            if self.rows is not None and now - self.checked_at < self.ttl:
                return self.rows
            if self.rows is None or self.query(RUN_PROBE) != self.run_id:
                try:
                    # The aggregate always yields one row; run_id is null without a run.
                    snapshot = json.loads(self.query(SUBJECTS))
                except json.JSONDecodeError as exc:
                    raise SubjectSourceUnavailable("Unreadable preview snapshot") from exc
                self.run_id = snapshot["run_id"] or ""
                self.rows = snapshot["subjects"]
            self.checked_at = now
            return self.rows
