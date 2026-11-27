"""Create the first admin once, with the database owner's connection, and print the invitation.

    EGI_OWNER_DATABASE_URL='host=… dbname=… user=OWNER' \\
    .venv/bin/python -m app.backend.api.moderation.bootstrap LOGIN "Display name" \\
        --origin http://127.0.0.1:8000

The owner's connection is used for this call only; the app never holds it. The link
is valid 48 hours and once; the database refuses a second admin bootstrap.
"""
import argparse
import os
import sys

import psycopg

from . import auth


def main(argv=None) -> int:
    """Bootstrap the first admin and print the one-time invitation link."""
    parser = argparse.ArgumentParser(description='Create the first EGI moderation admin.')
    parser.add_argument('login')
    parser.add_argument('display_name')
    parser.add_argument('--origin', required=True, help='public origin of the app, e.g. https://staging.egi.cat')
    arguments = parser.parse_args(argv)
    dsn = os.environ.get('EGI_OWNER_DATABASE_URL')
    if not dsn:
        print('EGI_OWNER_DATABASE_URL is required', file=sys.stderr)
        return 2
    token, digest = auth.new_token()
    try:
        with psycopg.connect(dsn, connect_timeout=5) as connection:
            connection.execute('SELECT access.bootstrap_admin(%s,%s,%s)', (arguments.login.strip().lower(),
                                                                         arguments.display_name.strip(), digest))
    except psycopg.Error as error:
        print(f'refused: {error.diag.message_primary or "database error"}', file=sys.stderr)
        return 1
    print(f'{arguments.origin.rstrip("/")}/moderazione/invito/{token}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
