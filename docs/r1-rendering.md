# R1 rendering changes and verification

> User-review correction, 2026-11-27: the initial compact-offset implementation
> introduced intermediate-zoom overlaps. The adaptive-direction/opaque-building
> correction below supersedes the initial behavior and its acceptance evidence.
> Earlier sections are retained as the record of the first candidate, not a
> claim that its regression was already covered by the original tests.

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

## EGI-120 review correction: adaptive directions

The original zoom-scaled candidate set collapsed distinct civic heads at
intermediate zooms. The corrected planner uses a bounded fan with 56px maximum
head displacement and 64px maximum SVG leader length. It retains valid offsets exactly (the stability amendment below supersedes the
earlier automatic shortening policy). Source-space proximity
puts the selected site's neighbours before distant markers. A capped local repair
can relocate at most two blocking heads per repair; the shared work cap prevents
an unbounded search in saturated views.

The icon's layout height is fixed at 44px, independently of label content. Its
collision footprint now matches that size. The label's integrated white backing
is separate from the fixed icon geometry, so a taller label does not move the
symbol or its ground connection. Accessible names and source grouping remain.

Camera movement marks layout dirty; one flush in MapLibre's own render event
updates existing head transforms and SVG endpoints after marker positioning.
This replaces the extra animation-frame callback that could lag native movement.
The full grouping/content pipeline still runs only on settled/data updates.
Unsafe secondary labels are suppressed during camera movement and recomputed
after settling; they are not rebuilt on each render. Numeric grid cells avoid
per-candidate string/array allocations, and unchanged DOM flags are not rewritten.

Regression coverage includes intermediate zooms, four retained anonymous Giolitti
screen projections, changing available directions, exact anchors, content/identity,
the map render lifecycle and 20 visibility cycles. The original f426e98 behavior
reproduces the collision. The full-catalogue browser journey verifies all 594
retained records, not just the seven records addressed on Via Giolitti.

## EGI-121 review correction: opaque building volumes

Ordinary building volumes and iconic landmark volumes now have opacity 1. Height
growth supplies their gradual appearance. The ordinary-building palette is a
lighter muted terracotta (`#dcb29d`); class-specific monument/tall and iconic
colors remain distinct. Ordinary walls omit the extra vertical gradient while
retaining MapLibre's existing directional light. The 2D building fill peaks at
z14 and fades to zero at z15.5 instead of showing through the volumes. The roof
layer remains removed. Source geometry, heights, dataset, transport layers,
polling and the M2 preview are unchanged.

### Corrected combined-state evidence

Compared with frozen **f426e98**, including its original scripts and CSS, on
2026-11-27. Desktop in-app browser, map viewport 1280 × 676, DPR 2, retained dataset
20261126T140106Z. Benchmark artifacts/results live in the local correction-evidence
collection; exploratory runs are retained separately from the final summary.

- **Via Giolitti with all 594 records:** z15, 15.5, 16, 16.5, 17, 17.5 and 18,
  each at four bearings. Previous R1 had overlaps in **17/28** static checks and
  **73/109** rendered gesture samples. Corrected R1 had **0/28** static failures
  and **0/109** rendered gesture failures; maximum leader in that gesture was
  56.1px. Checks compare actual icon rectangles, not only a planner's estimates.
  This establishes the tested street/scenarios, not arbitrary-density guarantees.
- **100-marker zoom, three 1.8-second runs:** corrected layout CPU p95
  **0.8 / 0.7 / 0.7 ms**, under the unchanged 1ms budget. The original simple
  offset update cost 0.3ms; it did not solve collisions during gestures. The new
  pass runs in the map render frame (110 observed callbacks/run), whereas the
  previous extra RAF path produced 54 observed update callbacks/run.
- Zoom frame p95: previous R1 **16.8 / 17.1 / 16.8 ms**; corrected
  **17.4 / 16.8 / 16.8 ms**. Pan/rotation frame p95: previous
  **16.8 / 17.4 / 17.3 ms**; corrected **16.9 / 17.0 / 17.2 ms**. No measured
  gap exceeded 33.4ms. Corrected pan layout CPU p95 was **0.5 / 0.6 / 0.6 ms**;
  the previous code had no continuous pan/rotation collision pass.
- Stable button/body identity, body content, source coordinates and SVG endpoint
  alignment passed mid-gesture checks. Peak observed JS heap in those corrected
  100-marker runs was 48.9MiB, excluding GPU/process memory; no memory saving is
  inferred. The new pass costs more CPU than the old transform-only path while
  staying within the measured desktop budget and preserving observed frame rate.
- An earlier adaptive prototype exceeded the update target (1.2/1.1ms in two
  samples); its records are retained. Numeric spatial cells, reduced allocation
  and avoiding unchanged DOM writes brought the final samples under the budget.
  The target was not relaxed.
- Real-renderer building checks covered z13–19. Recorded paint properties confirm
  opacity 1 and removal of the underlying planar fill at detail zooms. Visual
  checks covered Via Giolitti and the complex Repubblica/Termini volumes, with no
  reported console errors. No GPU timing/buffer reduction has been established.

Physical-phone acceptance remains pending. Neither synthetic marker fixtures nor
desktop frame observations replace it. The complete R1 review preview remains on
4324; the temporary comparison server uses 4325. R2 remains outside this work.

## EGI-120 stability amendment: UI overlays never repel POIs

User review on 2026-11-27 identified camera buttons and other interface elements
redirecting nearby heads during pan. The planner now considers only other POI
heads, source feet and existing clusters. UI rectangles and viewport edges are
not placement obstacles; navigation remains above services through existing
stacking. A still-valid bounded offset persists exactly, including when an
unshifted or shorter path becomes available. A real POI collision can still
relocate it. Zoom-out clustering keeps its existing threshold (z15). No source
coordinate, data acquisition, building or transport behavior changes.

Secondary labels no longer avoid UI rectangles or reserve an artificial toolbar
margin. They prefer their existing side when it fits. Viewport/POI collisions
can still flip or suppress secondary content without redirecting the icon.

Evidence against frozen ecf0a55, desktop in-app browser, viewport 1280 × 676, DPR 2:

- A real camera-control crossing reproduced **25/109 offset changes before**;
  the correction has **0/109**, including 25 frames beneath the control. The
  same button survives and DOM hit testing confirms controls remain on top.
- Via Giolitti with all 594 retained records: **0/36** static overlap failures
  across z14, 14.9, 15, 15.5, 16, 16.5, 17, 17.5, 18 and four bearings; clusters
  remain present in all eight checks below z15. **0/109** gesture failures;
  maximum observed leader 59.9px, under the unchanged 64px bound.
- Three 100-marker zoom runs: layout CPU p95 **0.8/0.7/0.6ms**, versus
  **0.7/0.7/0.5ms** before; pan/rotation **0.4/0.3/0.4ms**, versus
  **0.5/0.6/0.5ms**. All remain under the existing 1ms budget. Samples establish
  budget compliance, not a statistically significant overall speedup.
- Corrected frame p95: zoom **16.7/17.3/16.8ms**, pan **16.8/17.0/16.8ms**;
  before: zoom **16.7/16.8/17.5ms**, pan **16.8/16.8/16.8ms**. No gap over
  33.4ms; button/body/markup identity, SVG alignment and source coordinates pass.
  Peak corrected JS heap was 59.8MiB; this excludes GPU/process memory. Phone
  acceptance and GPU profiling remain pending.
- All **22 Node suites pass**, including a regression that first failed on
  ecf0a55: panning a nearby group under UI/beyond viewport boundaries must retain
  all valid offsets, while a new real POI collision must still trigger separation.
  Existing four map HTTP tests are reused unchanged: this correction changes
  only frontend placement and its tests/documentation.

The local stability-evidence collection retains the raw runs and final summary;
exploratory mislabeled comparisons are excluded. R1 remains in human review.
