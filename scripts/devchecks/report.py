"""Run bounded subprocess checks and report truthful prerequisite/failure outcomes."""
from dataclasses import asdict, dataclass
from pathlib import Path
import subprocess
import time


@dataclass
class Check:
    """One observed check, with bounded diagnostics and optional test outcomes."""

    name: str
    status: str
    reason: str = ""
    seconds: float = 0
    tests: list | None = None


def run(name, command, root, *, timeout=300, environment=None):
    """Execute an argument vector without a shell; missing tools are blocked."""
    started = time.monotonic()
    try:
        result = subprocess.run([str(x) for x in command], cwd=root, env=environment,
                                text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        return Check(name, "blocked", type(error).__name__, round(time.monotonic()-started, 3))
    return Check(name, "passed" if result.returncode == 0 else "failed",
                 (result.stdout + result.stderr)[-4000:] if result.returncode else "",
                 round(time.monotonic()-started, 3))


def report(repository, profile, root, checks):
    """Aggregate checks without converting missing required evidence to success."""
    checks = list(checks)
    states = {item.status for item in checks}
    status = "failed" if "failed" in states else "blocked" if "blocked" in states else "passed"
    revision = run("source", ["git", "rev-parse", "HEAD"], root)
    source = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, text=True,
                            capture_output=True, check=False).stdout.strip() if revision.status == "passed" else None
    return {"schema_version": 1, "repository": repository, "profile": profile,
            "source": source, "status": status,
            "counts": {key: sum(item.status == key for item in checks)
                       for key in ("passed", "failed", "blocked", "skipped")},
            "seconds": round(sum(item.seconds for item in checks), 3),
            "checks": [asdict(item) for item in checks]}


def exit_code(result):
    """Map observed aggregate state to the common CLI exit contract."""
    return {"passed": 0, "failed": 1, "blocked": 2}[result["status"]]
