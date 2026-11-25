"""The editorial login's database access: one connection and transaction per call.

Before a signed-in action, `acting` asks the database to verify the session; inside
that transaction every write and read is attributed to the verified person
(ADR 0011). Database refusals become `Refused` with the database's message code.
"""
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


class Refused(Exception):
    """A database refusal the pages can explain, e.g. `session_invalid` or `last_admin`."""

    def __init__(self, code: str):
        """Keep only the database's message code, never the statement or its values."""
        super().__init__(code)
        self.code = code


class Desk:
    """Open editorial transactions against one configured database."""

    def __init__(self, dsn: str):
        """Keep the editorial login's connection string; connect only per call."""
        self.dsn = dsn

    @contextmanager
    def transaction(self):
        """Yield a connection whose transaction commits on success and rolls back on error."""
        try:
            with psycopg.connect(self.dsn, connect_timeout=3, row_factory=dict_row) as connection:
                connection.execute("SELECT set_config('statement_timeout','10000',true)")
                yield connection
        except psycopg.errors.RaiseException as error:
            raise Refused(error.diag.message_primary or 'refused') from None
        except (psycopg.errors.InsufficientPrivilege, psycopg.errors.InvalidParameterValue,
                psycopg.errors.CheckViolation, psycopg.errors.ObjectNotInPrerequisiteState,
                psycopg.errors.SerializationFailure, psycopg.errors.UniqueViolation) as error:
            raise Refused(error.diag.message_primary if error.sqlstate != '23505' else 'already_in_use') from None

    @contextmanager
    def acting(self, session_hash: str):
        """Yield `(connection, person)` after the database verified the session."""
        with self.transaction() as connection:
            person = connection.execute('SELECT access.verify_session(%s) AS person', (session_hash,)).fetchone()['person']
            yield connection, person

    def one(self, sql: str, params: tuple = ()) -> dict | None:
        """Run one statement outside a session and return its first row."""
        with self.transaction() as connection:
            return connection.execute(sql, params).fetchone()

    def as_person(self, session_hash: str, sql: str, params: tuple = ()) -> list[dict]:
        """Run one statement as the verified person and return all rows."""
        with self.acting(session_hash) as (connection, _):
            return connection.execute(sql, params).fetchall()

    def person(self, session_hash: str | None) -> dict | None:
        """Return the verified person of a session, or None when it is not valid."""
        if not session_hash:
            return None
        try:
            with self.acting(session_hash) as (_, person):
                return person
        except Refused as refusal:
            if refusal.code in ('session_invalid', 'session_already_bound'):
                return None
            raise
