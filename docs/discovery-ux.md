# Discovery UX and local address search

Implemented under the approved shared discovery UX r1 plan (2026-11-09), U01–U18.
This is a local unreviewed-source preview; no importer/database edits or deployment.

## Navigation and shared filters

Filtri uses one DOM control tree and one filter state, always in the Filtri sheet
(map control or list toolbar, see "List toolbar (r2)"). Changing view preserves
values and listeners. The list shows active filters as chips. Menu contains Rubrica links to emergency numbers and the
existing remote-service list section. Emergency numbers retain their telephone links.

Livelli is a separate map control, hidden in list view, with independent transport
modes and cycleways. All layers start off; transport checkboxes activate their own
modes, while Tutti i trasporti controls the complete set. Selections survive view
changes. Sheets support Escape, focus return and Tab containment. Minimum map zoom
is at least 9 and further constrained by the area/viewport; bounds recompute on resize.

## Destination access vs selected origin

`GET /api/preview/transit/places/{place_id}` now returns nearby lines and grouped
stops **without** per-line `next` departures or schedule/realtime/alerts fields.
It retains availability/source/method metadata. This approved preview contract
change removes destination countdowns; service badges still describe nearby lines.

Cards move the source organization and opening state near the title/address,
remove the repeated position/coordinate section and keep source-location uncertainty.
A closed Trasporti nelle vicinanze section summarizes stop count/nearest distance.
Expanded stops sort by distance in metres, then name/IDs; each stop's lines/alerts
are separately expandable. Distance remains straight-line, walking time estimated.

`GET /api/preview/transit/origin?lat&lon` takes an explicit reference in the supported
Rome bounds (41–42.7 N, 11.5–13.7 E), without reading the service DB. It returns
`lines`, distance-ordered `stops`, per-line `next` directions, `realtime`, `alerts`,
`now`, `schedule_availability` and source/method metadata. Posizione loads it when
Mezzi vicino al punto scelto is expanded. A named/manual/GPS origin stays labelled;
no origin is invented. The user can refresh departures; the displayed update time
qualifies relative countdowns. No journey planning or walking routing is implemented.

Timed rail uses only existing source categories REG/RV/MET/SFM/DIR in map stations,
nearby rows and departures. Long-distance categories are excluded even in explicit
focus. Approximate NeTEx rail polylines are never drawn; genuine OSM local rail
geometry remains available. Ordinary bus views contain stops from zoom 16 and no
route polylines; selecting a bus line restores its route/stops at any zoom.
Residual review r2 raised stop thresholds: metro and rail stations (timed and
OSM) from zoom 14, tram stops from 15, bus stops from 16. Each stop shows one mode
symbol; line codes appear from zoom 16, in a line focus or on hover/keyboard focus.
Network lines are thinner and semi-transparent and render in panes below service
markers (`transportLines` z350, `transportStops` z450, services z600). OSM station markers omit long route-name
stacks. All original runtime data remains retained, without filtering the importer.

## Opening state and map symbols

The Europe/Rome source calculation merges overlapping intervals. During a declared
interval it shows green Aperto ora, or orange with closing clock time when <=60 min
remain. Outside today's declared valid intervals it shows red Chiuso ora and the
next declared opening when available. Missing/ambiguous days remain neutral unknown,
with a qualified later declaration if present; no missing day proves closure.
Open-now membership includes both open and closing states. The source disclaimer
remains visible, and labels/filter membership refresh at the existing 30 s cadence.

Single-service pins use solid category color and a contrasting icon. A multiservice
site uses category sectors weighted by service count and a centered total. Geographic
clusters retain distinct styling/meaning. Existing colocated-source-site/filter
membership is preserved. Transit chips use a white outer background, colored code
and a colored mode block with white glyph; colors remain source-specific.

## Address search contract and operation

`POST /api/preview/address-search` accepts JSON `{"query":"Roma Termini"}` (3–200
characters after validation) and returns `results: [{lat, lon, label}]` plus
`attribution`. At most five results are returned in the supported area. Invalid
requests yield 422; unavailable/malformed upstream yields a generic 503 without
query/upstream detail. The browser requires submission and explicit result selection;
there is no autocomplete, reverse GPS lookup or background Nominatim refresh.

The adapter uses the existing Python standard library. Configuration at startup:
- `EGI_GEOCODER_URL`: Search-compatible endpoint, default public Nominatim Search.
- `EGI_GEOCODER_RATE_FILE`: shared request-start lock/timestamp; default workspace
  `.local/geocoding/request.lock`. All local workers share this path. It contains
  no addresses. Concurrent multi-host deployment would need another design.

The adapter sends an identifying User-Agent, bounds the area with `viewbox` and
`bounded=1`, requests Italian results in Italy, uses verified TLS and an 8 s timeout,
and limits response bytes. A shared file lock spaces application requests at least
one second apart across workers; a thread lock protects the process cache. Cache
holds at most 128 normalized queries/results for one hour in memory, never on disk.
No address enters the local endpoint URL/access log; do not enable body logging.
Provider configuration is trusted operator configuration, not a user-supplied URL.

UI credits OpenStreetMap, explains that submitted search text goes to Nominatim and
asks users not to include personal/confidential data. Map/GPS selection remains
available on provider failure. Public capacity/terms must be revisited before a
public release; this does not authorize bulk importer geocoding.

Primary references inspected during planning/research:
[Search API](https://nominatim.org/release-docs/latest/api/Search/) and
[usage policy](https://operations.osmfoundation.org/policies/nominatim/).

## Verification

Actual commands, results, screenshots and limits are in the shared
[execution record](../../.scratch/discovery-ux/plan.md). Python tests cover adapter
cache/rate/bounds/errors, regional stations and real SQLite departures, destination
no-countdown behavior, origin separation, distance order and selected bus geometry.
Node tests cover opening thresholds/unknown days, filter membership, collapsed
transport/absence of destination countdowns and the existing popup lifecycle.

## List toolbar (r2)

The list header shows one toolbar at every width: Filtri (opens the shared filter
sheet, with an active-filter count), a compact Ordina select (Nome/Distanza) and
Scegli punto. Active filters render as chips below it. The former desktop inline
sidebar is removed; on desktop the filter sheet opens as a left panel. The
floating Filtri control is hidden in list mode. The Livelli trigger uses
`icons/ui/layers.svg`.
