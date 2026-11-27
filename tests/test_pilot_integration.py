"""The retained-pilot launcher carries its explicitly selected PostgreSQL client to HTTP."""
from contextlib import nullcontext
from pathlib import Path
import signal
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from checks import pilot_integration


class PilotClientSelectionTests(unittest.TestCase):
    """Catch macOS defaults leaking into the Linux CI historical preview child."""

    def test_http_child_receives_selected_postgresql_client(self):
        """The child uses EGI_PG_BIN's psql regardless of inherited machine defaults."""
        class Captured(Exception):
            """Stop before launching a child after recording its environment."""

        observed = {}

        def capture(command, **options):
            """Capture the actual HTTP invocation and stop without acquiring a process."""
            observed.update(options['env'])
            raise Captured()

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            listener = SimpleNamespace(bind=lambda address: None, listen=lambda: None, getsockname=lambda: ('127.0.0.1', 4343), fileno=lambda: 123)
            cluster = SimpleNamespace(environment={'PGPORT': '65432', 'EGI_PSQL': '/wrong/macos/default'}, path=root)
            with patch.object(pilot_integration, 'ROOT', root), patch.object(pilot_integration, 'validate_fixture'), \
                    patch.object(pilot_integration.socket, 'socket', return_value=nullcontext(listener)), \
                    patch.object(pilot_integration, 'ResourceRun', return_value=SimpleNamespace(activate=lambda: nullcontext())), \
                    patch.object(pilot_integration, 'OwnedCluster', return_value=nullcontext(cluster)), \
                    patch.object(pilot_integration.subprocess, 'run'), \
                    patch.object(pilot_integration.subprocess, 'Popen', side_effect=capture), \
                    patch.dict(pilot_integration.os.environ, {'EGI_PG_BIN': '/usr/lib/postgresql/18/bin'}):
                with self.assertRaises(Captured):
                    pilot_integration.run(root)
            self.assertEqual(observed['EGI_PSQL'], '/usr/lib/postgresql/18/bin/psql')
            self.assertEqual(observed['EGI_DATA_MODE'], 'preview')

    def test_interruption_and_timeout_gracefully_stop_the_owned_check_group(self):
        """Catchable cancellation gives nested ResourceRun scopes time to unwind."""
        for error in (InterruptedError('interrupted'), subprocess.TimeoutExpired('check', 900)):
            with self.subTest(error=type(error).__name__):
                process = Mock(pid=12345)
                process.poll.return_value = None
                process.wait.side_effect = [error, 2]
                with patch.object(pilot_integration.subprocess, 'Popen', return_value=process) as launch, \
                        patch.object(pilot_integration.os, 'killpg') as kill:
                    with self.assertRaises(type(error)):
                        pilot_integration.run_integration({}, None)
                self.assertTrue(launch.call_args.kwargs['start_new_session'])
                kill.assert_called_once_with(12345, signal.SIGTERM)
                self.assertEqual(process.wait.call_args.kwargs['timeout'], 30)

    def test_unresponsive_owned_check_group_has_bounded_kill_fallback(self):
        """A child ignoring graceful termination cannot leave the wrapper waiting forever."""
        process = Mock(pid=12345)
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired('check', 900), subprocess.TimeoutExpired('check', 30), -9]
        with patch.object(pilot_integration.subprocess, 'Popen', return_value=process), \
                patch.object(pilot_integration.os, 'killpg') as kill:
            with self.assertRaises(subprocess.TimeoutExpired):
                pilot_integration.run_integration({}, None)
        self.assertEqual([call.args for call in kill.call_args_list], [(12345, signal.SIGTERM), (12345, signal.SIGKILL)])
        self.assertEqual(process.wait.call_args.kwargs['timeout'], 10)


if __name__ == '__main__':
    unittest.main()
