# EGI app v0.2 — local preview

Recovered frontend from the original egi-app draft at
`c090950874a8c5ac39c83f9ba2aa1ae06356af84`, adapted to the current database's source
evidence. The original checkout is untouched. Map/list, source-need filters, service
details and Italian/English/French/Arabic UI catalogs are retained.

This is a local preview of unreviewed Helpinet data, not the approved public directory.
Routes use `/api/preview`. No canonical entity, editorial approval or publication is
created. Blank descriptions remain blank; source hours have a separately labelled preview status; coordinates are source claims. Missing coordinates stay in the list.

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
python3 scripts/load_preview.py --preview
python3 scripts/load_preview.py
```

Select `--input` for another validated normalized bundle. Source/record IDs are
reused; repeated content is not duplicated. A new capture or interpretation preserves
history. The loader commits its complete import unit or rolls back. Imported source
subjects remain separate from canonical publication.

The app reads the latest succeeded normalization for the selected Helpinet dataset
through `app/backend/subjects.py`. The snapshot is cached in-process: for 60 seconds
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
```

With the app running, the live HTTP tests against the real preview database run too:

```sh
EGI_APP_BASE_URL=http://127.0.0.1:8000 .venv/bin/python -m unittest discover -s tests -v
```

Database-backed loader tests run separately under egi-importer with EGI_TEST_DSN
pointing specifically to the dedicated egi_import_contract database. Recorded evidence
and the scope are in [v0.1 plan](docs/v01-plan.md).

## Limits

The local preview now has an optional bus/metro layer under Cerca → Layer.
Enable Trasporti and select Metro/Autobus independently. Metro routes show at all
zooms, bus routes from zoom 13, metro points from 13 and bus points from 14.
Points remain the feed's native directional stops, not deduplicated stations.
Popup route membership follows the selected modes and today's service calendar.

`/api/preview/transport` reads the sibling workspace `.local/transport` files;
`EGI_TRANSPORT_ROOT` can explicitly select another runtime directory at startup.
Only `load_active` in `app/backend/transport.py` knows that layout; it follows
`../egi-importer/docs/transport-format.md`. Tests use the vendored example in
`tests/fixtures/transport-root` and, when the importer sits alongside, check that
the copy still matches the producer's.
Parameters: west/south/east/north (WGS84 bbox), zoom (0–19), modes (`metro,bus`,
`metro` or `bus`). It returns GeoJSON plus active-version and refresh metadata.
Bounding boxes select intersecting route shapes; full source shapes are retained.
Bus geometry is suppressed below zoom 13, and points follow the above thresholds.
The browser debounces viewport requests, cancels old requests and rechecks every
minute. That refresh only reads local files; the importer checks upstream every
six hours independently via launchd. Missing/expired transport is explicit and
never prevents Helpinet loading. Failed fetches retain the last valid version.

This is scheduled service with source attribution and a visible licensing
discrepancy, not realtime arrivals or approved public data. No DB grant or schema
change. See sibling [importer instructions](../egi-importer/README.md) and
[execution evidence](../egi-importer/docs/tpl-execution.md).

- Category groups are Helpinet's native needs for browsing, not an adopted EGI taxonomy.
- Existing itinerant positions are flagged, not treated as verified fixed delivery sites.
- UI catalogs are recovered; service content remains source-original Italian with no
  fabricated translations. Preview labels currently use Italian.
- Leaflet/cluster libraries and fonts retain the original external providers; map tiles use the standard OpenStreetMap endpoint with visible attribution;
  network access is needed for the basemap. No offline map is claimed.
- Contribution forms, original CRUD routers, editorial matching and public export are
  not connected. No hosting, Git initialization, commit or remote setup is performed.

## Historical v0.1 verification — 2026-11-08

The app is running on http://127.0.0.1:8000. Three live HTTP checks and JavaScript
helper checks passed. A browser walkthrough confirmed the 315-result list, a source
UUID detail, the 46-result native cibo filter and restoration of all services.
No console errors/warnings were observed in the checked tab. The original CARTO
basemap showed an API-key placeholder, so the preview uses standard OpenStreetMap
tiles and its required attribution. Initial zoom now frames Rome.

See [execution evidence](docs/v01-execution.md) and [verification](docs/v01-verification.json).

## Service preview v0.2

One service per card, provisional related services from the native parent, deterministic evidence-linked summaries distinct from empty original descriptions, positive access claims, readable unknown-aware hours, native need/type/prestation filters, local category icons and explicit reference-point distance ordering are now available. Missing-point physical services remain listed; Rubrica requires explicit remote delivery. Inspect `/benchmark` for field-by-field coverage. New preview copy is Italian.

Use `python3 scripts/load_preview.py --input runs/helpinet-02/normalized/bundle.json` from egi-importer to repeat the delivered v0.2 load. The script's historical default still selects v0.1; select `--input` explicitly. See [v0.2 plan](docs/v02-plan.md) and [execution evidence](docs/v02-execution.md) for reproduction, acceptance and limits. Current verification: 15 importer tests, 9 app tests, Node checks and browser walkthrough passed.

## Cross-category POIs and source opening status

The subsequent UI refinement integrates the discovery controls, shows every colocated service category on source-site markers, puts icons inside category badges and exposes source-derived opening/countdown status in detail and list. Phone/email labels use explicit labels or original contact values. The status is an ephemeral Europe/Rome calculation with source uncertainty; missing days never imply closure. See [refinement execution](docs/ui-refinement-execution.md) for rules and current verification.

The discovery panel also offers **Aperti ora**, combining with existing filters in map/list and refreshing membership with the source opening status. Unknown or ambiguous hours are excluded while active. See [open-now checks](docs/open-now-execution.md).
