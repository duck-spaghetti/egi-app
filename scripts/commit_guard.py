"""One commit-msg/pre-push/CI interface; owning checks run without shell or IA."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

from devchecks.commit_titles import SHA, git, valid_message, validate_range


def check_profile(root, profile):
    """Require both a zero process exit and a valid passed profile report."""
    result = subprocess.run([sys.executable, str(root / "scripts/check.py"), "--json", "--profile", profile],
                            cwd=root, text=True, capture_output=True, timeout=1800)
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ValueError("Owning check did not return JSON") from None
    if (result.returncode or report.get("schema_version") != 1 or report.get("status") != "passed"
            or report.get("profile") != profile or report.get("source") != git(root, "rev-parse", "HEAD")):
        raise ValueError("Required " + profile + " checks not passed")


def integration_needed(root, base, tip):
    """Detect changed shared developer/product boundaries conservatively."""
    names = git(root, "diff", "--name-only", base, tip).splitlines()
    return any(name.startswith(("app/backend/api/", "scripts/devchecks/", "scripts/check.py",
                                "scripts/commit_guard.py", "requirements", "pyproject.toml", "review/",
                                "deploy/", "revert/", "verify/", "sqitch.plan", ".checks/", ".github/")) for name in names)


def push(root, stream):
    """Validate supplied push updates and run the owning delivery profiles once."""
    integration = False
    changed = False
    for line in stream:
        fields = line.split()
        if len(fields) != 4 or not SHA.fullmatch(fields[1]) or not SHA.fullmatch(fields[3]):
            raise ValueError("Malformed Git push update")
        _, tip, _, base = fields
        if not tip.strip("0"):
            continue
        if not base.strip("0"):
            base = git(root, "rev-parse", "--verify", "origin/dev^{commit}")
        if git(root, "rev-parse", tip + "^{commit}") != git(root, "rev-parse", "HEAD"):
            raise ValueError("Check the worktree for the actual pushed source")
        if git(root, "status", "--porcelain"):
            raise ValueError("Delivery requires a clean checked worktree")
        invalid = validate_range(root, base, tip)
        if invalid:
            raise ValueError("Invalid new commit title: " + ",".join(invalid))
        changed = True
        integration |= integration_needed(root, base, tip)
    if changed:
        check_profile(root, "complete")
        if integration:
            check_profile(root, "integration")


def main(argv=None):
    """Expose the same validator for local hooks, explicit range checks and CI."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    actions = parser.add_subparsers(dest="action", required=True)
    message = actions.add_parser("commit-msg")
    message.add_argument("file", type=Path)
    actions.add_parser("pre-push")
    span = actions.add_parser("range")
    span.add_argument("base")
    span.add_argument("tip")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    try:
        if args.action == "commit-msg":
            merge_head = Path(git(root, "rev-parse", "--git-path", "MERGE_HEAD"))
            if not merge_head.is_absolute():
                merge_head = root / merge_head
            if not valid_message(root, args.file.read_text(), merge=merge_head.is_file()):
                raise ValueError("Expected EGI-<positive number>: <summary>")
        elif args.action == "range":
            invalid = validate_range(root, args.base, args.tip)
            if invalid:
                raise ValueError("Invalid new commit title: " + ",".join(invalid))
        else:
            push(root, sys.stdin)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print("Commit/check validation refused: " + (str(error) if isinstance(error, ValueError) else type(error).__name__), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
