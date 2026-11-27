"""Own disposable PostgreSQL resources, reconcile exact runs, and measure disk capacity.

Only a live caller holding a run capability may reconcile its resources. Historical
records are inventory evidence, never authority to stop an arbitrary PostgreSQL.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import tempfile
import time
import uuid

GIB = 1024 ** 3
DEFAULT_ROOT = Path('/private/tmp')


class PrerequisiteError(RuntimeError):
    """A required identity, disk or runtime observation is unavailable."""


class CleanupError(RuntimeError):
    """An owned resource could not be safely stopped or removed."""


def process_identity(pid):
    """Read a process creation time, UID and invocation for internal comparisons."""
    result = subprocess.run(['ps', '-p', str(int(pid)), '-o', 'uid=', '-o', 'lstart=', '-o', 'command='],
                            text=True, capture_output=True, timeout=5)
    if result.returncode == 1 and not result.stdout.strip():
        return None
    if result.returncode or not result.stdout.strip():
        raise PrerequisiteError('Process identity unavailable')
    return result.stdout.strip()


def preflight(root=DEFAULT_ROOT, available=None):
    """Observe approved 30/15 GiB boundaries on the actual allocation filesystem."""
    root = Path(root).resolve(strict=True)
    try:
        free = shutil.disk_usage(root).free if available is None else available
    except OSError as error:
        raise PrerequisiteError('Cannot measure resource filesystem') from error
    result = {'root': str(root), 'observed_at': time.time(), 'available_bytes': free,
              'available_gib': round(free / GIB, 3), 'warning': free < 30 * GIB}
    if free < 15 * GIB:
        raise PrerequisiteError(f'Native startup blocked: {free / GIB:.3f} GiB available; requires15 GiB')
    return result


def _write(path, value):
    """Atomically replace private metadata inside an already owned directory."""
    temp = path.with_suffix('.writing')
    with temp.open('w') as stream:
        json.dump(value, stream, indent=2)
    os.chmod(temp, 0o600)
    temp.replace(path)


def _directory(path, inode, uid):
    """Reject symlink/ancestor substitution and identity changes before mutation."""
    if path.is_symlink() or path.resolve(strict=True) != path:
        raise CleanupError('Resource path is not canonical')
    observed = path.stat()
    if observed.st_ino != inode or observed.st_uid != uid or uid != os.getuid():
        raise CleanupError('Resource directory ownership changed')


class ResourceRun:
    """Attribute temporary clusters to one runner and recover only that runner's children."""

    def __init__(self, repository, root=DEFAULT_ROOT):
        """Create private run metadata before allocating database resources."""
        self.path = Path(tempfile.mkdtemp(prefix='egi-resource-', dir=Path(root).resolve()))
        self.token = secrets.token_hex(32)
        self.record = {'schema_version': 1, 'run_id': uuid.uuid4().hex,
                       'path': str(self.path), 'inode': self.path.stat().st_ino,
                       'uid': os.getuid(), 'repository': str(Path(repository).resolve()),
                       'owner_pid': os.getpid(), 'owner_identity': process_identity(os.getpid()),
                       'created_at': time.time(), 'capability_hash': hashlib.sha256(self.token.encode()).hexdigest()}
        _write(self.path / 'run.json', self.record)

    @classmethod
    def inherited(cls):
        """Join only the explicitly inherited capability, without creating or adopting a run."""
        path, token = os.environ.get('EGI_RESOURCE_RUN'), os.environ.get('EGI_RESOURCE_CAPABILITY')
        if not path and not token:
            return None
        if not path or not token:
            raise PrerequisiteError('Incomplete resource run capability')
        run = cls.__new__(cls)
        run.path, run.token = Path(path), token
        run.record = json.loads((run.path / 'run.json').read_text())
        run.validate()
        return run

    def validate(self):
        """Check directory identity and possession of the original run capability."""
        _directory(self.path, self.record['inode'], self.record['uid'])
        actual = json.loads((self.path / 'run.json').read_text())
        if actual != self.record or hashlib.sha256(self.token.encode()).hexdigest() != actual['capability_hash']:
            raise CleanupError('Run identity/capability mismatch')

    def reconcile(self):
        """Stop/remove only recorded children attributed to this exact run."""
        self.validate()
        errors = []
        for path in sorted(self.path.iterdir()):
            if path.name == 'run.json':
                continue
            try:
                cluster = OwnedCluster.restore(self, path)
                cluster.close()
            except (OSError, ValueError, KeyError, RuntimeError) as error:
                errors.append(f'{path}: {error}')
        if errors:
            raise CleanupError('; '.join(errors))

    def close(self):
        """Remove the run only after all its children have verified teardown."""
        if not self.path.exists():
            return
        self.reconcile()
        self.validate()
        (self.path / 'run.json').unlink()
        self.path.rmdir()

    @contextmanager
    def activate(self):
        """Propagate run identity and clean on normal/error/catchable-interruption exit."""
        names = ('EGI_RESOURCE_RUN', 'EGI_RESOURCE_CAPABILITY')
        old = {name: os.environ.get(name) for name in names}
        os.environ.update(EGI_RESOURCE_RUN=str(self.path), EGI_RESOURCE_CAPABILITY=self.token)
        handlers = {}
        def interrupted(number, frame):
            """Turn catchable termination into unwinding with owned cleanup."""
            raise InterruptedError(f'Resource runner interrupted by signal{number}')
        try:
            for number in (signal.SIGINT, signal.SIGTERM):
                handlers[number] = signal.signal(number, interrupted)
            try:
                yield self
            except BaseException as primary:
                try:
                    self.close()
                except BaseException as cleanup:
                    raise CleanupError(f'Primary {type(primary).__name__}: {primary}; cleanup: {cleanup}') from primary
                raise
            else:
                self.close()
        finally:
            for number, handler in handlers.items():
                signal.signal(number, handler)
            for name, value in old.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value


class OwnedCluster:
    """Initialize and stop a private socket-only PostgreSQL cluster with rollback."""

    def __init__(self, repository, binary, port=65432, database='postgres', root=DEFAULT_ROOT):
        """Acquire ownership before any fallible setup, rolling back failed startup."""
        self.capacity = preflight(root)
        self.run = ResourceRun.inherited()
        self.own_run = self.run is None
        if self.own_run:
            self.run = ResourceRun(repository, root)
        self.run.validate()
        self.path = Path(tempfile.mkdtemp(prefix='pg-', dir=self.run.path))
        self.binary = Path(binary).resolve()
        self.data = self.path / 'data'
        self.record = {'schema_version': 1, 'path': str(self.path), 'data': str(self.data),
                       'inode': self.path.stat().st_ino, 'uid': os.getuid(),
                       'run_id': self.run.record['run_id'], 'binary': str(self.binary),
                       'created_at': time.time(), 'server_pid': None, 'server_identity': None,
                       'phase': 'allocated'}
        self.save()
        self.environment = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        self.environment.update(PGHOST=str(self.path), PGPORT=str(port), PGDATABASE=database)
        try:
            self.command('initdb', '-D', self.data, '-A', 'trust', '--no-locale', '--encoding=UTF8')
            with (self.data / 'postgresql.conf').open('a') as stream:
                stream.write(f"\nlisten_addresses=''\nunix_socket_directories='{self.path}'\nport={int(port)}\n")
            self.record['phase'] = 'starting'
            self.save()
            self.command('pg_ctl', '-D', self.data, '-l', self.path / 'server.log', '-w', '-t', '15', 'start')
            self.capture_server()
            if database != 'postgres':
                self.command('createdb', database)
        except BaseException as primary:
            try:
                self.close()
            except BaseException as cleanup:
                raise CleanupError(f'Primary {type(primary).__name__}: {primary}; cleanup: {cleanup}') from primary
            raise

    def save(self):
        """Persist the resource state before the next fallible lifecycle operation."""
        _write(self.path / 'resource.json', self.record)

    def command(self, program, *args):
        """Run the selected PostgreSQL binary with bounded output and duration."""
        return subprocess.run([str(self.binary / program), *map(str, args)], env=self.environment,
                              text=True, capture_output=True, timeout=30, check=True)

    def capture_server(self):
        """Bind the running server's birth identity to this newly initialized data directory."""
        pidfile = self.data / 'postmaster.pid'
        if not pidfile.exists():
            return None
        lines = pidfile.read_text().splitlines()
        if len(lines) < 3 or lines[1] != str(self.data) or int(lines[2]) < self.record['created_at'] - 2:
            raise CleanupError('PostgreSQL identity contradicts allocation')
        pid = int(lines[0])
        identity = process_identity(pid)
        if identity is None or not identity.startswith(str(os.getuid()) + ' ') or f'-D {self.data}' not in identity:
            raise CleanupError('Cannot identify allocated PostgreSQL server')
        if self.record['server_identity'] and (self.record['server_pid'] != pid or self.record['server_identity'] != identity):
            raise CleanupError('PostgreSQL process identity changed')
        self.record.update(server_pid=pid, server_identity=identity, phase='running')
        self.save()
        return pid

    @classmethod
    def restore(cls, run, path):
        """Load a recorded child only under a caller-owned run for reconciliation."""
        run.validate()
        if path.parent != run.path or path.is_symlink():
            raise CleanupError('Not an owned run child')
        resource = cls.__new__(cls)
        resource.run, resource.own_run, resource.path = run, False, path
        resource.record = json.loads((path / 'resource.json').read_text())
        resource.data, resource.binary = path / 'data', Path(resource.record['binary'])
        resource.environment = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        resource.validate()
        return resource

    def validate(self):
        """Verify filesystem and record identities immediately before mutation."""
        self.run.validate()
        _directory(self.path, self.record['inode'], self.record['uid'])
        if (self.path.parent != self.run.path or self.record['path'] != str(self.path)
                or self.record['data'] != str(self.data) or self.record['run_id'] != self.run.record['run_id']
                or json.loads((self.path / 'resource.json').read_text()) != self.record):
            raise CleanupError('Resource record identity mismatch')
        if self.data.is_symlink() or self.data.exists() and self.data.resolve() != self.data:
            raise CleanupError('Data path substituted')

    def close(self):
        """Verify exact server shutdown before deleting disposable data; preserve failures."""
        if not self.path.exists():
            return
        self.validate()
        pidfile = self.data / 'postmaster.pid'
        if pidfile.exists():
            self.capture_server()
            self.command('pg_ctl', '-D', self.data, '-m', 'fast', '-w', '-t', '15', 'stop')
        pid = self.record['server_pid']
        if pid and process_identity(pid) == self.record['server_identity']:
            raise CleanupError('Owned PostgreSQL remains active')
        if pidfile.exists():
            raise CleanupError('PostgreSQL shutdown is not confirmed')
        # pg_ctl startup can finish after a timeout: never delete an unobserved starting cluster.
        if self.record['phase'] == 'starting' and not pid:
            raise CleanupError('Unconfirmed startup; preserve cluster for inspection')
        self.validate()
        if not shutil.rmtree.avoids_symlink_attacks:
            raise CleanupError('Platform lacks symlink-safe recursive removal')
        shutil.rmtree(self.path)
        if self.own_run:
            self.run.close()

    def __enter__(self):
        """Expose the already acquired resource to its bounded caller."""
        return self

    def __exit__(self, kind, primary, traceback):
        """Preserve both primary and cleanup diagnostics on an unsuccessful context."""
        try:
            self.close()
        except BaseException as cleanup:
            raise CleanupError(f'Primary {primary!s}; cleanup: {cleanup}') from primary


def run_check(name, command, root, *, timeout=300, environment=None):
    """Run a bounded child under its own resource scope and propagate cleanup failures."""
    from .report import Check
    started = time.monotonic()
    output, state = '', 'passed'
    try:
        with ResourceRun(root).activate():
            env = dict(os.environ) if environment is None else {**environment,
                'EGI_RESOURCE_RUN': os.environ['EGI_RESOURCE_RUN'],
                'EGI_RESOURCE_CAPABILITY': os.environ['EGI_RESOURCE_CAPABILITY']}
            process = subprocess.Popen(list(map(str, command)), cwd=root, env=env,
                                       text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       start_new_session=True)
            try:
                stdout, stderr = process.communicate(timeout=timeout)
                output = (stdout + stderr)[-4000:]
                state = 'passed' if process.returncode == 0 else 'blocked' if process.returncode == 2 else 'failed'
            except BaseException:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()
                raise
    except CleanupError as error:
        state, output = 'failed', output + '\n' + str(error)
    except (OSError, PrerequisiteError, subprocess.TimeoutExpired, InterruptedError) as error:
        state, output = 'blocked', output + '\n' + str(error)
    return Check(name, state, output[-4000:], round(time.monotonic() - started, 3))
