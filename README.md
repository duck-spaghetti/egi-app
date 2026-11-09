# EGI app v0.2 — local preview

Recovered frontend from the original egi-app draft at
`c090950874a8c5ac39c83f9ba2aa1ae06356af84`, adapted to the current database's source
evidence. The original checkout is untouched. Map/list, source-need filters, service
details and Italian/English/French/Arabic UI catalogs are retained.

This is a local preview of unreviewed Helpinet and map-export data (GrIS Lazio,
Scuolemigranti, Programma Integra), not the approved public directory.
Routes use `/api/preview`. No canonical entity, editorial approval or publication is
created. Blank descriptions remain blank; source hours have a separately labelled preview status; coordinates are source claims. Missing coordinates stay in the list.

Local Git uses `main`, without a remote, under the approved consolidation workflow.
Current task/approval and dated verification evidence are indexed in the workspace
[tracker guide](../docs/agents/issue-tracker.md) and
[post-handoff plan](../.scratch/post-handoff/plan.md). The original draft is reference
history; production/editorial integration is a separate scope.

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
.venv/bin/python -m uvicorn app.backend.main:app --host 127.0.0.1 --port 8001
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
and for every `map_export` source, through `app/backend/subjects.py` (see
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
node tests/test_map.cjs
node tests/test_transport_layer.cjs
```

With the app running, the live HTTP tests against the real preview database run too:

```sh
EGI_APP_BASE_URL=http://127.0.0.1:8000 .venv/bin/python -m unittest discover -s tests -v
```

Use the serving port (for example 8001) in `EGI_APP_BASE_URL`. For changed JavaScript,
run `node --check` on the affected files. Last recorded suite/browser results are
in the post-handoff plan; commands here do not claim a currently running server or
a fresh passing test result. TestClient's httpx deprecation is known; the user
selected retaining the existing test-only dependency.

Database-backed loader tests run separately under egi-importer with EGI_TEST_DSN
pointing specifically to the dedicated egi_import_contract database. Recorded evidence
and the scope are in [v0.1 plan](docs/v01-plan.md).

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
Only `load_active` in `app/backend/transport.py` knows that layout; it follows
`../egi-importer/docs/transport-format.md`. Tests use the vendored example in
`tests/fixtures/transport-root` and, when the importer sits alongside, check that
the copy still matches the producer's.
Parameters: west/south/east/north (WGS84 bbox), zoom (0–19), modes (any of
`metro`, `rail`, `tram`, `bus`, comma-separated). It returns GeoJSON plus active-version and refresh metadata.
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
in `app/backend/transit_nearby.py` and `app/backend/osm_rail.py`; unavailable or
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

`app/backend/departures.py` reads the active version's `departures.sqlite`
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
[execution evidence](../egi-importer/docs/tpl-execution.md).

- Category groups are Helpinet's native needs for browsing, not an adopted EGI taxonomy.
  Map layers join these groups through a presentation crosswalk (`MAP_LAYER_GROUPS`).
- Existing itinerant positions are flagged, not treated as verified fixed delivery sites.
- UI catalogs are recovered; service content remains source-original Italian with no
  fabricated translations. Preview labels currently use Italian.
- Leaflet/cluster libraries and fonts retain the original external providers; map tiles use the standard OpenStreetMap endpoint with visible attribution;
  network access is needed for the basemap. No offline map is claimed.
- Contribution forms, original CRUD routers, editorial matching and public export are
  not connected. Local Git history now exists; hosting and remote delivery remain
  separately scoped.

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

### Cycle lanes

`GET /api/preview/cycleways?west&south&east&north&zoom` returns OpenStreetMap cycle
infrastructure in the viewport from zoom 12 (`app/backend/cycleways.py`, format
`../egi-importer/docs/cycleways-format.md`), drawn by `cycle-layer.js` under its own
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
job is installed. See [the runtime contract](../egi-importer/docs/osm-rail-format.md).
The Verify section covers independent runtime fixtures, source merging and the
popup lifecycle test that ensures untimed stops make no departures request.

### Source wording and operations (2026-11-08)

The transport panel distinguishes bus/tram realtime predictions, scheduled metro/
Trenitalia and untimed OSM rail. It retains the Roma licence uncertainty and now
explicitly identifies the unstated NAP NeTEx licence. See the dated
[source evidence and unsent clarification drafts](../egi-importer/docs/source-licensing.md).
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
egi_importer.mymaps`, see [its pipeline doc](../egi-importer/docs/mymaps-pipeline.md))
appear next to Helpinet. `subjects.py` reads the latest succeeded `normalize` run of
each `map_export` source and joins each service to its `location_candidate` from the
latest succeeded child `geocode` run; the cache probe covers all those run IDs.

- **Grouping:** `MAP_LAYER_GROUPS` in `app/backend/preview.py` places each layer in a
  need group (GrIS → Curarmi; Scuolemigranti → Istruzione; Programma Integra by layer,
  adding the groups Istituzioni and Socialità). This is presentation only; the original
  layer is the service type and help topics are the listed themes.
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
(`f8cce40`, `36d7f9c`).

### Filter counts (2026-11-09)

The Filtri sheet shows the number of services available ("1398 servizi disponibili", or
"N servizi su T con i filtri attivi"). Need tiles, service types, prestations, access
claims and sources show faceted counts: each value is counted under all the *other*
active filters (`facetCounts` / `passesFilters` in `map.js`), so a count is the number of
results that choosing that value would give. Values with no results are hidden from the
selects, and need tiles with no results are dimmed.

### Map sources after normalizer 0.3 (2026-11-09)

Cards follow the importer's classification
([pipeline](../egi-importer/docs/mymaps-pipeline.md#3b-classification-processor-030-egi_importerclassifypy)):

- Excluded records (state schools, courts) and secondary per-layer copies are hidden
  (`is_visible`). The preview now shows 1,199 services instead of 1,398.
- The need comes from the classification, and an entity can count in several needs
  (`needs`, used by the need filter).
- Service types are shared across sources.
- Access claims show their basis; derived ones are marked with *.
- GrIS hours that parse feed the weekly table and "Aperti ora".
- GrIS services at one address are grouped as one site.

Older payloads fall back to the `MAP_LAYER_GROUPS` crosswalk.
