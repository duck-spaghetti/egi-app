# Private preparation HTTP

EGI-107 mounts `/moderazione/contribuisci/api` only when editorial access is
configured. It reuses the `/moderazione` cookie and the existing same-Origin,
session-derived form token (`X-EGI-Form-Token`). Every database action verifies
that session again inside the operation's transaction. The application neither
inherits Admin access to private originals nor bypasses PostgreSQL permissions.

Routes cover `persone`, preparation list/create/read, named `accessi`, raw `input`,
manual/candidate `schede/crea`, current/historical cards, bounded `cronologia`,
atomic card saves, compensating undo, workspace trash/restore, source metadata
registration and separate Admin admission. Analysis, submission and UI integration
follow in their milestone tickets; CSV ingestion belongs to the second delivery.

JSON mutations use closed root objects with `request_key`, except source admission
which takes `reason`. Source registration takes `{metadata,request_key}`. Creation
uses `{source_id,title,request_key}`. Sharing uses
`{actor_id,permission,expected_revision,request_key}` with `null` permission to revoke.
Card creation uses `{input_id,job_id,selections,request_key}`; `null` job and a stable
`creation_key` create a blank card. Saving uses `{changes,request_key}` and each
change carries `item_id`, `expected_version` and complete private `payload`.
Workspace trash/restore use `{expected_revision,request_key}`. Undo takes
`{request_key}` at `/preparazioni/{id}/operazioni/{operation}/annulla`.

Raw text uses `text/plain; charset=utf-8`, `X-EGI-Expected-Revision` (nonnegative
bigint), `X-EGI-Request-Key` (UUID) and exactly `true` or `false` in
`X-EGI-Public-Material`. The 50,000-code-point bound excludes a leading BOM; retained
bytes include it. UTF-8 is decoded strictly without replacement. Streaming stops
at 200,003 bytes even without Content-Length. JSON has an independent 1 MiB bound;
duplicate keys, nonfinite numbers and malformed Unicode are refused. Existing
64 KiB moderation form handling is unchanged; no multipart dependency is added.

Successful object receipts add `schema_version:1`; list responses have `items`.
Workspace/list reads accept `offset` and `limit` (1–100); the workspace response
contains item summaries, `offset` and `total`, while the card route reads full
payloads. The existing summaries include `display_name`: the authorized service
name limited to 160 characters, or null. No full card payload or additional item
read is needed to label navigation. History takes `after` and `limit` (1–100). Raw original reads return exact
bytes with `X-EGI-Schema-Version:1`. All responses are `no-store` and `nosniff`.

Errors contain only `{schema_version:1,code,request_id}`. Missing/invalid sessions
return 401, visible-but-forbidden operations 403, hidden/missing private resources
404, stale heads/request conflicts 409, bounds 413 and invalid shapes 422. Database
unavailability returns 503. No SQL, exception message, private input or credentials
enter the error envelope. Revocation is rechecked before returning any replay.

Run the real HTTP seam with the existing native backend:

```
EGI_DATABASE_REPO=/absolute/path/to/egi_database-community-text \
  .venv/bin/python -m unittest tests.test_preparations_native -v
```

The suite owns a unique temporary socket directory, no TCP listener, synthetic
people and disposable schema. It makes no provider calls or changes to populated
runtime databases. Independent milestone review and full integrated acceptance
remain pending.

Verification (2026-11-26): the existing application suite plus the initial two native
preparation journeys passed, 168 tests with six explicit external-prerequisite
skips. After the final local hardening changes, all three preparation HTTP journeys
passed on native PostgreSQL, including source admission, minimal people output and
invalid-session handling. No new dependency was selected. The upstream TestClient
httpx deprecation is informational; the project's selected httpx stack is retained.

## Payload compatibility — EGI-116

Existing response/receipt schema_version1 remains unchanged while an item payload
can explicitly be1 or2. The authenticated bootstrap declares supported item/result
versions. v2 raw source facts, resolutions and original-value evidence are validated
by PostgreSQL023/024, not a permissive replacement Python model. The server maps
item_schema_downgrade to a content-free409; new malformed/stale fact errors stay
content-free422/409. The existing JSON/text limits, Origin/token checks and read
permissions apply. Native HTTP checks prove v2 save/reopen/selective moderation and
old-client downgrade refusal without a new endpoint or any canonical side effect.

## Bounded reference reads and manual literal preparation — EGI-119

POST `preparazioni/{workspace}/catalogo` accepts query and uses the authorized DB
catalog (organization/taxonomy_context/classification). Search text stays in the
protected body, not an access-log URL. Pages are1–50 entries; selected organization
IDs can be looked up in batches of at most100. Reads have no write effects.
POST `preparazioni/{workspace}/schede/{item}/suggerimenti` takes expected_version,
fact_id and query. It derives the actual current fact value, compares at most100
local references and returns unconfirmed resolution, value/version/digest/coverage.
It dispatches no IA. Missing optional Reviewer installation returns safe503 for
ranking; catalog reads/manual selections remain independent.

POST `preparazioni/{workspace}/schede/{item}/fatto-preparato` takes input_id, kind,
subject and selection(start/end in the textarea LF/code-point view). The authorized
item/input are read in one verified transaction. The returned fact, exact locator
and origins are unsaved; the existing versioned save owns all mutation/receipts.
An authorized read-only person can prepare/read this fragment but still cannot save.
Foreign preparations remain404 and all POST reads require same-origin/form-token
protection. Moderation exposes catalog/suggestions scoped to its immutable snapshot,
never a private-input read route. Schemas and safe reference conflicts remain DB-owned.


Local lexical matching runs in the existing Starlette thread pool after authorized
catalog reads. Password verification/enrolment and synchronous account/session DB
work in async moderation routes use the same offloading boundary. Gated route tests
verify event-loop progress while matching/password work is waiting; this establishes
isolation from the loop, not a throughput or response-time SLA.

The same boundary covers editorial claim/waiting, proposal decisions, contribution
closure, protection release, canonical draft/move/create/publish and the retained
public contribution intake. Each transaction and its dependent rendering stay in
one worker callable; body/form parsing remains asynchronous. Seven gated tests cover
authentication, matching and representative editorial/intake waits.
