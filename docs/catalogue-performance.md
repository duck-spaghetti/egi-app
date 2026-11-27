# Catalogue responsiveness C — execution

User approved EGI-125–127 on2026-11-27: whole-set, local commits only, final
milestone review. Dedicated worktree `egi-app-c`, branch `ms/responsive-catalogue`,
from accepted R2 `06519ce`. Fetch succeeded; unrelated worktrees and preview
ports4317/4323/4324/4326 remain untouched. No new dependency, public interface,
metadata TTL/cache, acquisition, installed job or schema change. Physical-phone
acceptance remains separate in EGI-128.

## EGI-125: one refresh owns derivations

The services module begins a coherent refresh with its snapshot and clock.
Descriptions memoize by stable service ID; ID-less display objects use object
identity. A new refresh replaces the entire memo, so data, language, reference and
clock changes cannot reuse old opening descriptions. Explicit different clock
arguments bypass an old memo. Detail/hour presentation retains the existing
opening rules. Disposal clears the memo; no cross-refresh response cache exists.

Sites builds one exact source-coordinate/source-group sibling index per refresh,
including source siblings outside current filters. Canonical grouping remains
exact coordinates; noncanonical sibling grouping remains original source-group
identity. No nearby civic addresses are merged. Owner reset handles same-array
mutations, and new catalogue identity also invalidates indexes. Disposal releases
all references. Map/list/search consumers use the same refresh clock.

Tests compare memoized and uncached production descriptions across languages,
reference changes, new data, explicit clock boundaries, local midnight and DST
instants. They cover ID-less identity, exact/nearby positions, original source
siblings and disposal. Existing canonical/map/module suites pass.

The retained594-service fixture benchmark runs actual presentation/search/facet/
pin modules, freezing one clock and including index construction. Four post-R2
and four C samples preserve ordered IDs, category markup and pin HTML/name/status/
service IDs exactly. Three warmed medians: **728.6ms post-R2 →55.2ms C**, below
the approved100ms CPU target. Original retained audit:618.6ms baseline and28.7ms
harness-only memo+index experiment; different recorded context, not a matched
current comparison. Current machine Apple M4/Mac16,12, macOS15.5, Node26.13.1.
These are Node CPU timings; no DOM layout/paint, HTTP/DB or list opening is included.
Raw reproduction/data/evidence remain in the workspace's `.local/c` and retained
M2 audit-data folders. Real browser filter p95≤150ms remains to verify in EGI-126/127.

## EGI-126: lazy list and retained controls

The list only materializes in list mode; returning to the map clears rows and its
markup memo. Opening the list requests a current refresh. Category tiles, offer
chips, selects/options and service rows reconcile escaped presentation markup by
stable keys, retaining surviving nodes, scroll and focus. Removed focused items
fall back to a visible surviving control (or the view toggle). Delegated listeners
are installed once per page and removed with its AbortSignal. Search disposal
releases its snapshot, facets and markup references. No dependency was added.

Controlled DOM tests cover stable node identity, reorder/text changes, scroll and
lazy row ownership; the shared fixture now models actual child nodes and named
attributes. Existing tests that relied on fake-DOM differences were corrected to
assert the same production security/path contract. In the real browser, the
594-service preview has zero list rows initially,594 when opened, and zero after
returning to the map. Browser focus/paint and integrated performance are checked
with the final coherent-refresh implementation below.

## EGI-127: coordinated refresh ownership

Each refresh clones state once, selects results with one clock, then distributes
that same snapshot and matched-ID set to services, facets, origin, transport and
map. Reentrant invalid-facet repair schedules another coherent pass. Shell source
changes and directory/list navigation no longer perform duplicate facet passes.
List rows consume the same memoized descriptions, and only changed row markup
is parsed. Current nodes own their last markup in a WeakMap; detached nodes are
not retained. No full hidden list or persistent response cache is maintained.

The page coalesces periodic reads only within one language generation; the loader
shares only simultaneous bundles for the same language in its fixed city/API
context. Settlement removes promises even on failure: each later load performs
all six existing reads again. Taxonomy still falls back to empty data on failure.
Dictionary preparation has no visible side effects; normalization uses its target
translator. Generation checks precede the joint dictionary/catalogue commit and
reject obsolete success/error results. A failed load
retains the last usable catalogue; shell language state changes only after a
successful load. Clock refreshes invalidate presentation even when canonical
network refresh fails. The30-second and five-minute intervals are unchanged.
Disposal aborts HTTP/timers/listeners and clears snapshots, indexes, memoization
and request registries. Controlled tests cover coalescing, fresh reads, taxonomy
fallback, failure/retry, language supersession and late completion after disposal.

Service rows use browser-managed `content-visibility:auto` with an initial220px
block estimate and remembered actual sizes. All rows remain in DOM and accessible;
keyboard focus reveals skipped content. The browser can refine the scrollbar as
previously unseen variable-height rows are measured. This is not pagination or a
detached row cache. Fast bottom/top scrolling and first/last-row focus are checked
in the desktop browser; physical-phone acceptance stays in EGI-128.

## Integrated desktop verification

Reference: Apple M4/Mac16,12, macOS15.5, Chrome158 in-app browser,1280×720,
retained594-service/365-site fixture and fixed2026-11-27T12:00Z clock. The isolated
local proxy uses the actual R2/C app/module/style graphs, same existing read-only
backend and datasets, and test-owned controls. Only measurements inject the fixed
clock and capture the native map for pan automation; product files do not include
test hooks. Every timed reset checks594 results in the first updated animation
frame (and594 actual DOM rows in list mode). Three warmups precede20 measurements
per mode. A second animation frame records a paint opportunity, not GPU timing.

The CPU/synchronous handler values include refresh/index work; frame measures
include browser layout scheduling. Network is excluded from filter-reset timing.
The loader test proves six reads per fresh bundle and sharing only while pending;
backend latency is not an optimization result. The browser's resource log is
retained separately; timing runs have different durations and therefore different
periodic-request counts. Existing30-second polling is preserved. A five-second
RTL harness timeout was insufficient for a slow local read; standalone RTL and
LTR plus first/last-row focus pass after awaiting completion.

Independent Standards and Spec reviews resolved one language coherence defect and
a duplicated focus/scroll policy; both axes then reported zero remaining code
findings. Controlled DOM tests cannot establish focus/layout cost; browser evidence
checks retained tile/row identity, focus, scroll150px, empty results, removed offer
focus to the visible close control and selected detail outside current filters.
Offscreen row keyboard/scroll checks cover all594 rows. Physical phones, Safari,
GPU timings and total process/GPU memory are not established by these checks.


### Final matched results

| Metric | Accepted R2 base | Integrated C |
| --- | ---: | ---: |
| map: Synchronous reset median | 455.6 ms | 30.6 ms |
| map: First updated frame p95 | 1123.7 ms | 38.3 ms |
| map: Second-frame paint opportunity p95 | 1124.7 ms | 51.1 ms |
| list: Synchronous reset median | 589.2 ms | 43.4 ms |
| list: First updated frame p95 | 2108.6 ms | 89.8 ms |
| list: Second-frame paint opportunity p95 | 2114.4 ms | 91.8 ms |
| List opening through paint opportunity | 119.0 ms | 78.1 ms |
| Initial list rows in map mode | 594 | 0 |
| DOM elements, including test controls | 17112 | 605 |

The synchronous map median includes one clone, sibling-index construction,
selection, facets, pins and the same clock; it also satisfies the100ms CPU budget.
The earlier isolated derivation result55.2ms remains separately identified above.
Both first-frame p95 values satisfy150ms; second-frame figures are a conservative
paint-opportunity observation, not compositor/GPU instrumentation. List opening
adds current row construction, whereas the base had already built hidden rows.
One extra test button is present in C; the DOM reduction is primarily removed
hidden rows. No product test controls are shipped.

Three complete-map pan samples: 60.1FPS, frame p95 27.2ms, heap 49.6MiB, 37 added/removed marker nodes; 60.0FPS, frame p95 18.1ms, heap 64.9MiB, 52 added/removed marker nodes; 60.0FPS, frame p95 18.4ms, heap 50.1MiB, 27 added/removed marker nodes.
Marker churn matches the same R2 samples (37/52/27); those are changed-visible-set
nodes during pan, not unsolicited displacement by interface controls. Heap values
remain below150MiB; these observations do not prove a total-memory/GPU bound or
absence of every possible leak. Weak ownership and disposal tests complement the
repeated interaction measurements.

Final complete journeys pass empty results, removed-focus fallback, retained
selected detail, RTL and return to LTR; separate first/last-row focus/fast-scroll
checks pass. All26 Node suites pass, including actual translator/normalizer
race and retry tests. The targeted Python HTTP/map/application-instance checks
run12 tests successfully with5 declared legacy-pilot HTTP skips. Changed-JS syntax
and diff whitespace checks pass. Independent Standards and Spec review: zero
unresolved findings after corrections. No new dependencies or delivery beyond
local commits; human C review and physical phones remain pending.

Raw results, fixture inputs, fixed clock, proxy driver, browser journeys, Node
outputs and review snapshots are retained under workspace `.local/c` (original
fixtures under `.local/m2/evidence/audit-data`). The proxy is verification-only
and is stopped after evidence collection; the separate C preview uses4327.
