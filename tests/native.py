"""A disposable, socket-only PostgreSQL cluster with the canonical schema deployed.

EGI_DATABASE_REPO selects the database worktree. With EGI_SQITCH the schema is
deployed by Sqitch; without it the plan's deploy scripts run with psql in plan
order (same SQL, without Sqitch's registry). Tests own and remove their cluster.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

REPOSITORY = os.environ.get("EGI_DATABASE_REPO")
PG = Path(os.environ.get("EGI_PG_BIN", "/Library/PostgreSQL/18/bin"))


class Cluster:
    """Start a cluster on `port`, create `database` and deploy the plan into it."""

    def __init__(self, port: int, database: str):
        """Initialize, start and deploy; call `close` to stop and remove everything."""
        self.port, self.database = port, database
        self.base = Path(tempfile.mkdtemp(prefix="egi-app-native-", dir="/private/tmp"))
        self.environment = {**os.environ, "PGHOST": str(self.base), "PGPORT": str(port), "PGDATABASE": database}
        subprocess.run([PG/"initdb", "-D", self.base/"data", "-A", "trust", "--no-locale", "--encoding=UTF8"],
                       check=True, stdout=subprocess.DEVNULL)
        with (self.base/"data/postgresql.conf").open("a") as stream:
            stream.write(f"\nlisten_addresses=''\nunix_socket_directories='{self.base}'\nport={port}\n")
        subprocess.run([PG/"pg_ctl", "-D", self.base/"data", "-l", self.base/"server.log", "-w", "start"],
                       check=True, stdout=subprocess.DEVNULL)
        subprocess.run([PG/"createdb", database], env=self.environment, check=True)
        self.sql(f"REVOKE TEMPORARY ON DATABASE {database} FROM PUBLIC")
        if os.environ.get("EGI_SQITCH"):
            subprocess.run([os.environ["EGI_SQITCH"], "deploy", "--db-client", PG/"psql", f"db:pg:{database}"],
                           cwd=REPOSITORY, env=self.environment, check=True, stdout=subprocess.DEVNULL)
        else:
            plan = (Path(REPOSITORY)/"sqitch.plan").read_text().splitlines()
            for change in [line.split()[0] for line in plan if line[:3].isdigit()]:
                self.file(Path(REPOSITORY)/"deploy"/f"{change}.sql")

    def dsn(self, user: str) -> str:
        """Return a libpq connection string for `user` on this cluster."""
        return f"host={self.base} port={self.port} dbname={self.database} user={user}"

    def sql(self, statement: str):
        """Run one statement as the cluster owner."""
        subprocess.run([PG/"psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement],
                       env=self.environment, check=True, stdout=subprocess.DEVNULL)

    def file(self, *paths):
        """Run SQL files as the cluster owner, in order."""
        command = [PG/"psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
        for path in paths:
            command += ["-f", path]
        subprocess.run(command, env=self.environment, check=True, stdout=subprocess.DEVNULL)

    def close(self):
        """Stop the cluster and remove its directory."""
        if (self.base/"data/postmaster.pid").exists():
            subprocess.run([PG/"pg_ctl", "-D", self.base/"data", "-m", "immediate", "-w", "stop"], stdout=subprocess.DEVNULL)
        shutil.rmtree(self.base)
