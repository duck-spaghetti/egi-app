"""Discover app correctness suites; expose Quick/Complete/Integration without IA."""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from devchecks.python_tests import check as python_check
from devchecks.report import Check, exit_code, report
from devchecks.resources import ResourceRun, preflight, PrerequisiteError, CleanupError, run_check as run
from devchecks.integration import prepare


def checks(root, profile):
    """Discover executable suites, with later mandatory stages explicitly blocked."""
    # Keep Quick lightweight and unchanged; native Integration owns resource supervision.
    selection = {}
    if profile == 'integration':
        try:
            context = prepare(root)
            os.environ['EGI_DATABASE_REPO'] = str(context['native_schema'])
            selection = {key: context[key] for key in ('excluded_files', 'optional_skips')}
            yield Check('integration-selection', 'passed', json.dumps({
                'native_schema': str(context['native_schema']), 'excluded_files': context['excluded_files'],
                'optional_skips': context['optional_skips']}))
            capacity = preflight()
            yield Check('resource-preflight', 'passed',
                        ('WARNING below30 GiB: ' if capacity['warning'] else '') + str(capacity))
        except (OSError, ValueError, KeyError, ImportError, PrerequisiteError, subprocess.SubprocessError) as error:
            yield Check('resource-preflight', 'blocked', str(error))
            return
    try:
        scope = ResourceRun(root).activate() if profile == 'integration' else contextlib.nullcontext()
        with scope, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            yield python_check(root, profile, **selection)
        if profile == 'integration':
            yield Check('resource-teardown', 'passed', 'Owned native run reconciled; unrelated environments preserved')
    except CleanupError as error:
        yield Check('resource-teardown', 'failed', str(error))
    except (OSError, PrerequisiteError) as error:
        yield Check('resource-prerequisite', 'blocked', str(error))
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
    """Print and retain the observed report; fail or block when evidence is missing."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=("quick", "complete", "integration"), default="complete")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1],
                        help="Explicit repository/isolated fixture to check; never inferred from a DSN")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    # Hooks export Git routing variables; the explicit checked root owns all children.
    for name in tuple(os.environ):
        if name.startswith('GIT_'):
            del os.environ[name]
    result = report("app", args.profile, root, checks(root, args.profile))
    try:
        destination = root / '.local/checks'
        destination.mkdir(parents=True, exist_ok=True)
        (destination / (args.profile + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    except OSError as error:
        print('Unable to retain check report: ' + type(error).__name__, file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else
          "\n".join([f"{item['status']}: {item['name']}" + (f" — {item['reason']}" if item['reason'] else "")
                      for item in result["checks"]] + [f"app {args.profile}: {result['status']} ({result['seconds']}s)"]))
    return exit_code(result)


if __name__ == "__main__":
    raise SystemExit(main())
