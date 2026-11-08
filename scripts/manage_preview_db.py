"""Resume or stop the explicitly recorded local preview PostgreSQL cluster.

Initial structure is deployed separately with bootstrap_preview_db.py and Sqitch.
This script never selects another cluster or creates an unregistered database.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
PG = Path("/Library/PostgreSQL/18/bin")


def main() -> None:
    """Start/stop only the exact cluster recorded for this workspace."""
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["start", "stop", "status"])
    args = parser.parse_args()
    runtime = PROJECT / ".local/preview-db"
    c = json.loads((runtime / "runtime.json").read_text())
    if Path(c["data"]) != runtime / "data":
        raise RuntimeError("Unexpected cluster identity; refusing operation")
    status = subprocess.run(
        [str(PG / "pg_ctl"), "-D", c["data"], "status"], capture_output=True, text=True
    )
    if args.operation == "status":
        print(status.stdout or status.stderr)
        raise SystemExit(status.returncode)
    if args.operation == "start" and status.returncode:
        Path(c["socket"]).mkdir(mode=0o700, exist_ok=True)
        subprocess.run(
            [
                str(PG / "pg_ctl"),
                "-D",
                c["data"],
                "-l",
                str(runtime / "server.log"),
                "-w",
                "start",
            ],
            check=True,
        )
    if args.operation == "stop" and status.returncode == 0:
        subprocess.run(
            [str(PG / "pg_ctl"), "-D", c["data"], "-m", "fast", "-w", "stop"],
            check=True,
        )
    print("Preview database:", args.operation)


if __name__ == "__main__":
    main()
