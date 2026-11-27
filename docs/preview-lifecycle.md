# Owned preview lifecycle

From the selected app Python environment, use `python scripts/preview.py status`,
`start`, `restart` or `stop`. The command resolves its own worktree independently
of the caller's current directory. The first start records its stable origin and
trusted local ASGI target; later invocations reuse them. For example:

```sh
python scripts/preview.py start --port 4340 --target checks.fixture_app:app
python scripts/preview.py status
python scripts/preview.py restart
```

The synthetic target uses actual application composition/templates with fixture
public reads. It requires no database, provider key or existing visitor profile.
Browser automation uses a separate fixed origin 4341 and fresh contexts. The
existing Community 4328 and saved-list 4335 previews are reserved and untouched;
this controller refuses to claim those ports or adopt their historical PIDs.

Status reports actual worktree, branch/current and startup revision, stable URL,
PID, logs, observed ownership/server/selected-reader state and elapsed time.
Reader response is not proof of native PostgreSQL readiness: the synthetic reader
responds without PostgreSQL. Browser readiness is unprobed until a bounded browser
check is performed. Worker/provider dispatch is disabled; the controller never
launches a worker or starts/stops a cluster. Private connection settings remain in
the caller's environment, outside status output; OpenAI/Community environment
settings are removed from the web child. No provider factory is launched.

An exclusive file lock serializes lifecycle actions. A private receipt, HTTP
per-start token, worktree and process creation-time/argument fingerprint must agree
before a signal is sent. macOS's Python launcher may exec Python.app, so identity
uses creation time and exact script arguments rather than the launcher filename.
Healthy owned servers are reused. Stale/reused PIDs, foreign listeners, changed
origin/target and startup failures return nonzero; no automatic port change, foreign
kill or deletion occurs. Logs persist in `.local/preview/server.log`. Stop affects
only the verified web process; it never removes browser storage or canonical data.

## Browser recovery

Discover the currently exposed browser backends/tools and read their installed
skill/API instructions before acting. Preserve valid runtime/tab bindings. If the
runtime uses a documented initialization step, initialize that trusted runtime and
make one bounded probe (tab metadata and a short DOM excerpt). After a kernel reset,
initialize again. Do not infer absence from an old namespace, read whole minified
bundles or dump entire error-page data URLs. An existing tab, available automation,
a successful probe and a native print dialog are separate observations. Site/access
refusals remain authoritative. Record the failing stage before requesting tooling
changes; native-dialog access is independent from the Playwright automated checks.

`tests/test_preview_lifecycle.py` exercises the public CLI with owned/foreign ports,
stale process fingerprints, reuse/restart and startup failure. It requires loopback
socket/process permissions and uses only temporary Git fixtures; no live DB is used.

Failed startup acquisition also terminates and reaps the just-created child when
source/receipt persistence fails. A bounded terminate→kill fallback handles a slow
child; cleanup errors remain blocked CLI results, never a claim of successful start.
