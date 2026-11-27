"""Inspect known local database environments without adopting or modifying resources."""
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import time
from .resources import process_identity, PrerequisiteError


class Inventory:
    """Collect bounded-root filesystem/process observations and explicit partial errors."""

    def __init__(self, workspace, temporary_root=Path('/private/tmp')):
        """Select explicit roots; every candidate stays observational and deduplicated."""
        self.workspace = Path(workspace).resolve(strict=True)
        self.temporary_root = Path(temporary_root).resolve(strict=True)
        self.entries, self.errors, self.seen = [], [], set()
        self.processes, self.processes_available = {}, True

    def error(self, path, operation, error):
        """Retain observation gaps without leaking file contents or process arguments."""
        self.errors.append({'path': str(path), 'operation': operation, 'error': type(error).__name__})

    def servers(self):
        """Extract PostgreSQL data paths without publishing credential-bearing command lines."""
        try:
            result = subprocess.run(['ps', '-axo', 'pid=,uid=,command='], text=True,
                                    capture_output=True, timeout=5, check=True)
            for line in result.stdout.splitlines():
                parts = line.strip().split(None, 2)
                if len(parts) != 3:
                    continue
                try:
                    args = shlex.split(parts[2])
                    if not args or Path(args[0]).name != 'postgres' or '-D' not in args:
                        continue
                    data = args[args.index('-D') + 1]
                    if not Path(data).is_absolute():
                        continue
                    self.processes[str(Path(data))] = {'pid': int(parts[0]), 'uid': int(parts[1])}
                except (ValueError, IndexError):
                    continue
        except (OSError, subprocess.SubprocessError) as error:
            self.processes_available = False
            self.error(self.workspace, 'process inventory', error)

    def size(self, path):
        """Measure allocated bytes without following links, reporting inaccessible subtrees."""
        visited = set()
        def allocated(current):
            """Accumulate actual filesystem allocation once per inode within this entry."""
            info = current.lstat()
            identity = (info.st_dev, info.st_ino)
            if identity in visited:
                return 0
            visited.add(identity)
            total = info.st_blocks * 512
            if stat.S_ISDIR(info.st_mode):
                with os.scandir(current) as children:
                    for child in children:
                        total += allocated(Path(child.path))
            return total
        try:
            return allocated(path)
        except OSError as error:
            self.error(path, 'allocated size', error)
            return None

    def read(self, path):
        """Read bounded metadata only; callers select the fields eligible for output."""
        try:
            if path.is_symlink() or path.stat().st_size > 65536:
                raise ValueError('Untrusted metadata path or size')
            return json.loads(path.read_text())
        except (OSError, ValueError) as error:
            self.error(path, 'metadata', error)
            return {}

    def add(self, path, category='unknown', run=None, record=None):
        """Observe one candidate, preserving ambiguity and leaving lifecycle unchanged."""
        path = Path(path)
        try:
            info = path.lstat()
        except OSError as error:
            self.error(path, 'candidate', error)
            return
        identity = (info.st_dev, info.st_ino)
        if identity in self.seen:
            return
        self.seen.add(identity)
        data = path / 'data'
        if path.is_symlink() or path.resolve() != path:
            self.error(path, 'symlink candidate', ValueError())
            self.entries.append({'path': str(path), 'category': 'unknown', 'state': 'unverifiable',
                                 'allocated_bytes': None, 'disposition': 'preserve'})
            return
        observed = self.processes.get(str(data)) or self.processes.get(str(path))
        state = 'running' if observed else 'stopped' if self.processes_available else 'unverifiable'
        disposition = 'preserve' if category in ('persistent', 'backup') else 'unknown'
        entry = {'path': str(path), 'category': category, 'state': state,
                 'allocated_bytes': self.size(path), 'disposition': disposition,
                 'timestamps': {'filesystem_mtime': info.st_mtime},
                 'timestamp_meaning': 'filesystem modification, not last use'}
        if observed:
            entry.update(pid=observed['pid'], uid=observed['uid'])
        if run:
            entry.update(run_id=run.get('run_id'), repository=run.get('repository'),
                         created_at=run.get('created_at'))
            try:
                owner = process_identity(run['owner_pid'])
                active = owner is not None and owner == run.get('owner_identity')
                entry['owner_state'] = 'active' if active else 'absent-or-changed'
                entry['disposition'] = 'active-run-preserve' if active else 'residue-for-review'
            except (OSError, ValueError, KeyError, PrerequisiteError) as error:
                self.error(path, 'run owner identity', error)
                entry.update(owner_state='unverifiable', disposition='unknown')
        if record:
            entry.update(lifecycle_phase=record.get('phase'), resource_created_at=record.get('created_at'))
        self.entries.append(entry)

    def children(self, path):
        """List only direct known-root candidates; inaccessible roots remain explicit."""
        try:
            if path.is_symlink() or path.resolve() != path:
                raise OSError('Refusing symlink/ancestor traversal')
            return sorted(path.iterdir())
        except OSError as error:
            self.error(path, 'directory listing', error)
            return []

    def local(self, root):
        """Inspect declared persistent database roots and backup sets without reading data tables."""
        for path in self.children(root):
            if path.name == 'backups' and not path.is_symlink():
                for backup in self.children(path):
                    self.add(backup, 'backup')
            elif path.name.endswith('-db'):
                self.add(path, 'persistent')
            elif path.is_dir() and not path.is_symlink() and (path / 'runtime.json').exists():
                record = self.read(path / 'runtime.json')
                if record.get('data'):
                    self.add(path, 'persistent')

    def collect(self):
        """Return a fresh versioned read-only report over known workspace/temporary roots."""
        self.servers()
        local = self.workspace / '.local'
        if local.exists():
            self.local(local)
        worktrees = self.workspace / '.scratch/worktrees'
        if worktrees.exists():
            for worktree in self.children(worktrees):
                if worktree.is_dir() and not worktree.is_symlink() and (worktree / '.local').exists():
                    self.local(worktree / '.local')
        for path in self.children(self.temporary_root):
            if path.name.startswith('egi-resource-'):
                if path.is_symlink():
                    self.add(path)
                    continue
                run = self.read(path / 'run.json')
                for child in self.children(path):
                    if child.name.startswith('pg-'):
                        record = self.read(child / 'resource.json')
                        self.add(child, 'owned-test' if run and record else 'unknown', run, record)
                # An interrupted allocation can leave only the run receipt.
                if not any(x['path'].startswith(str(path) + '/') for x in self.entries):
                    self.add(path, 'owned-test' if run else 'unknown', run)
            elif path.name.startswith(('egi-app-native-', 'egi-app-read-', 'egi-contract.', 'egi-devcheck-')):
                self.add(path, 'unknown')
        for data in self.processes:
            if not any(data == x['path'] or data == str(Path(x['path']) / 'data') for x in self.entries):
                self.add(Path(data), 'unknown')
        return {'schema_version': 1, 'workspace': str(self.workspace), 'observed_at': time.time(),
                'status': 'partial' if self.errors else 'observed', 'entries': self.entries,
                'errors': self.errors, 'read_only': True}
