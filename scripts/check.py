"""Discover app correctness suites; expose Quick/Complete/Integration without IA."""
import argparse
import contextlib
import io
import json
from pathlib import Path
import shutil
import sys

from devchecks.python_tests import check as python_check
from devchecks.report import Check, exit_code, report, run


def checks(root, profile):
    """Discover executable suites, with later mandatory stages explicitly blocked."""
    # Test output must not corrupt the machine-readable report on stdout.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        yield python_check(root, profile)
    node = shutil.which("node")
    if not node:
        yield Check("javascript", "blocked", "Node runtime unavailable")
    else:
        paths = sorted((root / "tests").rglob("test*.cjs"))
        if not paths:
            yield Check("javascript", "blocked", "No Node suites discovered")
        for path in paths:
            yield run(str(path.relative_to(root)), [node, "--experimental-vm-modules", path], root)
        sources = sorted((root / "app/frontend/static/js").rglob("*.js")) + paths
        for path in sources:
            yield run("syntax:" + str(path.relative_to(root)), [node, "--check", path], root)
        eslint = root / "node_modules/.bin/eslint"
        if not eslint.exists():
            yield Check("eslint", "blocked", "Approved dev dependency missing; run npm ci")
        else:
            yield run("eslint", [eslint, "app/frontend/static/js", "tests", "--max-warnings=0"], root)
    stages = ["browser", "offline", "pdf"] if profile == "complete" else ["integration"] if profile == "integration" else []
    for stage in stages:
        script = root / "checks" / (stage + ".py")
        if not script.is_file():
            yield Check(stage, "blocked", "Required stage not implemented yet: " + stage)
        else:
            yield run(stage, [sys.executable, script], root)


def main(argv=None):
    """Print a report and return a failing/blocked exit when evidence is missing."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=("quick", "complete", "integration"), default="complete")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1],
                        help="Explicit repository/isolated fixture to check; never inferred from a DSN")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    result = report("app", args.profile, root, checks(root, args.profile))
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else
          "\n".join([f"{item['status']}: {item['name']}" + (f" — {item['reason']}" if item['reason'] else "")
                      for item in result["checks"]] + [f"app {args.profile}: {result['status']} ({result['seconds']}s)"]))
    return exit_code(result)


if __name__ == "__main__":
    raise SystemExit(main())
