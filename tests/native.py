"""A disposable, socket-only PostgreSQL cluster with the canonical schema deployed.

EGI_DATABASE_REPO selects the database worktree. With EGI_SQITCH the schema is
deployed by Sqitch; without it the plan's deploy scripts run with psql in plan
order (same SQL, without Sqitch's registry). EGI_RESOURCE_TOOLS_REPO selects the
reviewed resource checkout. The owning run supervises only its own clusters.
"""
import os
from pathlib import Path
import subprocess

import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from devchecks.resources import OwnedCluster, CleanupError, preserve_failure

REPOSITORY = os.environ.get("EGI_DATABASE_REPO")
PG = Path(os.environ.get("EGI_PG_BIN", "/Library/PostgreSQL/18/bin"))


class Cluster:
    """Start a cluster on `port`, create `database` and deploy the plan into it."""

    def __init__(self, port: int, database: str):
        """Initialize, start and deploy; call `close` to stop and remove everything."""
        if not REPOSITORY:
            raise RuntimeError('EGI_DATABASE_REPO must select the disposable schema source')
        self.port, self.database = port, database
        self.resource = OwnedCluster(Path(__file__).resolve().parents[1], PG, port, database)
        self.base, self.environment = self.resource.path, self.resource.environment
        try:
            self.sql(f"REVOKE TEMPORARY ON DATABASE {database} FROM PUBLIC")
            through = os.environ.get('EGI_DATABASE_THROUGH')
            if os.environ.get("EGI_SQITCH"):
                command = [os.environ['EGI_SQITCH'], 'deploy', '--db-client', PG/'psql']
                if through:
                    command += ['--to', through]
                subprocess.run([*command, f'db:pg:{database}'],
                               cwd=REPOSITORY, env=self.environment, check=True, stdout=subprocess.DEVNULL, timeout=180)
            else:
                plan = (Path(REPOSITORY)/"sqitch.plan").read_text().splitlines()
                changes = [line.split()[0] for line in plan if line[:3].isdigit()]
                if through:
                    changes = changes[:changes.index(through) + 1]
                for change in changes:
                    self.file(Path(REPOSITORY)/"deploy"/f"{change}.sql")
        except BaseException as primary:
            receipt = preserve_failure(self.resource.run, self.resource.path, primary)
            primary.add_note('Evidence: ' + receipt)
            try:
                self.resource.close()
            except BaseException as cleanup:
                raise CleanupError(f'Primary {type(primary).__name__}; cleanup: {cleanup}') from primary
            raise

    def dsn(self, user: str) -> str:
        """Return a libpq connection string for `user` on this cluster."""
        return f"host={self.base} port={self.port} dbname={self.database} user={user}"

    def sql(self, statement: str):
        """Run one statement as the cluster owner."""
        subprocess.run([PG/"psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement],
                       env=self.environment, check=True, stdout=subprocess.DEVNULL, timeout=30)

    def file(self, *paths):
        """Run SQL files as the cluster owner, in order."""
        command = [PG/"psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
        for path in paths:
            command += ["-f", path]
        subprocess.run(command, env=self.environment, check=True, stdout=subprocess.DEVNULL, timeout=60)

    def close(self):
        """Stop the cluster and remove its directory."""
        if hasattr(self, 'resource'):
            self.resource.close()


def people(cluster: Cluster, desk_login: str) -> dict:
    """Create an admin and two moderators with open sessions; return cookie tokens and actors.

    The owner bootstraps the admin; everything else runs as the editorial login, as the
    app would. Session tokens are returned in clear for test cookies only.
    """
    import getpass
    import hashlib
    import psycopg

    def digest(token):
        """Hash a token as the app does."""
        return hashlib.sha256(token.encode()).hexdigest()
    with psycopg.connect(cluster.dsn(getpass.getuser()), autocommit=True) as owner:
        admin = owner.execute("SELECT access.bootstrap_admin('admin1','Admin One',%s)", (digest('inv-admin'),)).fetchone()[0]
    found = {}
    with psycopg.connect(cluster.dsn(desk_login), autocommit=True) as desk:
        desk.execute("SELECT access.accept_invitation(%s,'password','$argon2id$x',NULL,NULL,'JBSWY3DPEHPK3PXP')", (digest('inv-admin'),))
        desk.execute("SELECT access.open_session(%s,%s,'password',true)", (admin, digest('admin')))
        for login, name in (('mod1', 'Mod One'), ('mod2', 'Mod Two')):
            with desk.transaction():
                desk.execute('SELECT access.verify_session(%s)', (digest('admin'),))
                account = desk.execute("SELECT access.create_account(%s,%s,'moderator',%s)", (login, name, digest('inv-' + login))).fetchone()[0]
            desk.execute("SELECT access.accept_invitation(%s,'oidc',NULL,'https://accounts.google.com',%s,NULL)", (digest('inv-' + login), 'sub-' + login))
            desk.execute("SELECT access.open_session(%s,%s,'oidc',false)", (account, digest(login)))
        for login in ('admin', 'mod1', 'mod2'):
            with desk.transaction():
                found[login] = desk.execute('SELECT access.verify_session(%s)', (digest(login),)).fetchone()[0]['actor_id']
    return {login: {'token': login, 'actor': actor} for login, actor in found.items()}
