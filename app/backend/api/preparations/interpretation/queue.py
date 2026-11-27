"""Narrow worker-login SQL operations, each in its own short verified transaction.

No provider request runs while a connection or canonical transaction is held.
The database validates isolated login membership and lease/dispatch authority.
"""
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb


class JobQueue:
    """Own only a worker DSN and the six granted preparation job operations."""

    def __init__(self, dsn: str):
        """Keep a worker-only DSN without printing it or opening a connection."""
        self.dsn = dsn

    def _call(self, sql: str, params: tuple):
        """Commit one fixed operation and close the connection before returning."""
        with psycopg.connect(self.dsn, connect_timeout=3) as connection:
            connection.execute("SELECT set_config('statement_timeout','10000',true)")
            return connection.execute(sql, params).fetchone()[0]

    def claim(self, worker: UUID):
        """Lease one eligible job, recovering expired work without redispatching it."""
        return self._call('SELECT preparation.claim_job(%s)', (worker,))

    def start(self, claim: dict):
        """Recheck eligibility and atomically reserve the UTC-month cost ceiling."""
        return self._call('SELECT preparation.start_dispatch(%s,%s)', (claim['job_id'],claim['lease']))

    def heartbeat(self, claim: dict, dispatch):
        """Renew only this process's lease using a separate short connection."""
        return self._call('SELECT preparation.heartbeat_job(%s,%s,%s)', (claim['job_id'],claim['lease'],dispatch))

    def finish(self, claim: dict, dispatch, result: dict, usage: dict):
        """Settle known usage once, including a late or cancelled result."""
        return self._call('SELECT preparation.finish_job(%s,%s,%s,%s,%s)',
                          (claim['job_id'],dispatch,claim['lease'],Jsonb(result),Jsonb(usage)))

    def fail(self, claim: dict, code: str, dispatched: bool):
        """Record safe failure/uncertainty without releasing an ambiguous reservation."""
        return self._call('SELECT preparation.fail_job(%s,%s,%s,%s)', (claim['job_id'],claim['lease'],code,dispatched))
