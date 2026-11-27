"""Canonical commit-title policy and exact historical exceptions for all EGI repos."""
import json
from pathlib import Path
import re
import subprocess

TITLE = re.compile(r"EGI-[1-9][0-9]*: \S[^\r\n]*\Z")
SHA = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")


def git(root, *args):
    """Run an explicit Git argument vector and fail closed on invalid references."""
    return subprocess.run(["git", "-C", str(root), *args], text=True, capture_output=True,
                          check=True, timeout=30).stdout.strip()


def valid_message(root, message, *, merge=False):
    """Validate an ordinary title or an identified Git-generated merge/revert."""
    title = message.splitlines()[0] if message.splitlines() else ""
    if TITLE.fullmatch(title):
        return True
    if merge and title.startswith(("Merge branch ", "Merge remote-tracking branch ", "Merge pull request ")):
        return True
    target = re.search(r"^This reverts commit ([0-9a-f]{40}|[0-9a-f]{64})\.$", message, re.M)
    if re.fullmatch(r'Revert ".+"', title) and target:
        try:
            git(root, "cat-file", "-e", target[1] + "^{commit}")
            return True
        except subprocess.CalledProcessError:
            pass
    return False


def exceptions(root):
    """Load exact published SHAs; malformed exception policy blocks validation."""
    path = Path(root) / ".checks/commit-exceptions.json"
    if not path.exists():
        return set()
    body = json.loads(path.read_text())
    if body.get("schema_version") != 1 or not isinstance(body.get("commits"), dict):
        raise ValueError("Invalid commit exception policy")
    for sha, reason in body["commits"].items():
        if not SHA.fullmatch(sha) or not isinstance(reason, str) or not reason.strip():
            raise ValueError("Exceptions require exact SHAs and reasons")
    return set(body["commits"])


def validate_range(root, base, tip):
    """Validate the actual pushed/PR commit objects, including merge parent context."""
    base = git(root, "rev-parse", "--verify", "--end-of-options", base + "^{commit}")
    tip = git(root, "rev-parse", "--verify", "--end-of-options", tip + "^{commit}")
    legacy = exceptions(root)
    rejected = []
    for sha in git(root, "rev-list", base + ".." + tip).splitlines():
        if sha in legacy:
            continue
        parents = git(root, "show", "-s", "--format=%P", sha).split()
        if not valid_message(root, git(root, "show", "-s", "--format=%B", sha), merge=len(parents) >= 2):
            rejected.append(sha)
    return rejected
