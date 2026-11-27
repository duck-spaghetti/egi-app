"""Submit one contribution through the intake login; the database applies the limits."""
import json

import psycopg


class Intake:
    """Own the intake login's connection string; connect only per submission."""

    def __init__(self, dsn: str):
        """Keep the connection string of a login created `IN ROLE egi_intake`."""
        self.dsn = dsn

    def submit(self, kind: str, service: str | None, category: str | None, message: str | None,
               contact: str | None, consent: bool, proposals: list[dict], trap: str | None) -> str:
        """Return `stored`, `trapped`, `limited`, `closed` or the database's refusal code.

        No request metadata (address, headers) reaches the database: only the form fields.
        """
        try:
            with psycopg.connect(self.dsn, connect_timeout=3) as connection:
                return connection.execute('SELECT editorial.submit_contribution(%s,%s,%s,%s,%s,%s,%s,%s)',
                    (kind, service, category, message or None, contact or None, consent,
                     json.dumps(proposals), trap or None)).fetchone()[0]
        except (psycopg.errors.InvalidParameterValue, psycopg.errors.CheckViolation) as error:
            return error.diag.message_primary or 'invalid'
