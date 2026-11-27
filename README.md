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

Ordinary buildings use the same muted terracotta family in plan, aggregate blocks
and detailed parts. Volumes are opaque, with their height providing the gradual
appearance; the underlying 2D building fill fades away by z15.5. Ordinary walls
omit the extra vertical gradient while retaining directional illumination.
Monument/tall-building classifications retain their distinct colors.
Detailed volumes no longer draw a second roof extrusion; the shared
building vector source, geometry heights and loading contract are unchanged.
See [R1 rendering verification](docs/r1-rendering.md) for measured costs and limits.

For native verification set `EGI_DATABASE_REPO` to the explicit database worktree and,
optionally, `EGI_SQITCH` to Sqitch (with `PERL5LIB` if needed); without it
`tests/native.py` runs the plan's deploy scripts with psql in plan order.
