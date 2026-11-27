# Durable interpretation worker

EGI-109 supplies a separate Python process. It claims through the isolated
`egi_preparation_worker` login; it has no editorial session or general input reader.
The database grants only job lifecycle functions and rechecks access, current input,
public attestation and contact protection before dispatch. Only the assigned eligible
payload reaches the pinned Reviewer/adapter; metadata identifiers and unrelated rows
are not added by Python. No URL acquisition or external tools are exposed.

## Installation and configuration

Install the normal runtime lock, then the approved reproducible Reviewer artifact:

```
.venv/bin/python -m pip install --no-deps --require-hashes \
  --find-links /absolute/workspace/.local/artifacts/community \
  -r requirements-community.lock.txt
```

The internal extra is `community`, pinned to egi-reviewer 0.4.0. The separate hash
lock requires wheel SHA-256
`226f7c9d88e3052e133cf37d41054330eb58d079f2e04075926f1dab477e3bf8`.
It must not import a mutable neighboring checkout. The ordinary web application
can still run without the extra; local ranked suggestions return a safe unavailable response, while manual catalog browsing/selection remains available. Community worker/provider tests require it.

WorkerSettings reads `EGI_PREPARATION_WORKER_DATABASE_URL` and `OPENAI_API_KEY`
from the environment or the application's ignored `.env`. Keep that file private;
never place either secret in Git or a supervision plist. Missing settings produce a
safe configuration code. `--help` reads no key and makes no connection.

Before live operation the environment owner must provide a separate unprivileged
login with direct membership only in `egi_preparation_worker` and explicitly seed a
verified immutable `preparation.ai_configurations` row, enabling it through
`ai_settings`. The worker creates no role, schema or model configuration. The frozen
provider_config shape is:

```
{
  "provider": "openai", "api": "responses", "model": "APPROVED_SNAPSHOT",
  "store": false, "live_authorized": true,
  "language_version": "APPROVED_VERSION", "taxonomy_version": "APPROVED_VERSION",
  "timeout_seconds": 120
}
```

Optional `reasoning_effort` must be supported by that actual model. Timeout is
5–300 seconds. Every other key is refused. Token ceilings, three verified rates,
price reference and verification date are the adjacent database columns. No real
model/rate or live grant is seeded by installation. Creating a key does not approve
model choice, corpus eligibility, data-retention policy or spending. The monthly
USD10 cap and pessimistic reservations remain authoritative in PostgreSQL.

## Dispatch and accounting

```
.venv/bin/python -m app.backend.api.preparations.worker --once
.venv/bin/python -m app.backend.api.preparations.worker
```

Each queue call has a fresh short transaction/connection. A dispatch reservation
commits before HTTP; no canonical transaction spans provider I/O. A separate thread
renews its lease every 20 seconds. It stops on refusal/connectivity loss; late usage
still goes through database eligibility checks. A crash before dispatch can recover
its expired lease. A committed dispatch becomes uncertain on expiry and is never
automatically called again. Process signals stop after the current bounded exchange.
The launchd plist is an uninstalled template, not authorization to install a job.

The adapter uses the existing httpx runtime with one POST to the fixed OpenAI
Responses endpoint, redirects/proxy inheritance disabled, no hidden retries,
`store:false`, no tools and a strict closed JSON schema. Unknown optional facts use
null in the provider schema and become absent fields before independent Reviewer
validation. The schema is generated from the pinned Reviewer dictionary, excluding
canonical IDs and public-contact permissions. Quotes/offsets are never repaired.

Input preflight bounds the serialized UTF-8 body plus a 1,024-token framing margin
against the configured token ceiling, conservatively using the selected modern
byte-fallback tokenizer assumption. This estimate and actual token usage must be
checked for the approved model before live acceptance; it does not prove future
models' tokenizer behavior. Responses are bounded at 2 MiB. Output and reasoning
are bounded by the frozen maximum output tokens. Actual usage is independently
validated/settled by PostgreSQL; an over-bound/unknown outcome remains conservative.

An adapter instance retains safe usage independently of semantic validation.
Refusal, invalid quotes/schema or cancellation cannot erase known usage. Local
preflight refusal has known zero usage. HTTP errors/timeouts never imply free usage:
unknown usage calls fail_job as dispatched and retain the reservation. No provider
error text enters job diagnostics. A database outage can prevent final accounting;
lease recovery retains uncertainty rather than redispatching or declaring it free.
A known late result can settle through the original dispatch/lease; identical finish
receipts are stable and conflicting completions are refused.

The protected HTTP router adds `analisi` (202), job reads and explicit cancellation.
These do not load the API key or make an HTTP provider request in the web process.
The following UI ticket controls first-insertion versus explicit Update/Retry.

## Evidence and source references

Controlled provider tests use only MockTransport and fake credentials. Native worker
contracts run an isolated PostgreSQL cluster and verify separate I/O transactions,
private contact redaction, known/uncertain accounting, cancellation, heartbeat,
expired pre-dispatch recovery, no post-dispatch replay and identical late settlement.
No live model quality/cost/latency or paid-provider success is inferred from them.

API construction follows the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
and [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create),
read on 2026-11-26. `store:false` disables response storage; it does not establish a
Zero Data Retention contract. The approved provider data configuration must be
recorded before live tests. Full milestone review and human acceptance remain pending.

Final EGI-109 verification (2026-11-27): all 12 targeted provider/native-worker
checks passed after hardening nullable cleanup so unknown null keys remain invalid.
The prior full suite passed 181 tests (six prerequisite skips); the additional null
case is covered by that final targeted run. The supervision template passes plutil
syntax validation; the worker CLI help runs. No actual provider call was made.

Fixture protection: synthetic configurations carry `fixture_only:true`. The adapter
refuses them unless the injected transport is httpx.MockTransport, even if a real
key exists locally. The ordinary network worker therefore cannot accidentally send
demo material through a synthetic configuration. Seven controlled provider tests
and the native integration tests passed with this guard enabled.

## Literal source-fact protocol — EGI-116

An immutable provider_config can select interpretation_version2; omission means1.
validate_config rejects Boolean/unknown versions. Request version, pinned field
dictionary and result schema are selected together before dispatch. v2 Structured
Outputs exposes the pinned source_fact dictionary, requires literal claims, and
excludes canonical organization/classification components. Null cleaning preserves
required fact metadata for independent Reviewer rejection; it cannot repair missing
claims or turn model keys into canonical IDs. Existing pending v1 jobs stay compatible.

EGI-116 verified the0.3.1 artifact offline. The current0.4.0 pin is listed above;
no new dependency or live model/configuration is seeded. Native worker+HTTP tests use MockTransport
only and prove extraction→server fact IDs→manual edit→selective moderation, known
usage settlement and rejection of an old-client downgrade. Real model quality and
provider calls remain under the existing EGI-112/113 human gates.

## Optional frozen category context — EGI-119

Reviewer0.4.0 adds an optional catalog_context to an explicit v2 immutable
configuration. Native DB027 checks the actual published sealed-release labels,
coverage, active terms, broader links, territory/axis, dates and canonical digest.
Configuration version therefore binds the existing job reuse/cache identity.
The worker passes that context and a conditional strict matches schema in the same
single extraction exchange. It exposes supplied keys/digest/reasons, never an output
canonical ID, role, selection or confidence percentage. Context-free v1/v2 remain
compatible. Missing context causes no hidden ranking call; local manual matching
remains separate from billing. Expired context fails before reservation/dispatch.
Returned suggestions materialize as proposed/unresolved stable-fact resolutions;
manual/cleared values and confirmed/ignored decisions survive refresh.
