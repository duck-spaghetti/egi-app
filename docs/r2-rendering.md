# R2 readable transport — execution

## Agreement and design

R1 `1308db0` was accepted on 2026-11-27. R2 EGI-122–124 is whole-set, local
commits only, on `ms/readable-map-transport` in the dedicated R2 worktree.
The user approved the [concrete proposal](r2-renderer-proposal.md), its budgets,
original geometry/atlas and isolated experiment. Adoption was conditional on
passing the public-API experiment; that condition passed. No library, font,
model acquisition, feed change or new renderer loop was introduced. M2 and
port4317 remain untouched. Final R2 review and physical-phone acceptance remain.

## EGI-122 experiment evidence

The isolated prototype uses the pinned MapLibre6.19.0 and retained local dataset.
Its custom layer draws actual board triangles and exact occlusion queries into
native building depth without private APIs or framebuffer reads/clears.

- **96 depth scenarios passed:** ordinary parts and iconic volumes, bearings
  0/90/180/270, pitches0/45/60, DPR1/2, antialiasing on/off. Hidden probes return
  no samples and visible probes return samples. Monument probes use polygon
  interiors excluding courtyards, not a potentially hollow centroid.
- Transparent onset, exact overlapping-triangle order, camera cancellation and
  timeout pass. Queries resolved in two rendered frames in the tested scene.
- Twenty mount/remove cycles retain one live resource set; context loss invalidates
  handles, and restoration rebuilds one set. No recorded map/GL errors.
- Restoration reloads the style and removes custom layers. Reattach via public
  `style.load`/`load`/`idle`, when the style is ready; do not access private state.

Prototype and raw evidence stay outside product source in the workspace's
R2 prototype/evidence folders. These results establish the chosen integration,
not arbitrary GPU behavior or physical-phone acceptance.

## EGI-123 module ownership and assets

`transport-scene` owns one map/context, shader, atlas, four shared mesh buffers,
two instance buffers and a bounded pick buffer/query set. Sign snapshot replacement
is independent of vehicle replacement. The existing native paline owner provides
recovery if the scene/atlas/capability fails. Its geometry is removed once the
custom scene is ready, so the two representations are not drawn together.

The map owns construction/disposal and provides the scene through its existing
attach context. Transport still owns stop/entrance identity, summary grouping,
keyboard discovery and popup fitting. Custom selection emits the existing map's
internal stop-selection event to that owner. Physical click selection waits for
native-depth visibility; HTML discovery remains immediate and visible through
buildings. Navigation/service/popup stacking is unchanged.

Camera movement changes only uniforms: poles stay fixed and boards yaw vertically
with the camera. Existing z16–16.6 growth and enlarged scale6.4 are shared with
native recovery. Bus and tram use full white words, yellow/blue and dark-green
panels respectively; metro retains red/white M. No extra bus/tram name overlays.

The editable atlas `app/frontend/static/img/transport/boards.svg` is original
app-owned vector art: explicitly drawn paths, no system/downloaded font, logo or
third-party texture. Rasterization uses the browser's SVG image decoder once per
scene and a256×128 RGBA texture with mipmaps (about171KiB allocated texels).
No converter/build dependency. The SVG's checksum/byte count is recorded in
`docs/r2-assets.json`; mesh provenance is the original `geometry.js` builder.
Existing vendor/source notices remain. This record introduces no repository license.

## EGI-123 current verification

The actual production module, not only the prototype, passes36 depth/selection
checks (open/ordinary/iconic cases ×4 bearings ×3 pitches),20 full scene cycles
and context loss/restoration in the retained scene, with no recorded GL errors.
Physical bus selection at all four bearings returns the correct source identity.

100/300-sign desktop checks, viewport1280×676 DPR2: two normal draw calls,
**zero camera buffer uploads**, layout/render CPU p95 **0.8/0.7ms**, frame p95
**16.9/16.8ms**, no frame gaps>33.4ms. Snapshot-to-first-frame wall time was
16.5/16.1ms; this includes frame waiting and is not an initialization CPU measure.
These samples follow an earlier1.4ms attempt. Limiting state reads to states the
module actually changes, and inheriting the documented MapLibre depth/blending
setup, brought the measured100-sign path under1ms. No budget was relaxed.
Full combined R2/baseline/initialization statistics follow in EGI-124.

All23 Node suites pass, including transport handoff/recovery and existing map,
walking, popup, source-coordinate and freshness regressions. No backend changed.
Node tests exercise actual module imports and verify bounded meshes, stable
identity, zero camera uploads, query cancellation/timeouts, independent owner
clearing, partial-allocation cleanup, context recovery and20 clean cycles.
Their GL recorder proves ownership/calls; browser depth evidence remains separate.

## EGI-124 buses and combined evidence

The existing bus owner supplies the same eligible observed positions/bearings and
old-state to the shared scene. Snapshot transitions, polling, stale/hidden/zoom
removal, filters, route labels and fallback boxes retain their prior behavior.
No extrapolation or new motion prediction. Custom readiness hides native boxes;
failure restores them. Empty vehicle snapshots clear only vehicles, never signs.
One204-triangle near mesh has a distinct windshield, side windows/door, wheels,
lamps and roof; one24-triangle distant silhouette crossfades around z15.5–16.
Both share the sign renderer/program/atlas. Full words remain on sign boards only.

Measured on Apple M4 (Mac16,12), macOS15.5, desktop in-app Chromium158.0.0.0, viewport
1280×676, DPR2, identical retained map data, synthetic unique coordinates and
1.8-second bearing0→90/zoom17.5→17 paths. Baseline uses unchanged native
`signGeometry` and bus `footprint`, not custom rendering disguised as a baseline.
No tile-query duplicates are counted as unique stress objects. The baseline's
zero custom-callback CPU is not zero native renderer work.

| Scenario | R2 custom CPU p95 | R2 frame p95 | Native frame p95 | Native/R2 snapshot-submit CPU |
| --- | ---: | ---: | ---: | ---: |
|20 buses|0.8ms|16.8ms|16.8ms|0.5/0.1ms|
|100 buses|0.9ms|17.4ms|16.8ms|0.3/0.2ms|
|300 buses|0.9ms|16.8ms|17.3ms|0.8/0.2ms|
|100 signs+100 buses|0.9ms|17.2ms|17.4ms|1.6/0.3ms|
|300 signs+300 buses|0.9ms|16.9ms|17.1ms|3.0/0.4ms|

These initial matched samples demonstrate the tested cost envelope, not a
statistically established overall speedup. Source-submit timings exclude native
worker processing and GPU completion. Normal custom draws: two for signs, one
near bus batch, three combined; at most four through transition. Camera paths
perform zero instance/mesh/source uploads. Whole-map GL draw totals were also
recorded (including all basemap tiles), not labelled as custom-only draws or a
fixed GPU saving. No frame gap>33.4ms occurred in these samples.

Three further combined runs after lifecycle instrumentation:100+100 CPU p95
**0.8/0.7/0.7ms**,300+300 **0.6/0.7/0.8ms**; frame p95 **18.2–18.6ms**, no
>33.4ms gaps. The instrumentation/context differs from the first table, so these
runs establish repeated budget compliance rather than an improved baseline.
One sign-only exploratory sample reached1.1ms; retain its raw result. The agreed
combined100+100≤1ms/300+300≤2ms targets passed; no threshold was relaxed.

Cold shared GL preparation was1.7ms in the recorded launch; subsequent scene
re-creation CPU samples were5.4–6.8ms, context restoration1.7ms. Warm snapshot
submission was0–0.4ms; snapshot-to-frame wall times15.5–18.4ms include waiting.
These values stay below25ms/50ms initialization CPU ceilings and distinguish
network/frame waiting from CPU work. Peak observed combined JS heap after
stress/cycles was91.1MiB, below150MB; heap excludes GPU/process memory and is
not a leak proof or a claimed memory saving.

Actual scoped resources: one atlas/program, four mesh buffers/VAOs, two instance
buffers and one pick buffer: **13 live owned GL handles**. Real renderer wrappers
observed **zero** after each of21 disposals (initial+20 cycles), and13 after
restoration. Original meshes total24,192 bytes; combined300+300 instance uploads
are19,200 bytes, below128KiB budgets. Atlas source807 bytes, decoded RGBA128KiB,
about171KiB with mipmaps. Incremental renderer source is below18KiB, gzip below7KiB;
no new engine/model download. Exact asset numbers/provenance are in`r2-assets.json`.

Picking orders exact projected intersections, then queries only the nearest
intersected pole/board mesh per candidate: ≤8 candidate draws, ≤8 subsequent
renders/250ms. Results cancel on camera/data/style/visibility/context changes.
Timeout/failure never selects a hidden or stale stop. Normal picking/camera code
creates no independent render loop; pending queries request bounded map repaints.

The full R2 app preview on4326 was checked with actual transport responses and
existing service labels. Navigation/service stacking remained intact; the
TURATI/MAMIANI popup measured280×447.5px, entirely within1280×720, after live
content loaded. No reported console errors. This uses existing local datasets
and read-only canonical data, starts no acquisition worker, and does not change
M2/4317. Synthetic model tests do not claim that every live viewport has vehicles.

All23 Node suites pass; relevant shared-scene/bus tests rerun after final boundary
checks. They cover native recovery, eligibility/stale/visibility semantics,
independent scene ownership and disposal. No backend behavior/dependency changed;
Four map HTTP tests also pass. Final independent spec/standards review covered
the entire R2 range; the picking-row finding and its resolution are below.

### Limits retained for review

Physical iOS/Android measurements and phone-specific thresholds remain pending;
no connected physical-phone runner was available for these checks. Desktop/DPR
checks do not substitute for those. GPU timer/buffer allocation across the entire
MapLibre process and GPU/RSS totals were not measured. Scoped resource counts,
texel arithmetic and submitted draw counts are explicitly narrower evidence.
C, bridges, monument expansion, acquisition, public API changes and delivery
beyond local commits remain outside this execution.

## Final review correction: exact clicked pixel row

The independent Spec review identified a one-row Y inversion error at integer
coordinates. The corrected scissor uses `bufferHeight - 1 - floor(cssY * ratio)`,
including the top row, instead of rounding an already inverted CSS coordinate.
Node regressions verify integer rows and the top edge at DPR1/2. Only the actually
intersected pole/board mesh is queried per candidate, preserving the≤8 pick-draw
ceiling rather than issuing two draws per candidate.

A test-only framebuffer-color oracle in the isolated prototype compares whether
the board changed the exact clicked pixel against the asynchronous query result.
The original inversion reproduces **2/21 mismatches**, including a native-building
silhouette. Corrected inversion gives **0/84**, covering DPR1/2 and AA on/off,
with both visible and blocked cases. The test oracle uses readback outside timing
benchmarks; product picking never uses a blocking readback. After the correction,
the actual production module again passes36 depth cases,20 lifecycle cycles,
13→0→13 owned-resource accounting and context restoration, with no GL errors.
Nine LOD/growth checks at z15–19 have zero camera buffer uploads, at most four
draws, no GL errors, and reject a click outside the actual board silhouette.

## Standards

Independent whole-R2 review found no code violations or material heuristic smells.
Its corrective follow-up found oneP3 documentation issue: renderer byte counts
needed refreshing after the pixel-row correction. Recalculation gives17,427
source bytes and6,799 gzip bytes; the provenance record is updated and budgets
remain satisfied. No open Standards findings. Reviewers did not rerun suites.

## Spec

Independent whole-R2 review found oneP2 exact-pixel Y inversion defect. It was
corrected with DPR1/2/top-row regressions and the real-WebGL edge oracle described
above. The reviewer inspected the refreshed immutable correction and found the
issue resolved, the≤8 pick-draw ceiling satisfied, and no new actionable defects.
No open Spec findings. Phone/GPU limitations remain explicit.

Review totals: Standards1 resolved/0 open; Spec1 resolved/0 open. Both axes reviewed
the same frozen source target; only the directly recomputed byte metadata and
this review-result documentation changed afterwards. No source change followed
review. This evidence supports R2 desktop review, not phone or release acceptance.
