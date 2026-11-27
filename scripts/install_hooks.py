"""Activate owning hooks in this assigned worktree while preserving other worktrees."""
from pathlib import Path
import subprocess


def install(root):
    """Enable worktree-specific config and refuse replacing an unrelated hook path."""
    root = Path(root).resolve()
    hooks = root / ".githooks"
    old = subprocess.run(["git", "-C", str(root), "config", "--get", "core.hooksPath"],
                         text=True, capture_output=True).stdout.strip()
    resolved = (root / old).resolve() if old and not Path(old).is_absolute() else Path(old).resolve() if old else None
    if old and resolved != hooks:
        raise ValueError("Existing hook path requires explicit reconciliation")
    for name in ("commit-msg", "pre-push"):
        path = hooks / name
        if not path.is_file():
            raise ValueError("Missing owning hook: " + name)
        path.chmod(path.stat().st_mode | 0o111)
    subprocess.run(["git", "-C", str(root), "config", "extensions.worktreeConfig", "true"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "--worktree", "core.hooksPath", str(hooks)], check=True)


if __name__ == "__main__":
    install(Path(__file__).resolve().parents[1])
