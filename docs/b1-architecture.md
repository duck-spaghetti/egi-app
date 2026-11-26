# B1 application Modules

Current completion scope: workspace `.scratch/mvp/b1-refactoring-completion.md`
r0.2, EGI-42/43. This document describes the actual app organization; the separate
canonical SQL supplement privacy finding remains an overall B1 acceptance blocker.
No SQLite, contribution/moderation journey or server-rendered fragment protocol is
implemented by this refactoring.

## Backend

`main.create_app(configuration=None, overrides=None)` creates an isolated FastAPI
application. Its lifespan validates environment/profile once, constructs only the
selected readers, installs selected routers and owns diagnostics/cache cleanup.
`main:app` remains the Uvicorn entrypoint. Tests and embedded callers must enter
that lifespan (for example `with TestClient(create_app(...))`). Importing endpoint
families does not construct configured readers or contact databases.

`config.Configuration` owns mode, local data paths, public profile and private
connection/diagnostic settings. `resolved(territory, policy)` prepares allowlisted
public values with canonical territory precedence. Invalid settings never echo
input values. Existing environment names and YAML defaults are retained.

`db.Db` exposes coherent `snapshot(language)` reads and resource cleanup. Its private
Implementation owns the connection/transaction, freshness/cache and supplementary
reads; callers do not issue generic SQL. `queries/catalogue.py` validates named YAML
reads from `queries/public.yaml`, rejects duplicate names and unsafe YAML; driver
parameters remain bound values. PostgreSQL is the sole supported current backend.

Every actual HTTP family under `api/` has router, service, schemas, dependencies
and exceptions responsibilities:

| Family | Behavior hidden behind its Interface |
| --- | --- |
| pages | Entry/map context and selected-reader health, read-only contribution explanation. |
| directory | Public cards/detail, vocabulary and area projection over the configured Db. |
| address_search | Explicit query, candidate normalization, safe upstream errors and per-instance bounded HMAC cache. |
| transport | Viewport, public-place summaries/detail, origin and departures, timed and untimed source composition. |
| cycleways | Bounded geographic infrastructure reads and availability. |
| preview | Retained source cards, coverage, debug positions and overlap review; never mounted in canonical mode. |

Routers validate HTTP and delegate; behavior raises family errors derived from the
global application error category. Central handlers return safe messages/opaque
references. Local transport receives an actual point-provider Adapter: canonical
public places or retained preview places. Canonical composition never constructs
or reads the preview source. Preview-specific interpretation, identity proposals,
coverage and taxonomy files stay inside `api/preview`; genuinely reused labels and
language metadata live under `presentation/`.

For HTTP tests, override scoped dependencies (such as preview `subject_source`) or
pass actual resource substitutes to `create_app`. External geocoding is substituted;
publication/privacy/role claims require the existing native PostgreSQL harness.

## Frontend

`templates/base.html` owns the frame. `templates/pages/` holds entry, map, benchmark
and overlap-review pages. `templates/components/` owns the existing data-status
banner and filter/detail panel shells. Dynamic service cards are rendered only by
JavaScript, not copied into Jinja. Dictionaries remain at repository `translations/`
with the same `/translations` URL. Fonts, vendor versions, notices and icons remain
local and unchanged.

`static/js/pages/map.js` composes one page through `createMapPage(context,
dependencies).mount()/dispose()`. `map-start.js` owns browser startup/recreation.
The page owns results, filters, selected service, reference point and language
coordination. It supplies snapshots to feature Interfaces, never a mutable shared
state object. Its private `shell.js` controls sheets/settings/focus. Features emit
specific page actions instead of importing other feature state or DOM.

| Feature | Caller Interface and private responsibilities |
| --- | --- |
| services | `load`, `update`, `show`, `choose`, `refreshHours`, `describe`, `dispose`; normalization, list/detail rendering, contacts, hours and provenance are private. |
| search | `select`, `matches`, `update`, `dispose`; matching/facets and controls only, no fetching or map/list rendering. |
| map | `mount`, `update`, `attach`, `center`, `contains`, `invalidate`, `servicesVisible`, `dispose`; Leaflet and marker handles stay private. |
| map3d | The same interface on MapLibre GL JS for the optional 3D mode (`features/map3d/`), chosen by `map-start.js` through the page's map factory; style, HTML markers with screen-space clustering, rotation/tilt controls. Libraries are loaded only in 3D mode. |
| origin | `update`, `locate`, `search`, `choose`, `set`, `dispose`; explicit reference interaction, temporary address candidates and request cancellation. |
| transport | Layer mount/update, summaries/detail/origin, badge/shell rendering and disposal; references/data come from the page. `referenceChanged` resets its own origin panel, cancels obsolete requests and reloads an open panel. |
| cycleways | Optional overlay mount/dispose. |
| preview | Existing debug panel and overlap-review behavior; selected only for preview. |

`features/map/sites.js` owns exact-position grouping separately from Leaflet. A
marker reflects filtered matches; the selector/detail can show all public siblings
with out-of-filter labels. Each retains its own identity and attributes.
`features/map/view.js` chooses the mode at startup (`?vista=3d|2d`, else the device
choice in localStorage; 3D needs WebGL2 and an active data set) and carries filters,
search text and reference point across the reload in sessionStorage, read once; the URL
holds only view, language, city and selected service (ADR 0007). Layer modules tell the
engine apart with `features/map/engine.js`.
`features/map/pins.js` owns the site pin markup, its accessible label and the
selection payload (`siteMarkers`), with no map library: every map module wraps the
same markup in its own marker type.

`http.js` is the concrete request Adapter. It checks the page lifecycle after both
fetch and JSON completion. `lifecycle.js` owns cancellation/listeners/timers/cleanup and the actual
entry/map/review BFCache restart pattern;
a retiring page cannot update a replacement. `i18n.js` owns per-page dictionaries,
fallback/direction and latest-language ordering. `format.js` contains the actual
pure formatting/text/distance operations reused by features. No global runtime,
shared mutable store, generic event bus or frontend build dependency is introduced.

CSS ownership is `foundations/`, `components/`, `pages/`. Map CSS composes
actual control, panel, service, transport, cycle and marker styles; page-specific
layout and preview debug styles remain under pages/. Preserve rule order and
visual behavior; this is not a redesign. Preview overlap decisions still use their
existing browser-local review storage, separate from visitor-origin handling.
Visitor position/query remains temporary and is never transferred in an app URL.

## Verification

Use the approved existing Python environment. From the app worktree:

```sh
/Users/marco-macbook/dev/project_egi/.local/venvs/app-a3/bin/python -m unittest discover -s tests -v
node --experimental-vm-modules tests/test_map.cjs
node --experimental-vm-modules tests/test_canonical_map.cjs
node --experimental-vm-modules tests/test_map_modules.cjs
node --experimental-vm-modules tests/test_transport_layer.cjs
node --experimental-vm-modules tests/test_transit_presentation.cjs
node --experimental-vm-modules tests/test_entry_page.cjs
node --experimental-vm-modules tests/test_review_corrections.cjs
```

The Node fixture loads source unchanged using real ES Imports; it never strips
Imports/exports or concatenates product files. Behavior coverage includes placement,
filter/facet/sort, contacts, opening/verification/overnight/DST/lessons, co-location,
timed/untimed transport, RT/alerts/cycles, and deferred lifecycle races. Browser
checks cover real DOM/Leaflet integration and responsive/keyboard/RTL journeys.

Native public-reader tests additionally require explicit `EGI_DATABASE_REPO`,
`EGI_SQITCH`, `PERL5LIB` for the existing local Sqitch installation and PostgreSQL
binaries. They allocate only owned `/private/tmp/egi-app-read-*` socket-only clusters;
TEMP is revoked on every created database before deployment of the existing schema.
No retained B1 database migration or source reload is part of these tests.

Final counts, actual commands, browser observations and independent review evidence
belong to the workspace B1 completion execution record and demo. A declared runner
or this architecture document alone does not establish passing acceptance.
