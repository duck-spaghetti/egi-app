# R1 rendering changes and verification

Scope: EGI-120–121, specification r0.3, whole-set and local commits only.
The user explicitly selected local M2 `19efd55` as the base instead of fetched
`origin/dev` (`a75bd0e`). Other branches and the M2 preview are preserved.

## EGI-120: compact service heads during zoom

The settled collision planner scales candidate offsets with map zoom: full
separation at z17, decreasing to no extra displacement at z14. Source positions
and site identities stay unchanged. During a gesture, the map keeps each chosen
candidate's direction and coalesces head/SVG endpoint writes into one pending
animation frame. It neither reconstructs pin/label content nor reruns service
presentation. Full layout/clustering runs at moveend; settled render, visibility
changes and disposal cancel pending gesture work.

The existing bounded fallback still applies to saturated views: reducing offsets
cannot guarantee separation of arbitrarily many sites. Secondary labels use the
existing collision policy after settling; selected-site accessibility is retained.

### Evidence, 2026-11-27

- All 22 existing/current Node suites passed, including the new map-seam gesture
  regression. The same gesture regression failed against base `19efd55` at its
  coalesced-frame assertion, establishing sensitivity to the original behavior.
- Browser: in-app Chromium, viewport 1280 × 676, device pixel ratio 2, existing
  dataset `20261126T140106Z`, 100 synthetic nearby-address markers over the real
  dense Rome scene. Three warmed z17→z16 gestures of 1.8 s each, compared with
  the same M2 scene. Retained benchmark results are workspace local evidence.
- Added update p95: **0.30 / 0.30 / 0.30 ms**, 54 measured update callbacks per run,
  below the confirmed 1 ms desktop budget. Timing includes the lightweight
  instrumentation counting head style writes; it excludes browser layout/paint
  and GPU work, which are reflected separately in frame observations.
- Frame p95: **17.6 / 17.6 / 17.6 ms**, matching the three baseline observations;
  no measured frame exceeded 33.4 ms. These are a controlled local comparison,
  not evidence of a speedup over baseline, which had no continuous head updates.
- Mid-gesture checks preserved button and body identity/content, aligned SVG
  endpoints to head offsets and retained all source coordinates. All 100 markers
  remained mounted; observed JS heap was 52.3–54.8 MiB, excluding GPU/process memory.
- No browser console errors were reported. Physical-phone acceptance and its
  separate budgets remain pending; this desktop fixture does not replace them.

## Verification entrypoints

Run the existing Node suites with `node --experimental-vm-modules`.
`tests/test_map3d_zoom.cjs` exercises the actual map composition with controlled
frame scheduling, exact coordinates, reversed zoom, settled cancellation,
selection, layer visibility and disposal. The existing site/layout and map
performance suites retain close-address, mobile/RTL and compact-leader coverage.

## EGI-121: coherent terracotta volumes without duplicate roofs

Ordinary building plans, aggregate blocks and detailed parts share the existing
terracotta value `#df9277`; the plan outline is a darker related shade. The
aggregate/detail height morph remains intact. Monument/tall color branches and
iconic-landmark layers are preserved. The separate ordinary-building roof
extrusion is removed, not made transparent. Building sources, heights, tile
loading and dataset artifacts are unchanged.

Across the retained dataset, detailed volume/roof candidates fall from 515,134
to 261,224: 253,910 fewer, or approximately 49.3%. These are dataset-wide layer
candidates, not simultaneously drawn triangles or a measured GPU/memory saving.
Both old layers read the same vector source, so network bytes are not reduced by
this layer removal. No GPU buffer/triangle instrumentation is available in the
retained browser probe; queried feature counts include tile duplicates and are
not used as a GPU-memory proxy.

### Combined R1 verification

- The real MapLibre style loaded and rendered at z13, 14, 15, 15.9, 16, 16.3,
  17.2, 18 and 19 without console errors. Recorded layer colors show the same
  ordinary-building terracotta before/after the block/detail boundary; the roof
  layer is absent. Visual comparison covered the dense Repubblica/Termini scene.
- Lighting remains MapLibre's existing default. Volume opacity remains 0.6 after
  growth, and the existing planar/growth opacity transitions remain unchanged.
  Transparent surfaces retain normal lighting/overlap variation; this change does
  not promise uniform screen pixels across different orientations and depths.
- Matched dense-scene pan/bearing runs: 1280 × 676 map viewport, DPR 2,
  100 synthetic service markers at start, same 1.8-second path and retained map
  dataset, three runs per variant. Baseline frame p95 **16.8 / 17.5 / 16.8 ms**;
  combined R1 **16.8 / 16.8 / 17.3 ms**. Both had zero measured gaps >33.4 ms.
  This supports no observed frame regression, not a proven frame-rate speedup.
  Both retained 77 visible markers after the same pan due to viewport culling.
- Repeated combined-state zoom: added update p95 **0.30 / 0.30 / 0.30 ms**;
  frame p95 **17.0 / 17.0 / 17.6 ms**. Button/body content and identity, leader
  alignment and source coordinates remained stable mid-gesture. Peak observed
  JS heap in these matched R1 samples was 58.6 MiB; collection timing varies and
  this excludes GPU/RSS, so no memory reduction is inferred from these samples.
- Exploratory runs with a different viewport or DPR are retained separately but
  excluded from these matched comparisons. Benchmark code/results are local
  verification artifacts, not production telemetry or product test hooks.

Real-phone acceptance remains pending, along with its separately agreed budgets.
R2, feed acquisition/polling, importer artifacts, metadata caching and monument
expansion are outside this change. Verification uses a temporary isolated server;
the existing M2 preview and port 4317 are not changed.
