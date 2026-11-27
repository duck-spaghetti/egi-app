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

The optional 3D mode of the map reads the 3D data set built by
`../egi-importer/scripts/map3d.py` (format in `../egi-importer/docs/map3d/`). `EGI_MAP3D_ROOT`
(default `.local/map3d` in the workspace) is its runtime root: the app reads
`active.json` and serves only the active version's listed files at
`/map3d/<version>/<path>`, with HTTP Range (PMTiles) and a one-year immutable cache;
`/map3d/active` reports availability. A missing or invalid active version disables the
3D mode; the current map is unaffected. The "3D" map control reloads the page with
`?vista=3d` (back with `?vista=2d`); without WebGL2 or an active version it is disabled
and explains why. Filters, search text and reference point cross the switch in
sessionStorage only. While moving the 3D map, the page measures frames per second (and JS
memory where the browser reports it); below 30 fps or above 150 MB over three moves, the 3D
control shows a warning and a one-time message, and stays usable.

For native verification set `EGI_DATABASE_REPO` to the explicit database worktree,
`EGI_SQITCH` to Sqitch and, if necessary, `PERL5LIB` to its local runtime library.
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
- **Local assets.** Leaflet 1.9.4, Leaflet.markercluster 1.5.3, MapLibre GL JS 6.19.0
  (ES module and worker, BSD-3-Clause), the PMTiles reader 4.3.0 (BSD-3-Clause, licence
  stated in its `package.json`; loaded only by the 3D mode) and the Fraunces/IBM
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

## Setup and start

Use the selected existing FastAPI/Jinja2/Uvicorn stack in a dedicated `.venv`.
The user confirmed this stack on 2026-11-08; exact installed versions are in requirements.lock.txt. No SQLAlchemy,
GeoAlchemy, Django, LLM, geocoder or Python DB driver is needed for this preview.

To reproduce the approved environment, from this directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
# test-only: httpx for FastAPI's in-process TestClient
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

## Live vehicle positions (M2, local 3D mode)

`POST /api/preview/transit/vehicles` reads `<EGI_TRANSPORT_ROOT>/realtime/vehicles.json`
(`egi-vehicles/1`, provided by the importer). JSON body: `west`, `south`, `east`,
`north`, optional `lines` (up to 80 line codes, each at most 32 characters).
The viewport must lie within the configured search extent and be no wider or
higher than 0.15 degrees. The response includes `availability`, `stale`,
`feed_timestamp`, server `now`, compact `vehicles` with vehicle `age` in seconds
(or null), `licence: CC BY-SA` and `attribution: Roma Mobilità`.
Both acquisition and publisher timestamps must be within 180 seconds; a stale
snapshot returns no vehicles. Missing/corrupt snapshots are unavailable. The
endpoint reads files only, never calls a database or upstream feed, retains no
request state and puts area/line selections only in the POST body, never the URL.
Access logging remains disabled and responses use `Cache-Control: no-store`.
The assumed vehicle licence/version must be re-verified before launch.

### Indicative walking routes

A located service's sheet offers **Get directions**, with a choice of Google Maps
or the in-app walking route. The latter uses 3D; choosing it from the flat map
carries the service/reference into 3D in this tab. Without a reference point it opens
the existing reference-choice flow, then continues the requested walk. Routing reads z15 roads from
the active local basemap, excludes highways/rail/ferries, repairs simplified tile
junctions and limits straight-line distance to 3 km. Snapping to the main connected
network is capped at 100 m; absent coverage yields an explicit no-route message.
The device computes distance and time at 4.5 km/h. This is an indicative route,
without verified crossings, stairs/accessibility or turn-by-turn instructions.
The camera shows the whole route top-down, oriented from start at the bottom,
then paints the line. Reduced motion shows it immediately; Escape cancels and
clears it. Reference points stay on the device, never in a request to a router.
Vendored vector-tile 2.0.3, pbf 4.0.1 and vector-tile's required point-geometry
1.1.0 are checked against npm SHA512 and the vendor manifest's file SHA256.
The vector-tile bare point-geometry import alone is rewritten to a relative import.

### Live buses in 3D

The keyboard-operable **Live buses** control is inside **Layers**, off initially. It polls the local
vehicles endpoint every 20 seconds only while enabled, the page is visible and
MapLibre zoom is at least 15. Area/line selections travel only in POST bodies.
Comma-separated line codes restrict the viewed area. Vehicles use deliberately enlarged 18 × 4 × 4.8 m
yellow map symbols, oriented by supplied bearing or observed movement; labels start at
zoom 16. Snapshots interpolate for one second without extrapolation. Reduced motion
updates immediately. Positions older than 120 seconds (or with unknown age) fade;
a feed older than 180 seconds is cleared and announced, including while waiting
for a slow response. Turning off, hiding the page and disposal cancel requests and
timers. Unchanged geometry is not resubmitted, and fresh buses remain visible during
a viewport refresh. Roma Mobilità / CC BY-SA remains in the map attribution.

M2 remains a local candidate: the user deferred Catalan support and legal-notice
updates; those five-language/notice criteria are explicitly unsatisfied. M1 phone
acceptance remains pending. This feature does not install offline/PWA caching;
walking works on locally available basemap tiles and never calls an external router.

### Local M2 map review

3D starts at 45° pitch. Layers and the view switch share a toolbar. Screen-space
clusters merge neighbours across cells, with translucent teal symbols sized and
shaded by site count. At z14 service pins gain ground stems and an integrated label with name, category
icons and existing opening-status text/dots, when space permits. Clusters end at z15.
For sites with one category the label shows the card's service type below the
name instead of repeating the category icon. Sites with multiple categories show
every category; categories outside active filters are dimmed. Labels avoid one another and other service buttons, and can extend to either
side of the anchor. Unknown, course and unverified hours
retain their existing meaning. Category icons share a stroke style (plain shield,
compass, graduation cap and briefcase); Orientation has a short UI label. Stored
source taxonomy and the 2D map behavior remain unchanged.

The 3D renderer caches service presentation between camera moves and mounts only
sites near the viewport, with a 120 px edge margin. Opening a detail from Map mode
automatically centres its point (3D also sets z17.5 and tilt); List mode leaves the
camera alone. There is no separate building-focus action. Opening-calendar day labels
are left-aligned and only the current day in the territory timezone is bold. Category
SVG ink is dark by default; coloured badges/pins and active filters apply white ink.

Local browser comparison on 594 service records at the same centre/z17: marker
redraw median 66 ms → 0.1 ms, mounted markers 365 → 4; the 1.6-second movement probe
reported 41 → 60 fps. This is a desktop preview measurement, not phone acceptance.

Directions are available in app only for finite public coordinates; address-only
services keep Google's address fallback. Changing the selected target cancels both
a pending reference intent and an in-flight route. Explicit cancellation also drops
the intent. Cached legacy opening labels and current-day calendar emphasis refresh
on the existing 30-second timer and when the page becomes visible. Narrow labels
wrap the status qualification, adapt their width and avoid the map toolbar.

Transport stop/station names are optional annotations shared by flat and 3D maps.
Station names start at Leaflet-equivalent z16 (3D uses one zoom level less);
highlighted nearby stations may be named earlier. Bus/tram names and extra
information are click-only at every zoom, including nearby highlighted stops.
Focused stations take priority. Names try either side, above/below and a narrower width;
they are suppressed when they cannot fit around other stop symbols/line-code
boxes, names, service heads, controls or open popups. Full names remain in the
existing accessible/title text and departure popup. Raster/canvas basemap text
is outside this DOM collision planner. Labels update after settled camera changes,
resize/data refresh, with one owned animation-frame callback for DOM positioning;
there are no per-frame rebuilds or additional feed/network requests.


Close transport points: at Leaflet-equivalent z18 (MapLibre z17), metro overview
centroids give way to the original individual GTFS coordinates/IDs. A short stem
and ground dot tie station symbols to the source position. Bus/tram keep their
existing source coordinates and gain this ground-anchor detail only one zoom
closer, at Leaflet19 / MapLibre18. Farther views keep the compact drawing. There
is no artificial spiderfy/displacement; coincident source points remain coincident.
The dot is a source position, not a verified entrance or platform-access point;
NeTEx/OSM station-only data do not gain invented detail. Names avoid the combined
symbol/stem/foot footprint. The 3D equivalent zoom is capped at the existing API
maximum19, so maximum camera zoom remains usable. Timetables and nearby summaries
keep their existing source-stop memberships. No importer/runtime format changes.


Close bus/tram stops now use light CSS paline inspired by Roman stop signs:
yellow boards, red caps and a mode glyph, with no automatic names or route text.
Metro uses a red square M sign. Signs replace compact symbols only at the existing
point-detail thresholds (Leaflet18 metro /19 bus-tram; MapLibre17 /18). Rail keeps
its previous symbol. The pole ends at the unchanged source coordinate; it does not
assert that the source point is a street entrance. No model/texture/network loading.

Service opening labels now include known closing boundaries even more than an hour
ahead, and next opening when the canonical transition explicitly leads to open.
Civil-day text distinguishes today, tomorrow and later dates in the schedule timezone.
Unknown transitions, missing/invalid boundaries and uninterrupted24h hours do not
invent a time. Opening-status text omits the verification qualifier per user choice; provenance
notes and other verification controls remain in the card. Timed invalidation remains.
Signs crossfade from the compact symbol over one continuous zoom level, starting
at the point-detail threshold. Size grows with map scale from32% to a65% cap
(~42px including pole). Zoom writes four CSS variables on the map container, with
no geometry reads, marker rebuilds or requests; reduced-motion skips transitions.
Opening date/time formatters are cached by schedule timezone.

Leaflet reaches its maximum at19: bus/tram signs appear there with an opacity
entry transition at the initial small scale. MapLibre continues its proportional
zoom ramp. Name bounds include both fading branches; scale geometry changes
without an extra transform transition so collision geometry stays current.


3D transit reloads now reconcile marker IDs, retaining unchanged stop/route-label
DOM and event handlers. Only changed markup/coordinates update; missing IDs are
removed. Existing popup holding remains in force. Optional station-name nodes
are reused (and reattached after changed glyph markup), and identical network
line data is not resent to the renderer worker. This prevents the close-sign
entry fade restarting on unchanged viewport reloads. Native3D paline now replace physical HTML signs in the3D view; source coordinates
are not moved to fake sidewalks.


Native3D stop signs use one GeoJSON source/two existing-renderer extrusion layers:
pole base0m, board2.05–2.7m, schematic two-faced metro/bus/tram glyphs. Geometry is
prepared onezoom before close appearance (metro17→18,road18→19), grows naturally
with camera scale and uses scene depth. No model/texture dependency. Source maxzoom22
and tolerance0 retain small prisms; productcamera max19/APIcap19 unchanged.
At max19 the physical signs are intentionally small. Orientation is schematic;
the feed does not provide a sign heading or certified sidewalk/access position.
Compact symbols/keyboard buttons persist, with pointer picking on visible native
geometry and foreground extrusion intersections blocking hidden selections.
Reference selection takes precedence. Rail and Leaflet drawing are unchanged.

Close3D service heads try stable offsets up to96px while their feet remain at the
original source coordinates. Inclined SVG leaders connect each displaced head to
its own foot. Exact co-location grouping stays unchanged. Head placement uses a
small screen-space grid, prioritises the selected site and avoids other heads/feet
and maincontrols; optional labels use the displaced positions. In saturated views
with no bounded slot every site remains reachable, but overlap cannot be ruled out.


Native sign legibility refinement: all prism dimensions are multiplied by1.6
(4.32m maximum height), intentionally schematic. The source-centred base remains0.
The shared eased fade spans1.5zoom levels (metro16.5–18,road17.5–19); native paint
and compact-symbol opacity use the same stops, with a slower onset/completion.
Compact wrappers exist at every zoom, avoiding markup replacement at the fade or
point-detail thresholds. Geometry is still cached; source counts/topology unchanged.
