# Current development checks — EGI-130

The environment milestone adds one discovered check interface:

```sh
npm ci
python3 scripts/check.py --profile quick --json
python3 scripts/check.py --profile complete --json
```

Use the selected project Python environment with the existing runtime/dev lockfiles.
ESLint10.15.0 is a pinned development dependency (Node20.19/22.13/24+ as supported
by ESLint); no application bundler or runtime dependency changes. Setup:
https://eslint.org/docs/latest/use/getting-started . The existing test-only httpx
choice is preserved. Do not install a second Python lint/type toolchain.

Quick discovers Python fixture tests, Node test*.cjs suites, syntax and focused ESLint
checks. Explicit native/live suites are reported as Integration selections. The one
optional sibling-importer drift case reports its test identity/reason if absent;
other unexpected skips block the profile. Complete is the default delivery profile
and stays blocked until the later browser/offline/generated-PDF tickets provide their
required stages. Integration owns explicitly configured native/cross-repository
checks and is also currently blocked until its owning integration stage exists.
Exit codes:0 passed,1 failed,2 prerequisite-blocked. JSON schema1 includes source
commit, observed per-check state, named Python outcomes, reasons and durations.
Quick is not evidence of Complete success. Native desktop print remains separate.

The approved workspace execution record is
`project_egi/.scratch/agent-workflow-improvements/execution.md`. Saved-list and
Community feature branches have not been integrated into this dev-based worktree;
their product behavior is not claimed by these environment-only changes.

## Commit and push validation — EGI-131

`python3 scripts/commit_guard.py range BASE TIP` validates actual commit objects.
`commit-msg FILE` validates a prospective title; `pre-push` reads Git's update stream
and requires a clean worktree matching the pushed tip, passing Complete, and passing
Integration when shared developer/product boundaries changed. Required report status,
profile and source identity must agree with the process exit. Hook bypass cannot
hide an invalid new commit from range validation. CI adoption is session3 work.

Ordinary titles use `EGI-<positive number>: <summary>`. Git-generated merge messages
require merge context/parents; automatic reverts identify an existing target. Exact
historical SHAs are inventoried in the owning exception policy; they do not approve
feature integration or history rewriting. Commit bodies allow additional references.

Run `python3 scripts/install_hooks.py` only from the assigned worktree. It refuses
an unrelated existing hook path, sets a worktree-specific hooksPath, and preserves
other worktree hook configuration. Commit-msg allows a valid local checkpoint even
when Complete is blocked; pre-push refuses delivery in that state. Activate the
selected Python environment when using hooks. The standalone canonical utility has
no web-runtime dependency; provider repositories consume its exact pinned revision.

## Earlier app setup and retained evidence

# EGI app v0.2 — local preview

## B1 architectural completion

The current task branch implements the recovered backend/frontend organization.
See [Module responsibilities, Interfaces and verification](docs/b1-architecture.md).
The completion record is workspace `.scratch/mvp/b1-refactoring-completion.md`.
B1 completion verification and independent review are recorded in the workspace plan; a separate canonical
SQL supplement privacy defect remains open. Historical checkpoints below do not
represent acceptance of this candidate.


Recovered frontend from the original egi-app draft at
`c090950874a8c5ac39c83f9ba2aa1ae06356af84`, adapted to the current database's source
evidence. The original checkout is untouched. Map/list, source-need filters, service
details and Italian/English/French/Arabic UI catalogs are retained.

This is a local preview of unreviewed Helpinet and map-export data (GrIS Lazio,
Scuolemigranti, Programma Integra), not the approved public directory.
Routes use `/api/preview`. No canonical entity, editorial approval or publication is
created. Blank descriptions remain blank; source hours have a separately labelled preview status; coordinates are source claims. Missing coordinates stay in the list.

Development happens on `dev` of origin [duck-spaghetti/egi-app](https://github.com/duck-spaghetti/egi-app)
(public, 2026-11-19; `dev` since 2026-11-25); `main` receives only authorized promotions.
Current task/approval and dated verification evidence are indexed in the workspace
[tracker guide](../docs/agents/issue-tracker.md) and
[post-handoff plan](../.scratch/post-handoff/plan.md). The original draft is reference
history; production/editorial integration is a separate scope.

## A3 canonical local mode

The A3 branch adds a deliberately selected canonical mode alongside the retained
preview. `EGI_DATA_MODE=canonical` serves only approved PostgreSQL public reads for
Helpinet and Scuolemigranti. It never falls back to preview evidence on failure.
Other sources are absent until migrated. Local canonical publication is not an
Internet launch or confirmation that a service is currently available.

From this checkout, using the approved workspace environment:

```sh
EGI_DATA_MODE=canonical \
EGI_DATABASE_URL='host=/ABS/WORKSPACE/.local/a3-db port=65436 dbname=egi_a3_demo user=egi_a3_reader_login' \
/ABS/WORKSPACE/.local/venvs/app-a3/bin/python -m uvicorn app.backend.main:app \
  --host 127.0.0.1 --port 8003 --no-access-log
```

The schema prerequisite is the approved database through `007_linked_supplements`;
provisioning/loading is separately authorized in the workspace A3 design. Do not
point this command at the primary preview or provision an arbitrary target.
`EGI_DB_BACKEND` accepts only `postgres`; since B1 the territory code comes from the
`EGI_APP_CONFIG` profile (`EGI_TERRITORY_CODE` is no longer read).
`EGI_QUERY_CATALOGUE` can select a trusted local YAML catalogue. Missing settings,
unsupported backends, duplicate YAML keys and missing operations fail startup
without echoing secret values. There is no SQLite backend or connection pool.

`config.py` validates configuration; `db/database.py` owns bound
queries, read-only repeatable-read transactions, connection/statement timeouts,
error mapping and the cache; `queries/public.yaml` holds the named reads.
`api/directory/projection.py` adapts public payloads into map/list/detail cards. Canonical routes
are `/api/public/services`, `/services/{uuid}` under that prefix, `/categories`,
`/category-translations`, `/taxonomy`, `/areas` and `/languages`. `/health` reports
`canonical-local`. Store failure returns a safe 503, never a successful empty map.

The cache holds at most eight language snapshots for 60 seconds, invalidated by
public sequence changes and opening transitions. Linked supplements are reread on
every request because their review/link decisions can change independently.
They contain only explicitly approved secondary contacts/conditions with provenance;
raw assertions, drafts and private contacts are unavailable. Missing points stay
in the list; unknown days stay unknown across overlapping schedules. Open-now uses
canonical opening status and refreshes while the map is open. Source attribution,
original text and translation metadata are retained; UI translation completion is B2.

Canonical mode returns 404 for raw preview/debug/review and benchmark surfaces.
The existing address-search operation remains available independently of local
transport. `EGI_LOCAL_LAYERS=1` optionally enables the existing local transport,
rail and cycle runtime paths (`EGI_TRANSPORT_ROOT`, `EGI_RAIL_ROOT`,
`EGI_OSM_RAIL_ROOT`, `EGI_CYCLEWAYS_ROOT`). Transit place UUIDs/points come from
canonical reads; the preview store is not consulted. These layers do not select
public-launch transport or authorize fresh acquisition/job changes.

For native verification set `EGI_DATABASE_REPO` to the explicit database worktree and,
optionally, `EGI_SQITCH` to Sqitch (with `PERL5LIB` if needed); without it
`tests/native.py` runs the plan's deploy scripts with psql in plan order.
Use the A3 Python environment for `python -m unittest discover -s tests -v` and run
`node --experimental-vm-modules tests/test_canonical_map.cjs` in addition to the two existing Node suites.
The independent native harness creates only `/private/tmp/egi-app-read-*` targets.
It checks restricted-role reads, HTTP isolation, bound parameters, safe failures,
publication/withdrawal cache invalidation and fresh secondary review eligibility.

## B1 structure, configuration and request privacy

B1 (workspace plan `.scratch/mvp/b1-plan.md`) keeps the A3 behavior and changes:

- **City profile.** `EGI_APP_CONFIG` selects one validated YAML profile; default
  `app/backend/app_profile.yaml` (Rome: territory code, fallback centre/bounds/zoom,
  search extent, public origin, emergency numbers, external-service notice). Only
  these resolved public values reach page bootstrap and `/areas`; DSN and local
  paths never do. Geocoder bounds and frontend time zone use the same profile.
- **Coordinate-free URLs.** `POST /api/preview/address-search` `{query}`,
  `POST /api/preview/transit/origin` `{lat,lon}`, `POST /api/preview/transport`
  `{west,south,east,north,zoom,modes,routes?}` and `POST /api/preview/cycleways`
  `{west,south,east,north,zoom}` take typed bodies that reject unexpected fields,
  unknown modes, nonfinite or oversized extents and more than 80 routes (schemas in
  `request_schemas.py`). The old coordinate GET forms return 405. The visitor's
  position, search text and selected address stay in page memory only (no URL,
  storage or cookie); reload forgets them. Directions links carry only the public
  destination.
- **Errors and diagnostics.** Failures return an allowlisted message plus an opaque
  diagnostic ID. `diagnostics.py` writes only UTC time, severity, event code and
  code location under `EGI_ERROR_DIR` (default `.local/errors` in the working
  directory), expired after 14 days at startup and periodically while running.
  Launch with `--no-access-log`.
- **Geocoder cache.** Process memory only, HMAC-keyed with a random per-process key
  and provider/profile scope, 300 s TTL, at most 128 entries.
- **Local assets.** Leaflet 1.9.4, Leaflet.markercluster 1.5.3 and the Fraunces/IBM
  Plex typefaces are served from `/static/vendor/` and `/static/fonts/` with their
  licences and `static/vendor/manifest.json` integrity hashes; no CDN or Google
  Fonts request remains. Map tiles and an explicit address search still contact
  OpenStreetMap/Nominatim.
- **Modules.** `main.create_app` owns instance resources through `config.py` and
  `dependencies.py`; actual endpoint families live under `backend/api/`, each with
  router/service/schemas/dependencies/exceptions responsibilities. `db/` owns the
  configured reader and `queries/` the named YAML reads. The map's `js/pages/map.js`
  coordinates explicit `features/` Interfaces; no shared mutable runtime is exported.
  See [the current architecture](docs/b1-architecture.md) for ownership and test Seams.
- **Map behavior.** One marker per exact coordinate among filtered results; the
  detail lists the other public services at that point, labelled `Fuori dai filtri
  attivi` when outside the current filters. Unverified hours show `Aperto · da
  verificare` / `Chiuso · da verificare`; overnight intervals render on both days.

The B1 demo used the reader role on the B1 database:

```sh
EGI_DATA_MODE=canonical EGI_LOCAL_LAYERS=1 \
EGI_DATABASE_URL='host=/ABS/WORKSPACE/.local/b1-db port=65438 dbname=egi_b1_demo user=egi_b1_reader_login' \
EGI_ERROR_DIR=/ABS/WORKSPACE/.local/b1-app/errors \
/ABS/WORKSPACE/.local/venvs/app-a3/bin/python -m uvicorn app.backend.main:app \
  --host 127.0.0.1 --port 8004 --no-access-log
```

The current B1 demo has `009_contact_protection_register` (applied2026-11-24
under a separate grant after backup). It retains 594 public cards and zero orphan
addresses, with the same read-only login; public shapes are unchanged. The app
still reads only public projections, while 009 also guards persistent contact
restrictions and linked-contact labels. No historical inventory/backfill or
privacy-role membership was added. Entry, map and public detail were smoke-tested
in the browser after application; the existing process needed no restart.
The prior 008 baseline is superseded for this demo. Tests add
`node --experimental-vm-modules tests/test_canonical_map.cjs` and
`node --experimental-vm-modules tests/test_map_modules.cjs` (the module test needs
the flag for `vm.SourceTextModule`). Error-path tests write diagnostics; set
`EGI_ERROR_DIR` to a temporary directory so they do not land in `.local/errors`.
`node --experimental-vm-modules tests/test_review_corrections.cjs` covers clipboard
completion after page disposal and reference changes through the actual origin
and transport modules, including cancellation of obsolete transport responses.

Verified A3: 130 Python tests, six declared skips (five legacy live-preview HTTP
cases and one sibling-checkout transport fixture); all three Node suites and
changed-JavaScript syntax checks pass. Real browser checks covered 594 cards,
188 education results, a Scuolemigranti detail, unknown days, retained local transit,
Arabic RTL/fallback and return to Italian. This is not mobile or staging acceptance.
B1 still owns module extraction, city configuration, coordinate/query privacy,
14-day redacted errors and local fonts/libraries. The local demo disables access
logs but does not claim that broader privacy work is complete.

## Moderation (B3.1)

`/moderazione` is the moderators' area (ADR 0009, 0011 of the workspace). It is not
linked from public pages and is mounted only when `EGI_EDITORIAL_DATABASE_URL` is set.
The database verifies each person's session; the app connects with one editorial login.

| Variable | Meaning |
| --- | --- |
| `EGI_EDITORIAL_DATABASE_URL` | libpq string of a login created `LOGIN IN ROLE egi_editorial` |
| `EGI_EDITORIAL_COOKIE_SECRET` | at least 32 random characters; signs form tokens and the Google sign-in cookie |
| `EGI_EDITORIAL_SECURE_COOKIE` | `true` by default; `false` only for plain-HTTP local tests other than `localhost` |
| `EGI_EDITORIAL_GOOGLE_CLIENT_ID`, `EGI_EDITORIAL_GOOGLE_CLIENT_SECRET` | enable "Accedi con Google"; the redirect URI to register is `<origin>/moderazione/google/ritorno` |
| `EGI_EDITORIAL_GOOGLE_METADATA_URL` | another OpenID Connect provider's discovery document |

Sign-in is by Google (bound by issuer and subject, never email) or by password
(argon2, at least 12 characters); the admin also enters a TOTP code. Sessions last
8 hours idle and 14 days at most. Every POST must come from this origin; signed-in
POSTs also carry a per-session form token. New text is in `translations/it.json`
under `moderation` (other languages fall back to Italian until B2).

Create the first admin once, with the database owner's connection, and hand over the
printed invitation link (valid 48 hours, once):

```sh
EGI_OWNER_DATABASE_URL='host=… dbname=… user=OWNER' \
.venv/bin/python -m app.backend.api.moderation.bootstrap admin "Nome Cognome" --origin http://127.0.0.1:8000
```

Further accounts are invited from `/moderazione/account`. `/moderazione/coda` lists
contributions grouped by service, filtered by state, kind, category, waiting reason
and claimant; a contribution page shows its text, the submitter's contact, proposals
and history, and lets a person claim, take over, release, reassign or set a waiting
reason ("serve l'admin" puts it in the admin's view). Tests:
`tests/test_moderation_access.py`, `tests/test_moderation_queue.py` (need `EGI_DATABASE_REPO`) and
`tests/test_moderation_oidc.py` (ID token verification against a mock provider).

`/moderazione/servizi` finds any service by name, published or not; its workspace
(`/moderazione/servizio/<id>`, EGI-83) edits name, description, need, delivery mode,
status, cost, contacts and access conditions. The form starts from the complete
revision body read by the database (`editorial.revision_body`, egi_database 012), so
untouched parts keep their components and evidence; a changed value cites no source.
"Salva bozza" creates a working draft and leaves the public card unchanged; the
comparison shows source, public and draft values side by side with the source records'
text; "Approva e pubblica" publishes exactly that draft with a change summary. A save
or publication built on revisions that have since moved is refused and the person's
unsaved values stay on the page. Contact protections are applied by the database on
public reads, so an edit cannot release them.

Hours (EGI-84) are edited in the same form as structured schedules: one per audience
(the service, its intake desk or one saved contact line), each weekday open in time
ranges, closed or unknown, a range ending at or before its start ending the next day.
Two schedules of one audience may not be valid on a common day, because "aperto ora"
reads one; shared calendar exceptions are kept as they are. The place section finds a
location by name or address, or creates one (name, kind, address, optional point
picked on an OpenStreetMap tile map or typed); moving a service saves a draft of that
service only. `/moderazione/servizi/nuovo` creates a service at a chosen or new
location, or without one. A created location or service cites what the person
verified, recorded as a "Redazione EGI" observation (`editorial.record_observation`,
egi_database 013); a new location is published together with the service. The
moderation pages allow images from `tile.openstreetmap.org` for that map, sent with
the origin only as referrer. Tests: `tests/test_moderation_workspace.py`.

### Contribution decisions (EGI-85)

The contribution detail and the service workspace show proposals individually.
Accept or amend one into a draft, or reject it without changing the service. A
moderator explicitly enters and verifies structured contacts, one weekday's hours,
a single access condition or a new delivery location; visitor prose is not parsed
into those structures automatically. Changed facts cite the selected observation
method as Redazione EGI. The other components keep their identities and evidence.
Concurrent/stale forms are refused; a decision and its draft save commit together.
Existing contact/condition collections and interval sets above the UI insertion
bounds are preserved rather than truncated. A refused hours form retains its
unvalidated controls so other unsaved changes can be corrected and resubmitted.

A new-service contribution opens the location-first creation form with its name,
offer, address and link prefilled. The moderator confirms the delivery mode and
verification. It remains a draft; repeating the same accepted name proposal does
not create a second service. The existing contribution keeps its original target
(NULL for a new service); at closure the moderator explicitly selects the matching
published service, searchable by name. Durable preparation/update lineage belongs
to the separately approved Community work, not this visitor intake.

Closing uses Published (an explicitly selected publication, made after accepted
proposal decisions), No change, Rejected or Duplicate (reason required). Closure
uses the existing database retention rules; it does not publish a draft. Admin's
separate protection-release form approves/publishes an exact draft while releasing
one chosen protection under the existing database capability and scope checks.
Ordinary publication never releases it.

Native tests: `tests/test_moderation_decisions.py` with `EGI_DATABASE_REPO`. The
retention scheduler templates remain in the database repository's
`scripts/retention/`; installing one, provisioning a real login or applying SQL to
a non-disposable demo still requires the existing separate grant. Tests use only
their own temporary clusters/accounts and call the real retention function.

### Visitor contributions (EGI-22)

`/contribuisci` receives reports from a card's "Segnala un errore", still-valid
signals from "Ancora valido?" and new-service proposals from the menu. It is active
only in canonical mode with `EGI_INTAKE_DATABASE_URL` set to a login created
`LOGIN IN ROLE egi_intake`, which may only call `editorial.submit_contribution`
(global limits, honeypot, admin switch; no IP). Otherwise the page explains that
contributions are not available. The form states retention and confirms receipt only.
Tests: `tests/test_contribute.py` (needs `EGI_DATABASE_REPO`).

## Setup and start

Use the selected existing FastAPI/Jinja2/Uvicorn stack in a dedicated `.venv`.
The user confirmed this stack on 2026-11-08; exact installed versions are in requirements.lock.txt. No SQLAlchemy,
GeoAlchemy, Django, LLM, geocoder or Python DB driver is needed for this preview.

To reproduce the approved environment, from this directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
# dev lock: currently the runtime lock only (httpx is a runtime dependency since EGI-57)
.venv/bin/python -m pip install -r requirements-dev.lock.txt
```

Then start the preview:

```sh
sh scripts/start.sh
```

Open `http://127.0.0.1:8000/map?city_id=1&lang=it` or the entry wizard at `/`.
If that port belongs to another session, preserve its process. With the recorded
preview database already running, a separate instance can use:

```sh
.venv/bin/python -m uvicorn app.backend.main:app --host 127.0.0.1 --port 8001 --no-access-log
```

Use the actual instance's port for browsing and live tests; 8001 was used for R3.
The app binds only loopback. It uses a dedicated `egi_preview_reader` role, with only
selected source-table read grants and a read-only transaction default. It has no
canonical-draft table grants and cannot load or publish data.

The runtime database identity is stored in the workspace parent
`.local/preview-db/runtime.json`, outside all component Git histories. PostgreSQL
listens only on a private Unix socket. The database server and data are retained
for local review; stopping does not delete them.

```sh
python3 scripts/manage_preview_db.py status
python3 scripts/manage_preview_db.py stop
python3 scripts/manage_preview_db.py start
```

Initial creation/deployment can be repeated with `scripts/bootstrap_preview_db.py`.
Set `EGI_SQITCH` to an installed Sqitch and `PERL5LIB` if using its contained Perl
runtime. It deploys/verifies the existing sibling egi_database plan, without editing
or rewriting migrations. It reuses only its exact recorded preview cluster; it does
not touch any other existing PostgreSQL target.

## Repeat the source load

From sibling `egi-importer`, after the preview database is running:

```sh
python3 scripts/load_preview.py --input runs/helpinet-02/normalized/bundle.json --preview
python3 scripts/load_preview.py --input runs/helpinet-02/normalized/bundle.json
```

These select the delivered v0.2 interpretation; omitting `--input` retains the
script's historical v0.1 default. Select another validated bundle explicitly.
Source/record IDs are reused; repeated content is not duplicated. A new capture or interpretation preserves
history. The loader commits its complete import unit or rolls back. Imported source
subjects remain separate from canonical publication.

The app reads the latest succeeded normalization for the selected Helpinet dataset,
and for every dataset of each importer source (the Sant'Egidio guide has one per chapter), through `app/backend/api/preview/subjects.py` (see
[Map sources](#map-sources-my-maps-2026-11-09)). The snapshot is cached in-process: for 60 seconds
no query is made, then a cheap `run_id` probe decides whether to reload. An accepted
new load is therefore visible within about a minute, without restarting the app or
rebuilding static JSON. Database availability is likewise observed at most once a
minute. No dataset content is hardcoded into the app.

## Verify

Without a running app or database, the in-process tests (fixture subjects,
cache behaviour, transport projection) run with:

```sh
.venv/bin/python -m unittest discover -s tests -v
node --experimental-vm-modules tests/test_map.cjs
node --experimental-vm-modules tests/test_transport_layer.cjs
```

With the app running, the live HTTP tests against the real preview database run too:

```sh
EGI_APP_BASE_URL=http://127.0.0.1:8000 .venv/bin/python -m unittest discover -s tests -v
```

Use `EGI_APP_BASE_URL` only for the retained 315-record Helpinet pilot required by
`test_preview_http.py`; it is not the B1 canonical-demo URL. For changed JavaScript,
run `node --check` on the affected files. Last recorded suite/browser results are
in the post-handoff plan; commands here do not claim a currently running server or
a fresh passing test result. TestClient's httpx deprecation is known; the user
selected retaining the existing test-only dependency.

Database-backed loader tests run separately under egi-importer with EGI_TEST_DSN
pointing specifically to the dedicated egi_import_contract database. Recorded evidence
and the scope are in [v0.1 plan](docs/v01-plan.md).

## Need-first presentation taxonomy (v0.3)

The map's need tiles, offers ("Prestazione"), "Per chi", "Pasto", "Come si accede" and quick
paths come from `app/backend/api/preview/taxonomy_v0_3.json`, applied to every card by
`app/backend/api/preview/taxonomy.py` (`/api/preview/taxonomy` serves the labels and paths). v0.2 was
approved on 2026-11-09; v0.3 on 2026-11-15 during the source-by-source review
([proposal](../.scratch/taxonomy/proposal.md) §13, [plan](../.scratch/taxonomy/v0.3-plan.md)).

- Tiles: Mangiare, Dormire, Lavarsi, Vestiti e coperte, Centri diurni e multiservizi,
  Salute, Violenza e protezione, Orientamento: non so da dove partire (was Ascolto e aiuto),
  Documenti e diritti, Istruzione, Lavoro. The source's own need stays in `source_category`.
- **Structured sources (Helpinet)**: a card enters one need, from its own service type (or a
  listed override: "Anti tratta" and services named "CAV …" → Violenza), and its offers come
  only from its own `prestazioni` inside that need, else from the type's default cluster.
  Facility names and referral offers ("Orientamento ai servizi", "Orientamento socio-legale")
  assign nothing (`structured` in the vocabulary).
- **Other sources** keep the v0.2 rules until their own review: a card appears under every
  need of its offers (type, name rule or printed word). Anti-violence centres go to Violenza
  only.
- Each offer, audience and access tag records its basis: the source service type, a source
  prestazione, a name rule, a source flag, or a printed word (`interpreted`, shown dashed with
  "*" on the card). Original source fields are unchanged.
- Meal tags (colazione/pranzo/cena) only for meals on site or to take away: from opening
  windows, else from printed words.
- Set `"enabled": false` on an offer to switch it off. Paid hostels stay hidden with an
  "a pagamento" tag.
- Quick paths stay in the vocabulary (`/api/preview/taxonomy`) but are no longer shown in the
  filters (user, 2026-11-16). The emergency sheet links to the help lines.

Measured on 2026-11-15 with Helpinet run helpinet-03 (2,251 cards; 309 Helpinet after six
merges, all placed): one need each — Salute 66, Mangiare 45, Orientamento 43, Documenti 30,
Lavarsi 27, Lavoro 24, Violenza 20, Dormire 19, Vestiti e coperte 17, Istruzione 17,
Multiservizi 1; e.g. Dipendenze 29 (22 Alcoholics Anonymous groups), pasto sul posto 27 / da
asporto 12 / cibo da cucinare 7.
This is a presentation mapping, not the canonical taxonomy (egi_database).

## Limits

The local preview has a separate floating **Livelli** control, independent from
**Filtri**. Metro/Treni/Tram/Autobus and cycleways can be enabled individually;
layers start off. Metro routes remain visible at overview zoom, tram routes from
12; rail stations from 12, metro stations from 13, tram stops from 14 and bus stops
from 16. Bus routes appear only on line selection/focus. Timed rail shows regional/
metropolitan stations without approximate NeTEx polylines; OSM local rail retains
its actual topology. See [discovery UX](docs/discovery-ux.md) for the current contract.

`/api/preview/transport` reads the sibling workspace `.local/transport` files;
`EGI_TRANSPORT_ROOT` can explicitly select another runtime directory at startup.
Only `load_active` in `app/backend/api/transport/network.py` knows that layout; it follows
`../egi-importer/docs/transport-format.md`. Tests use the vendored example in
`tests/fixtures/transport-root` and, when the importer sits alongside, check that
the copy still matches the producer's.
It is a `POST` with JSON body west/south/east/north (WGS84 bbox), zoom (0–19),
modes (any of `metro`, `rail`, `tram`, `bus`, comma-separated) and optional
`routes` (at most 80). It returns GeoJSON plus active-version and refresh metadata.
Bounding boxes select intersecting route shapes. Below zoom 17 the response uses the
importer's simplified levels (50 m from zoom 11, 12 m from 13, 3 m from 15); full
source shapes from zoom 17. Responses over 1 KB are gzip-compressed (level 5).
Ordinary bus geometry is suppressed; focus and point thresholds follow the rules above.
The browser debounces viewport requests, cancels old requests and rechecks every
minute. That refresh only reads local files; the importer checks upstream every
six hours independently via launchd. Missing/expired transport is explicit and
never prevents Helpinet loading. Failed fetches retain the last valid version. When no poll
attempt was recorded for 24 hours the response sets `refresh_stale` and the map
asks to check the update job.

### Nearby transit ("Vicino a")

`GET /api/preview/transit/places` returns, for every located place, the nearest
metro, rail and daytime surface line and total line count; the list shows a compact
badge. `GET /api/preview/transit/places/{place_id}` returns timed lines scheduled
today and explicitly untimed OSM rail with a stop within 500 m (metro/rail 800 m):
one row per line at its nearest stop, metro/rail first, night lines (`n…`) last.
Walking time is an estimate:
straight-line distance × 1.3 at 4 km/h, rounded up, and the card says so. The
service card shows four stop groups followed by "Altre N fermate". No badge for itinerant services,
remote/directory services or services without coordinates. Logic and constants are
in `app/backend/api/transport/nearby.py` and `app/backend/api/transport/osm_rail.py`; unavailable or
out-of-calendar timed sources contribute no timed rows, while an independent OSM
runtime may still supply untimed rows. Service data remains usable.

The service card's **Trasporti nelle vicinanze** section starts closed. It shows
physical stop groups by distance across modes, with expandable lines/alerts and
focus buttons; destination countdowns are omitted. Selected bus lines retain their
full route geometry and stops, while approximate NeTEx rail geometry is suppressed.
The focus chip resets the view. **Posizione** instead offers departures near an
explicitly chosen origin, with their update time and refresh action. Address search,
map selection and geolocation share that origin. See the
[API and behavior contract](docs/discovery-ux.md).

### Scheduled departures

`app/backend/api/transport/departures.py` reads the active version's `departures.sqlite`
(read-only) and returns the next scheduled times per stop, line and direction
from the current Rome time, including after-midnight trips of yesterday's service
day; a direction with no further trip says so. `GET /api/preview/transit/departures
?stops=<ids>&routes=<ids>&limit=3` (at most 40 stops) feeds the stop popups, which
load when opened and stay open across layer refreshes. Each "Vicino a" row shows
the next two times per direction, gathered from the nearest stop and same-named
stops of that line within 150 m (other platform, other side of the street).
When `realtime/latest.json` was refreshed within 3 minutes, directions also show
predicted times (green dot, delay or advance in minutes) above the scheduled ones,
which stay visible because predictions only cover trips already tracked; stale
realtime falls back to scheduled times and says so. Service alerts in force for a
stop's lines or the stop itself appear under the stop (collapsed beyond two) and in
popups. Wheelchair access is shown only
when the source states it; the current Rome feed leaves it empty for every stop.

Bus/tram predictions are available where the realtime feed covers them; metro and
NeTEx rail remain scheduled, and OSM rail has no times. All remain attributed
source data, not approved public EGI information. No transport DB grant or schema
change. See sibling [importer instructions](../egi-importer/README.md) and
[execution evidence](../egi-importer/docs/archive/tpl-execution.md).

- Category groups are Helpinet's native needs for browsing, not an adopted EGI taxonomy.
  Map layers join these groups through a presentation crosswalk (`MAP_LAYER_GROUPS`).
- Existing itinerant positions are flagged, not treated as verified fixed delivery sites.
- UI catalogs are recovered; service content remains source-original Italian with no
  fabricated translations. Preview labels currently use Italian.
- Leaflet/cluster libraries and fonts retain the original external providers; map tiles use the standard OpenStreetMap endpoint with visible attribution;
  network access is needed for the basemap. No offline map is claimed.
- Contribution forms, original CRUD routers, editorial matching and public export are
  not connected. Hosting and deployment remain separately scoped.

## Historical v0.1 verification — 2026-11-08

At that checkpoint the app ran on http://127.0.0.1:8000. Three live HTTP checks and JavaScript
helper checks passed. A browser walkthrough confirmed the 315-result list, a source
UUID detail, the 46-result native cibo filter and restoration of all services.
No console errors/warnings were observed in the checked tab. The original CARTO
basemap showed an API-key placeholder, so the preview uses standard OpenStreetMap
tiles and its required attribution. Initial zoom now frames Rome.

See [execution evidence](docs/v01-execution.md) and [verification](docs/v01-verification.json).

## Service preview v0.2

One service per card, provisional related services from the native parent, deterministic evidence-linked summaries distinct from empty original descriptions, positive access claims, readable unknown-aware hours, native need/type/prestation filters, local category icons and explicit reference-point distance ordering are now available. Missing-point physical services remain listed; Rubrica requires explicit remote delivery. Inspect `/benchmark` for field-by-field coverage. New preview copy is Italian.

Use `python3 scripts/load_preview.py --input runs/helpinet-02/normalized/bundle.json` from egi-importer to repeat the delivered v0.2 load. The script's historical default still selects v0.1; select `--input` explicitly. See [v0.2 plan](docs/v02-plan.md) and [execution evidence](docs/v02-execution.md) for reproduction, acceptance and limits. At the v0.2 checkpoint, 15 importer tests, 9 app tests, Node checks and a browser walkthrough passed; later verification is recorded in the shared task plans.

## Cross-category POIs and source opening status

The subsequent UI refinement integrates the discovery controls, shows every colocated service category on source-site markers, puts icons inside category badges and exposes source-derived opening/countdown status in detail and list. Phone/email labels use explicit labels or original contact values. The status is an ephemeral Europe/Rome calculation with source uncertainty; missing days never imply closure. See [refinement execution](docs/ui-refinement-execution.md) for rules and current verification.

The discovery panel also offers **Aperti ora**, combining with existing filters in map/list and refreshing membership with the source opening status. Unknown or ambiguous hours are excluded while active. See [open-now checks](docs/open-now-execution.md).

### Service sheet layout r3 (2026-11-15)

Approved in [card-layout plan](../.scratch/card-layout/plan.md) (proposals r1–r3). The detail
sheet (`openDetail` in `features/search/index.js`) has:

- a **fixed header** instead of "Scheda servizio": category, title (the card's main offer
  cluster, else the source's service name), facility · address, coloured hours status with
  today's hours and an amber "orari da verificare" flag, "Organizzato da", source chips with
  the single "da verificare" flag, "Segnala errore" and close; it condenses to one line while
  scrolling;
- **anchors** (Informazioni, Orari, Contatti, Come arrivare) on one scrolling page, tracking the
  section in view;
- **Informazioni**: Cosa offre (source prestazioni only when not already an offer or a course
  level), Per chi, Come si accede, printed access text, course levels, source description
  (collapsed beyond ~260 characters), other services at the place;
- **Come arrivare**: the nearest stop named first; with a reference position, the nearest stop
  served by a line that also stops near the user ("Autobus 16 passa anche da Termini…"); other
  stops under "Altre N fermate";
- **Fonti e aggiornamenti** at the end: the only place detailing reliability (data date,
  position method, organisation role, merged records, interpreted labels) and original data;
- a **fixed bar**: Chiama (or Scrivi / Sito web when there is no phone) and Indicazioni.

The service chooser for several services at one point keeps the plain sheet head.

**Round r4 (2026-11-16)**: the title is the facility name with the service type (main offer
cluster) beside it, in the sheet and the list (sorted by facility, then type); "Organizzato da"
is hidden when it repeats the facility; the sheet header shows the distance when a position is
set; "Cosa offre" lists offers and the source's other prestazioni in one row of chips
(outlined = source wording); "Altri servizi qui" sits above "Fonti e aggiornamenti"; labels
"Igiene" (was Lavarsi) and "Supporto alle dipendenze".

**Filters r4**: need first. Nothing is selected when the map opens (= every service);
choosing a need lists its offers as chips, all on, each can be switched off; "Pasto" appears
only inside Mangiare. "Tipo di servizio", "Prestazione" and the quick paths are gone. A fixed
bar holds "Cerca" (closes the filters and shows the map) and "Azzera filtri" (when a filter
is active).

**List cards** follow the same hierarchy: category (and distance), title, facility · address,
hours status with today's hours, transit badge, organiser · sources · "da verificare".

**Days without hours** (user decision, 2026-11-15): when a source declares structured hours
for some days, the other days count as closed ("Chiuso ora · apre domani alle 15:15"; week
table "Chiuso"); a service without structured hours stays "Orario non disponibile".

### Helpinet v0.3 fields (2026-11-15)

From importer normalization v0.3 ([plan](../.scratch/taxonomy/v0.3-plan.md), task T3); older runs
render as before.

- **Overnight hours**: an interval ending before it starts crosses midnight ("19:00 – 08:00
  (del giorno dopo)") and counts as open in the evening and, from the previous day, until it
  closes; 00:00–23:59 reads "Aperto 24 ore". Equal start and end stay "da verificare".
- **Curated hours** (`hours.corrected_value`) are shown, with the source's own value as a
  warning (Ceccano Thursday).
- **Phones** link to the dialable `normalized` numbers ("0667105197/98" → two entries); a
  value the importer cannot read stays as text without a link.
- **Positions** of a same-group sibling at the same address are shown with their own label
  (`placement.status` `source_group_sibling`).
- **Data date**: "Dati del 9 maggio 2026 o precedenti" from `data_as_of`.
- **Merged services**: a record marked `merged_into` is hidden; the primary card lists each
  record's hours labelled by its own audience (e.g. "· Uomini", "· Donne"), unions contacts,
  access flags and prestazioni, warns about conflicting hours, and keeps `merged_from`.

### Cycle lanes

`POST /api/preview/cycleways` with `{west,south,east,north,zoom}` returns OpenStreetMap cycle
infrastructure in the viewport from zoom 12 (`app/backend/api/cycleways/network.py`, format
`../egi-importer/docs/cycleways-format.md`), drawn by `features/cycleways/layer.js` under its own
"Piste ciclabili" toggle: separated paths solid dark green, tracks dashed, lanes
light dashed, shared paths dotted, with a legend and ODbL attribution. No official
Rome dataset was found; the data is not verified by EGI.

### Trains

`.local/rail` (override `EGI_RAIL_ROOT`) is a second runtime in the same format,
built from Trenitalia's NeTEx; `transport.ROOTS` lists both and the `*_all` helpers
merge them (features, nearby lines, departures). Rail shows as mode `rail`: dashed
green lines by train category (REG, RV, FR, IC…), FS station markers from zoom 14,
"Stazione ferroviaria" groups in "Vicino a" (800 m), and the "Treni" checkbox. Only regional/metropolitan source categories are shown; origin departures and
stop popups prioritize destinations with trips left. Scheduled times only; no FL codes in the source.

### Metromare and Roma–Viterbo without times

`.local/osm-rail` (override `EGI_OSM_RAIL_ROOT`) adds OSM COTRAL routes/stations to
the existing rail layer and route focus, independently of timed-feed availability.
Stations appear from zoom 14; nearby-service rows use the 800 m rail radius.
Metromare, Roma–Viterbo urban and extraurban are explicitly `untimed`: cards and
popups explain that times are unavailable as open data, and popup opening does not
request departures. Current-day service is not verified. Source: © OpenStreetMap
contributors (ODbL 1.0), distinct from Trenitalia. Roma–Giardinetti is excluded
because no active route was available in the inspected OSM data.

Refresh manually from `egi-importer` with `python3 scripts/osm_rail.py poll`; no new
job is installed. See [the runtime contract](../egi-importer/docs/transport/osm-rail-format.md).
The Verify section covers independent runtime fixtures, source merging and the
popup lifecycle test that ensures untimed stops make no departures request.

### Source wording and operations (2026-11-08)

The transport panel distinguishes bus/tram realtime predictions, scheduled metro/
Trenitalia and untimed OSM rail. It retains the Roma licence uncertainty and now
explicitly identifies the unstated NAP NeTEx licence. See the dated
[source evidence and unsent clarification drafts](../egi-importer/docs/transport/source-licensing.md).
The approved operations bundle installed the daily rail job and pruned four old
derived Roma transport versions, preserving original captures and active data.
Actual verification and limits are in the shared
[operations record](../.scratch/post-handoff/operations-plan.md).

### Discovery revision (2026-11-09)

Filtri is shared across map/list and moves inline in the desktop list. Menu includes
Rubrica/emergencies. Cards place organization and opening state near the header;
unknown hours stay neutral, closing within 60 minutes is orange. Pins distinguish
single services, service-weighted multi sites and geographic clusters. See
[discovery UX and Nominatim configuration](docs/discovery-ux.md). Verification preview
for this change runs separately on `http://127.0.0.1:8002/map?city_id=1&lang=it`;
the existing 8001 server was left running after process-control approval was denied.

### Map sources (My Maps, 2026-11-09)

The three Google My Maps sources loaded by `egi-importer` (`python3 -m
egi_importer.mymaps`, see [its pipeline doc](../egi-importer/legacy/docs/mymaps-pipeline.md))
appear next to Helpinet. `subjects.py` reads the latest succeeded `normalize` run of
each `map_export` source and joins each service to its `location_candidate` from the
latest succeeded child `geocode` run; the cache probe covers all those run IDs.

- **Grouping:** `MAP_LAYER_GROUPS` in `app/backend/api/preview/projection.py` places each layer in a
  need group (GrIS → Curarmi; Scuolemigranti → Istruzione; Programma Integra by layer,
  adding the groups Istituzioni and Socialità). This is presentation only; the original
  layer is the service type and help topics are the listed themes.
- **Course sites (Scuolemigranti with sede pages, 2026-11-16):** `course_fields` in
  `preview.py` shows lessons by level (`hours_display.kind` "lessons"), CPIA secretariat
  hours ("office") or none; the map shows "Prossima lezione …" instead of an open/closed
  status (courses never count as "Aperti ora"), the enrolment wording, the page date with
  "dato da verificare" after 12 months, a summer-closure flag, and a "Livello del corso"
  filter under Istruzione (`course_levels` in the vocabulary). Scuolemigranti follows the
  structured taxonomy rule with three Istruzione offers (r2): Corsi di italiano (all sites;
  for CPIA whose page is silent the offer is marked derived), CPIA (the 48 CPIA) and Scuola e
  licenza media (only when stated). Lessons appear as a week table with levels as labels.
- **Migrant health (2026-11-16):** GrIS Lazio/SIMM is retired (`RETIRED_SOURCES`: kept in the
  database, not shown). STP/ENI offices and clinics come from the Regione Lazio lists
  (`regione-lazio-stp-eni`, `regione-lazio-ambulatori-stp-eni`), consultori from the Ministero
  with GrIS phones marked "da GrIS Lazio (dicembre 2024)"; all three use the structured taxonomy
  rule.
- **Contacts (all sources, r2):** rows with icon, value and kind (phones, e-mail, websites);
  website rows name their host. "Segnala errore" is a flag button next to the source chips.
- **Positions:** only non-ambiguous `matched_house`/`matched_street` candidates are map
  points, labelled as estimates from the address (Nominatim, © OpenStreetMap
  contributors). CAP-area, municipality-only, ambiguous and unresolved candidates are
  list-only ("Posizione da completare"), with the reason on the card.
- **Hours** stay the source's free text and never feed "Aperti ora".
- **Source filter** "Fonte" in Filtri; cards name the source, its declared update note
  and a link to the original map. `/benchmark` still measures Helpinet only.
- No cross-source deduplication: the same organization may appear once per source.
  No reuse licence is established for these maps, so they stay in the local preview.

### Services above transport; one-source debug view (2026-11-09)

Services are the primary layer. Marker clusters are opaque with a white halo, and the
transport panes are dimmed (lines 70 %, stops 85 %) except while a line is focused,
so transport stays secondary context under the services (panes: lines z 350, stops z 450,
services z 600).

`/map?debug=1` adds a "Debug fonti" panel for local position checks. Choosing a source
hides the normal markers and draws every position candidate of that source, unclustered:
green house, blue street, orange CAP area, red municipality only, purple source
coordinates, dashed black ring when ambiguous. Statuses can be toggled. An optional
line goes to the CAP centroid. Popups show the source address, OSM match, score,
alternatives, an OpenStreetMap link and the service card. Data comes from
`GET /api/preview/debug/sources` and `GET /api/preview/debug/positions?source=<code>`;
these include candidates the normal map hides.

### Service photos (removed 2026-11-09)

A photo module (organisation/user submissions, Street View on request, sensitive-service
exclusion) and a Mapillary test were built and then removed at the user's request; see
[feasibility](../.scratch/mapillary/feasibility.md). Git history keeps the code
(`05966e9`, `b7ddd53`).

### Filter counts (2026-11-09)

The Filtri sheet shows the number of services available ("1398 servizi disponibili", or
"N servizi su T con i filtri attivi"). Need tiles, service types, prestations, access
claims and sources show faceted counts: each value is counted under all the *other*
active filters (`facetCounts` / `passesFilters` in `features/search/index.js`), so a count is the number of
results that choosing that value would give. Values with no results are hidden from the
selects, and need tiles with no results are dimmed.

### Map sources after normalizer 0.3 (2026-11-09)

Cards follow the importer's classification
([pipeline](../egi-importer/legacy/docs/mymaps-pipeline.md#3b-classification-processor-030-legacyclassifypy)):

- Excluded records (state schools, courts) and secondary per-layer copies are hidden
  (`is_visible`). The preview now shows 1,199 services instead of 1,398.
- The need comes from the classification, and an entity can count in several needs
  (`needs`, used by the need filter).
- Service types are shared across sources.
- Access claims show their basis; derived ones are marked with *.
- GrIS hours that parse feed the weekly table and "Aperti ora".
- GrIS services at one address are grouped as one site.

Older payloads fall back to the `MAP_LAYER_GROUPS` crosswalk.

### Explicit position issues (2026-11-09)

Every card carries `placement.issue`. For map sources it comes from the importer's
geocoding strategy 0.3; Helpinet uses `no_coordinates` or `no_address`. Values:

| Issue | Card label | Map point? |
| --- | --- | --- |
| `ok` | position estimate | yes |
| `manual` | corrected by hand | yes |
| `ambiguous` | address with several matches | no |
| `postcode_area_only` | only the CAP found | no |
| `municipality_only` | only the municipality found | no |
| `no_street`, `no_street_unresolved` | address without a street | no |
| `unresolved` | address not found | no |
| `no_address` | source gives no address | no |
| `no_coordinates` | Helpinet without coordinates | no |

Named-place matches (`matched_poi`) are shown as map points too.

The Filtri sheet has a "Problema di posizione" select with faceted counts. The debug
view (`/map?debug=1`) colours named places and manual fixes. To fix a position, fill
`../egi-importer/curation/positions.csv` (the to-do list comes with every importer
run) and re-run geocoding.

Also fixed: "Scegli punto" threw `poi is not defined` (a stray line from `7978a00`).

### User decisions applied (2026-11-09, second round)

- **Basemap:** OSM tiles desaturated in CSS (`.leaflet-tile-pane` filter), as chosen
  from the r2 comparison.
- **Unplaced services:** services without a map point are no longer served
  (`is_placed` in `main.py`). Remote directory services are kept. `/map?debug=1` requests
  `include_unplaced=true` and shows the "Problema di posizione" filter for review.
- **Positions:** they come only from the address (importer rule); CAP-only and
  municipality-only results are never shown.
- **Freshness:** every card says how current the source declares itself to be. Declarations
  older than 18 months at acquisition are highlighted; Helpinet v0.3 shows an upper bound
  ("dati del 9 maggio 2026 o precedenti"); undated sources say the date is unknown. The banner reads "non sempre aggiornati". Data are imported as is, and
  reviewers enrich, clean, deduplicate and verify with the providers.

### Duplicate review page (2026-11-09)

`/revisione/doppioni` lists cross-source candidate pairs among all visible services,
placed or not (`app/backend/api/preview/review.py`, `GET /api/preview/review/overlaps`). Candidates
come from the same normalized address, a shared phone or email, or a 40 m grid. Each pair
gets a score from independent signals, shown as evidence:

| Signal | Points |
| --- | ---: |
| Same street and house number (abbreviations, CAP and articles normalized) | 3 |
| Same street, other or no number, within 150 m | 1 |
| Within 25 m / within 60 m | 2 / 1 |
| Shared phone or shared email (each) | 3 |
| Shared contact that a source lists for 3+ of its places (the organisation's) | 1 |
| Shared website domain (generic hosts excluded) | 1 |
| Same or equivalent service type / same need / different needs | 2 / 1 / −2 |
| Name similarity ≥ 0.5 / ≥ 0.25 ("CAV" read as "centro antiviolenza"; generic words ignored); shared quoted name | 2 / 1; 2 |

| Tier | Score |
| --- | --- |
| A, very likely | 8 or more |
| B, likely | 6–7 |
| C, to assess | 4–5 |
| D, neighbours only | same address or within 25 m; off by default |

A/B pairs of the same (or equivalent) type form **groups**: one service described by
several sources (the Colle Oppio canteen is in five). Different services at one address
stay pairs, so they never chain into one group. Filters: tier, still open, groups with
3+ sources, one source. "Confronta tutto il gruppo" shows every member side by side
and can mark all its A/B pairs as the same service.

Each pair shows a map with A and B, and the two records side by side with differing
cells highlighted. The answers are: same service, same place but different services,
different, or not sure; keys 1/2/3/0, with J/K to move between pairs. Answers stay in the
browser (localStorage), and "Copia decisioni" gives text to paste to the curator, who
records it in `egi-importer/curation/matches.csv`.

Nothing is merged. The existing schema already models identity resolution
(`governance.match_candidates`, `resolution_decisions`, `subject_bindings`), but against
canonical `data.entities`, which is a separately approved step. Until then, decisions are
review evidence only, so no schema change is needed.

### Official consultori source (2026-11-09)

The app also reads `open_data` sources. The first is the Ministry of Health consultori list
(`ministero-salute-consultori`, shown as "Ministero della Salute"): 126 of 158 Lazio
consultori placed from the address, under IODL 2.0. Its pairs with GrIS and Programma
Integra appear on `/revisione/doppioni` (fascia A: 91 pairs), which pilots the consultori
deduplication.

### Web pages and guide sources (2026-11-09)

The app also reads `web_pages` and `document` sources from the importer:

| Source | Shown as | Shown services | Notes |
| --- | --- | ---: | --- |
| `1522` | 1522 Antiviolenza | 38 of 48 | Lazio centres; source update 27/10/2026; access hints from the definition of an anti-violence centre (marked as derived) |
| `caritas-roma` | Caritas Roma | 42 of 56 | 7 "Servizi e opere" pages |
| `roma-solidarieta` | Roma Solidarietà | 20 of 33 | the cooperative that runs most Caritas structures; hours and how to get there |
| `sant-egidio` | Sant'Egidio · DOVE 2026 | 652 of 771 | nine chapters of the printed guide (PDF pp. 9–202), one dataset each; telephone lines in the directory; printed audience/access/heading organizations and scoped hours from the reviewed egi_sources payload (`source_facts`); confirmed duplicate (Oratorio) shown once |

Services without an address-based position stay hidden from the map and list, as for the
other sources (`?debug=1` shows them).

## Offline favorites

Canonical service sheets and service-list rows share a **bookmark icon**: outlined
when absent, accent-filled when saved. The accessible label describes add/remove
and identifies the service. Both controls reflect the same committed local state;
the list bookmark never opens the service sheet. The map menu uses the same icon
and opens **Favorites inside the existing map/list shell**, with **All services**
to return. Saved cards absent from the loaded catalog, including scrubbed unavailable
entries, remain represented. `/preferiti` is the offline reopening route of the same
app/PWA feature; the online menu does not navigate to a separate screen.
Favorites contain public card details, saved language, original save time and last
successful update time. They live only in this browser profile and site origin;
clearing site data deletes them. Use the same loopback host and port every time.

The first successful save prepares the offline interface and writes the card to
IndexedDB. Only after both operations succeed does the UI report offline readiness.
A failed save reports the failure without deleting existing favorites. Browser
storage can be denied, exhausted or evicted; this is not a backup or cloud sync.

Opening favorites online, reconnecting while the page is open or pressing Refresh
updates each saved UUID through the existing public detail endpoint, with at most
three requests in flight. Network and server failures retain the previous copy and
its timestamp. A confirmed 404 removes all old service details and retains an
unavailable entry that the visitor may remove; later republication can restore it.
Saved schedules remain readable but no stored opening status is displayed as live.

`features/favorites/store.js` owns the public-field projection, versioned local
storage and refresh rules. `controls.js` owns shared bookmark rendering and click
handling; its delegated listener serves both list and detail, and never shows a
successful selection before storage commits. The SVG symbol at
`assets/icons/ui/bookmark.svg` is also used by the menu and offline view.
`offline.js` owns shell installation/readiness.
`/preferiti/sw.js` has scope `/preferiti` and caches only its explicit public shell
allowlist. It never caches API responses, authentication/moderation pages, map tiles
or transport. When changing its shell dependencies, update the allowlist and bump
its cache version in the same change. `pages/favorites.js` renders saved cards using
the existing service presentation module and the four current UI dictionaries.
The standalone page uses system fonts so offline setup does not download map fonts.

Desktop, Android and iOS are target platforms, using native IndexedDB, Service
Worker and Cache Storage. HTTPS is needed away from loopback development. Installing
a PWA is not required. Initial verification is on the local desktop only; responsive
viewport checks do not establish Android/iOS device acceptance.

Focused checks (in addition to the existing suites):

```sh
node --experimental-vm-modules tests/test_favorites.cjs
python -m unittest discover -s tests -p test_favorites_http.py -v
```

The approved specification and session execution record are in
[Linear](https://linear.app/aquaradja/document/offline-favorites-specification-r01-for-approval-bf2e797fc6fb).
The user approved implementation in one session and explicitly skipped tickets on
2026-11-27. Code remains on the dedicated local worktree; commit/push/PR/merge and
deployment were not granted by that exception.

See [local favorites verification](docs/offline-favorites-verification.md) for the
actual desktop journey, measurements, independent review and mobile-testing limits.

### Text accessibility

The menu's Aa row provides text zoom from 100% to 200% in 10% steps. Reset appears
before the minus control only away from the default. The preference is stored in
localStorage on this browser/device and shared with the offline favorites page;
if storage is denied, the control remains usable for the current visit. Authored
interface text scales through rem units, while map geometry and marker icons retain
their size. The preview banner is measured again as text wraps.

This addition was authorized directly by the user on 2026-11-27, without a new
specification or tickets. Verification on the changed worktree: 142 Python tests
passed (13 configured skips), all 10 JavaScript suites passed, including
`tests/test_text_zoom.cjs` for bounds, restoration, reset/focus, cross-tab updates
and unavailable storage. In the native desktop preview, 110% changed the menu label
from 15px to 16.5px, 200% survived reload, and Reset restored 100%. At a 390×844
viewport and 200%, the accessibility row had no horizontal overflow and the controls
wrapped to the right in Reset/minus/plus order. Physical Android/iOS checks remain
outstanding; viewport emulation does not establish device acceptance.

The map menu groups Favorites under Preferences, with the same icon/title/subtitle
layout as adjacent settings and the localized subtitle “Salvati sul tuo dispositivo”.

### Named local collections

The Preferences bookmark opens the in-app “Preferiti e liste” sheet. It groups saved places by Favorites and named collection, with map and print actions and an inline new-list form. `/preferiti/liste` remains an offline fallback, not an app-menu destination. Visitors
can create, select, rename and delete named collections (1–80 characters), add a
service from either a result row or detail header, and remove individual members.
The dedicated offline favorites page also offers “Aggiungi a una lista”. A service
may belong to several collections independently of its quick bookmark. Removing a
bookmark, a member or a collection does not remove copies from other collections.

Collections reuse the existing IndexedDB object store with a separate territory
namespace and one atomic document per collection; there is no database upgrade or
server-side collection API. Each membership reuses the public snapshot projection,
refresh/withdrawal rules and compare-token protection. An existing membership is
not overwritten by re-adding an old saved favorite. A copy added offline retains
its original update timestamp. Creating a collection prepares the complete shell;
an already installed shell remains usable when a worker update fails offline.
The dedicated worker also caches `/preferiti/liste`; map/API caching remains excluded.

“Stampa / salva PDF” prints only the selected collection, with expanded public
information, schedules, contacts, sources and copy timestamps. Native browser
printing preserves Unicode layout and requires no PDF dependency or upload. Choose
“Save as PDF” in the print dialog; the app does not claim to have saved a file.
The native dialog and available PDF destinations depend on the browser/device.
See [printing](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing)
and [paged CSS](https://www.w3.org/TR/css-page-3/).

See [collections verification](docs/local-collections-verification.md) for actual
checks and remaining device/PDF validation. The user authorized this direct
implementation on 2026-11-27; no tickets, server sync, operator accounts, dependency
installation, publication or merge were added.

User UX correction (2026-11-27): the map app stays at `/map`; saving and collection
management use its existing panel system. One bookmark opens the destination dialog
and is selected if the POI belongs to any list. A POI may belong to multiple lists;
removal is scoped to one membership. “Vista su mappa” filters to that group, with a
visible “Tutti i servizi” exit. See the updated collection verification record.

Saved-group rows use the same `renderListItem` renderer as the service results,
including category, title, service type, address, opening information, transport
badge when available, attribution and the shared bookmark. Live public catalog
entries are reused when present; fallback snapshots retain their copy timestamp
and unknown current-opening status. The filtered map has a persistent collection
name plus “Torna alle liste” and “Tutti i servizi”; the list view also offers a
direct return to the grouped panel.

Private Community preparation JSON/raw-text endpoints are documented in
[preparation HTTP](docs/community/preparation-http.md). They reuse editorial
sessions and require database changes 014–020; they do not enable CSV or real AI
calls by themselves.

The Community [card/field editor](docs/community/preparation-editor.md) is available
at `/moderazione/contribuisci` in editorial mode. Its private drafts, sharing,
recoverable trash and conflict recovery use the preparation HTTP contracts.
Source and card are adjacent; the card and field-list presentations share one draft.
For the changed client modules, run `node --experimental-vm-modules` with each of
`tests/test_preparation_draft.cjs`, `tests/test_preparation_analysis.cjs`,
`tests/test_preparation_evidence.cjs` and `tests/test_community_acceptance.cjs`.

The separate [Community interpretation worker](docs/community/interpretation-worker.md)
uses the hash-pinned Reviewer wheel and the existing httpx stack. Install its
`requirements-community.lock.txt` before running the full Community test suite.
No real model, price, worker login or live dispatch is enabled automatically.

[Interpretation selection](docs/community/interpretation-editor.md) connects first
public insertion and explicit updates to durable jobs, with selected card creation
and preservation of manual/cleared fields. A configured worker/model is still required.

[Community submission and review](docs/community/submission-review.md) connects
confirmed private cards to selective queue snapshots and editable acceptance into
canonical drafts. Source admission and the existing approve/publish action remain
separate. Database change 021 preserves component proof across collection edits.
Change 022 keeps selected proof in the correct contact/address/schedule context.
