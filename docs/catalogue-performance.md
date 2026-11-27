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
