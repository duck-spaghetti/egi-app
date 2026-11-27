"""Exercise the public lifecycle command against isolated real web processes."""
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest


class PreviewLifecycleTests(unittest.TestCase):
    """Ownership checks preserve foreign processes, fixed origins and local data."""

    def setUp(self):
        """Create an owned Git fixture and minimal ASGI app without database access."""
        self.temp = tempfile.TemporaryDirectory(prefix='egi-preview-test-')
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        shutil.copy(Path(__file__).parents[1] / 'scripts/preview.py', self.root / 'scripts/preview.py')
        (self.root / 'fixture.py').write_text('''import os
async def app(scope, receive, send):
    if scope['type']=='lifespan':
        while True:
            message=await receive()
            await send({'type':message['type']+'.complete'})
            if message['type']=='lifespan.shutdown': return
    else:
        await send({'type':'http.response.start','status':200,'headers':[]})
        await send({'type':'http.response.body','body':b'{"status":"ok"}'})
''')
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'EGI-134: Fixture'], check=True)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); self.port = sock.getsockname()[1]

    def tearDown(self):
        """Stop only a fixture whose ownership still validates, then remove its files."""
        self.command('stop')
        self.temp.cleanup()

    def command(self, operation, *args):
        """Invoke the shipped CLI from an unrelated caller working directory."""
        result = subprocess.run([sys.executable, self.root / 'scripts/preview.py', operation, *args], cwd='/', capture_output=True, text=True, timeout=25)
        return result, json.loads(result.stdout)

    def test_start_reuse_restart_preserve_origin_and_data(self):
        """A healthy owned preview is reused; restart replaces only its server."""
        result, first = self.command('start', '--port', str(self.port), '--target', 'fixture:app')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(first['ownership'], 'owned')
        sentinel = self.root / '.local/visitor-data'; sentinel.write_text('preserve')
        _, again = self.command('start'); self.assertEqual(first['pid'], again['pid'])
        _, restarted = self.command('restart'); self.assertNotEqual(first['pid'], restarted['pid'])
        self.assertEqual(first['url'], restarted['url'])
        self.assertEqual(sentinel.read_text(), 'preserve')
        self.assertEqual(restarted['worker_provider'], 'disabled')
        self.assertEqual(restarted['browser'], 'unprobed')
        result, _ = self.command('start', '--port', str(self.port + 1))
        self.assertEqual(result.returncode, 2)

    def test_foreign_port_and_reserved_origins_are_preserved(self):
        """Occupied or reserved origins fail without terminating/substituting anything."""
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', self.port)); sock.listen()
            result, _ = self.command('start', '--port', str(self.port))
            self.assertEqual(result.returncode, 2)
            self.assertEqual(sock.getsockname()[1], self.port)
        result, _ = self.command('start', '--port', '4328')
        self.assertEqual(result.returncode, 2)

    def test_stale_pid_receipt_cannot_stop_another_process(self):
        """A changed process fingerprint blocks before signaling the recorded PID."""
        result, first = self.command('start', '--port', str(self.port), '--target', 'fixture:app')
        self.assertEqual(result.returncode, 0)
        path = self.root / '.local/preview/runtime.json'; original = path.read_text()
        receipt = json.loads(original); receipt['fingerprint'] = 'stale-reused-pid'
        path.write_text(json.dumps(receipt))
        try:
            result, _ = self.command('restart'); self.assertEqual(result.returncode, 2)
        finally:
            path.write_text(original)
        _, after = self.command('status'); self.assertEqual(after['pid'], first['pid'])
        self.assertEqual(after['ownership'], 'owned')

    def test_failed_start_exposes_log_not_secret(self):
        """An import failure is nonzero, bounded and points to durable diagnostics."""
        result, value = self.command('start', '--port', str(self.port), '--target', 'missing_module:app')
        self.assertEqual(result.returncode, 2)
        self.assertIn('logs', value)
        self.assertNotIn('Traceback', result.stdout)
        self.assertTrue(Path(value['logs']).exists())
