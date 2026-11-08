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

The local preview has an optional metro/tram/bus layer under Cerca → Layer, drawn
by `app/frontend/static/js/transport-layer.js` (the only transport code on the map
page). Enable Trasporti and select Metro/Tram/Autobus independently. Metro routes
show at all zooms in their official colours, tram routes from zoom 12, thin muted
bus routes from 13; metro stations from 13, tram and bus stops from 14, always above
the lines. Same-named metro platforms within 150 m are shown as one station marker
("M A B B1" at Termini) listing every source `stop_id`; this is display grouping,
not deduplication. Bus and tram stops stay the feed's directional stops. A legend
sits under the toggle. No request is sent while the map has no size.

`/api/preview/transport` reads the sibling workspace `.local/transport` files;
`EGI_TRANSPORT_ROOT` can explicitly select another runtime directory at startup.
Only `load_active` in `app/backend/transport.py` knows that layout; it follows
`../egi-importer/docs/transport-format.md`. Tests use the vendored example in
`tests/fixtures/transport-root` and, when the importer sits alongside, check that
the copy still matches the producer's.
Parameters: west/south/east/north (WGS84 bbox), zoom (0–19), modes (any of
`metro`, `tram`, `bus`, comma-separated). It returns GeoJSON plus active-version and refresh metadata.
Bounding boxes select intersecting route shapes. Below zoom 17 the response uses the
importer's simplified levels (50 m from zoom 11, 12 m from 13, 3 m from 15); full
source shapes from zoom 17. Responses over 1 KB are gzip-compressed (level 5).
Bus geometry is suppressed below zoom 13, and points follow the above thresholds.
The browser debounces viewport requests, cancels old requests and rechecks every
minute. That refresh only reads local files; the importer checks upstream every
six hours independently via launchd. Missing/expired transport is explicit and
never prevents Helpinet loading. Failed fetches retain the last valid version. When no poll
attempt was recorded for 24 hours the response sets `refresh_stale` and the map
asks to check the update job.

### Nearby transit ("Vicino a")

`GET /api/preview/transit/places` returns, for every located place, the nearest
metro line, the nearest daytime bus line and the number of lines; the list shows it
as a compact badge. `GET /api/preview/transit/places/{place_id}` returns every line
running today with a stop within 500 m (metro 800 m): one row per line at its
nearest stop, metro first, night lines (`n…`) last. Walking time is an estimate:
straight-line distance × 1.3 at 4 km/h, rounded up, and the card says so. The
service card shows five rows and "Altre N linee". No badge for itinerant services,
remote/directory services or services without coordinates. Logic and constants are
in `app/backend/transit_nearby.py`; transport unavailable or outside its calendar
hides the rows and leaves services untouched.

The "Vicino a" section lists stops (same-named stops within 150 m form one stop;
metro stations first, then by walking time), each with its lines and their next
departures. "Mostra tutte le N linee sulla mappa" sits on top, "Mostra linee" next
to each stop name, and each line chip is itself a button for that line alone. Both close the sheet, switch to the map and call `transport.focus()`: the
layer then requests `/api/preview/transport?routes=<route_id,...>` (at most 80; the
whole lines with all their stops, regardless of viewport, zoom and mode boxes),
draws each bus line in its own palette colour with its code label next to the
service, highlights the nearby stops in yellow and fits the map to the service and
those stops (zoom ≤ 16). Only the focused service's own map pin stays visible. A
chip at the top names the view; ✕ returns to the normal layer and all pins.

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
