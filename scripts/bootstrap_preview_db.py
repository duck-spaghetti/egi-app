"""Create/start an isolated local preview cluster and deploy the existing Sqitch plan.

The preview uses a private Unix socket and never connects to another PostgreSQL
cluster. Its retained runtime configuration is separate from all repository histories.
"""

from __future__ import annotations

import getpass
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
RUNTIME = PROJECT / ".local/preview-db"
PG = Path("/Library/PostgreSQL/18/bin")
SQITCH = os.environ.get("EGI_SQITCH") or shutil.which("sqitch")


def command(args: list[str], **kwargs: object) -> str:
    """Run a required local setup operation and surface failures immediately."""
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout


def main() -> None:
    """Create only a fresh preview target or resume its previously recorded identity."""
    if not SQITCH:
        raise RuntimeError(
            "Set EGI_SQITCH and, if needed, PERL5LIB to the installed Sqitch runtime"
        )
    RUNTIME.mkdir(parents=True, exist_ok=True)
    config_file = RUNTIME / "runtime.json"
    if config_file.exists():
        config = json.loads(config_file.read_text())
        assert config["data"] == str(RUNTIME / "data"), "unexpected cluster identity"
    else:
        assert not (
            RUNTIME / "data"
        ).exists(), "unregistered data directory; refusing reuse"
        config = {
            "data": str(RUNTIME / "data"),
            "socket": tempfile.mkdtemp(prefix="egi-preview-", dir="/private/tmp"),
            "port": 65439,
            "database": "egi_preview",
            "admin": getpass.getuser(),
        }
        command(
            [
                str(PG / "initdb"),
                "-D",
                config["data"],
                "-A",
                "trust",
                "--no-locale",
                "--encoding=UTF8",
            ]
        )
        with (Path(config["data"]) / "postgresql.conf").open("a") as f:
            f.write(
                f"\nlisten_addresses = ''\nunix_socket_directories = '{config['socket']}'\nport = {config['port']}\n"
            )
        config_file.write_text(json.dumps(config, indent=2) + "\n")
    Path(config["socket"]).mkdir(mode=0o700, exist_ok=True)
    status = subprocess.run(
        [str(PG / "pg_ctl"), "-D", config["data"], "status"], capture_output=True
    )
    if status.returncode:
        command(
            [
                str(PG / "pg_ctl"),
                "-D",
                config["data"],
                "-l",
                str(RUNTIME / "server.log"),
                "-w",
                "start",
            ]
        )
    env = {
        **os.environ,
        "PGHOST": config["socket"],
        "PGPORT": str(config["port"]),
        "PGUSER": config["admin"],
        "PGDATABASE": "postgres",
    }
    exists = command(
        [
            str(PG / "psql"),
            "-XAtc",
            "SELECT 1 FROM pg_database WHERE datname='egi_preview'",
        ],
        env=env,
    )
    if not exists.strip():
        command([str(PG / "createdb"), config["database"]], env=env)
    env["PGDATABASE"] = config["database"]
    print(
        command(
            [
                str(SQITCH),
                "deploy",
                "--db-client",
                str(PG / "psql"),
                "db:pg:egi_preview",
            ],
            env=env,
            cwd=PROJECT / "egi_database",
        )
    )
    print(
        command(
            [
                str(SQITCH),
                "verify",
                "--db-client",
                str(PG / "psql"),
                "db:pg:egi_preview",
            ],
            env=env,
            cwd=PROJECT / "egi_database",
        )
    )
    sql = """DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='egi_preview_reader') THEN CREATE ROLE egi_preview_reader LOGIN; END IF; END $$;
GRANT CONNECT ON DATABASE egi_preview TO egi_preview_reader;
GRANT USAGE ON SCHEMA sources TO egi_preview_reader;
GRANT SELECT ON sources.normalized_subjects,sources.processing_runs,sources.captures,sources.datasets,sources.registry TO egi_preview_reader;
ALTER ROLE egi_preview_reader SET default_transaction_read_only=on;
SELECT json_build_object('database',current_database(),'data_directory',current_setting('data_directory'),'tcp_address',inet_server_addr(),'version',version());"""
    print(
        command([str(PG / "psql"), "-X", "-v", "ON_ERROR_STOP=1", "-Atc", sql], env=env)
    )
    print("Isolated preview database ready; state:", config_file)


if __name__ == "__main__":
    main()
