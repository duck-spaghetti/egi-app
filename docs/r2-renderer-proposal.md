# R2 shared transport rendering proposal — EGI-122

Status: approved by the user on 2026-11-27; isolated experiment passed.
See [execution/evidence](r2-rendering.md). Original proposal and cost estimates
remain below as the decision baseline, not measured product claims.
Date: 2026-11-27. Owner: app. Tickets: EGI-122 → EGI-123 → EGI-124.
Specification: [rendering/catalogue r0.3](https://linear.app/aquaradja/document/map-rendering-and-catalogue-performance-specification-r03-f07ab117ab7c).

The user accepted R1 and authorized R2 whole-set with local commits only. This
proposal is the first R2 deliverable. EGI-123/124 remain behind EGI-122's concrete
renderer/asset/test-boundary approval. Worktree: `.scratch/worktrees/egi-app-r2`,
branch `ms/readable-map-transport`, from accepted R1 `1308db0`. Fetch succeeded;
`origin/dev` remains `a75bd0e`, before the local M1/M2/R1 chain. No integration,
product change, dependency installation, asset acquisition or preview change is
part of this design commit. M2 and port 4317 remain untouched.

## Recommendation and alternatives

Recommend one small **WebGL2 MapLibre custom layer** shared by signs and buses,
with instanced app-owned geometry and one original lettering atlas. Use no new
library, model download, font download, converter or build tool. This is a
bounded transport module, not a replacement for the map renderer. Before
adoption, run the disposable integration experiment below: shared-depth picking
is feasible at the API level but has not been demonstrated in this scene.

| Approach | Fit | Cost and decision |
| --- | --- | --- |
| Current native extrusion sources | Existing depth/picking integration, no dependency | Retain as baseline and recovery path; current prism lettering does not meet rotating textured words/shared-model acceptance. Recoloring alone is insufficient. |
| One raw WebGL2 custom layer (recommended) | Instanced poles, rotating boards and reusable bus mesh in the current map/context | No added engine bytes; we own shaders, buffers, state restoration, projected picking and lifecycle. Less dependency weight is a design fact; lower total CPU/GPU cost is unmeasured. |
| One Three.js renderer in a MapLibre custom layer | Existing instancing, mesh/matrix utilities, raycasting and resource abstractions | Credible alternative if low-level maintenance is excessive. Adds a dependency and vendoring/version/license work; byte cost not measured. Raycasting alone does not include native buildings, so the occlusion problem remains. Would need a new user decision. |
| deck.gl interleaved integration | Supports shared-context map visualization | Additional integration/layer stack for this narrow task; no verified end-to-end solution for this app's board geometry and building-aware picking. Not selected or benchmarked. |

Research covered local production/test mechanisms and official MapLibre,
Three.js, deck.gl and WebGL documentation. No package was installed and no model
catalogue was acquired. This is an alternatives assessment, not an exhaustive
registry survey. Three supports instanced geometry/material reuse; deck offers
interleaved map rendering. These capabilities do not establish app performance.
[Three instancing](https://threejs.org/docs/pages/InstancedMesh.html),
[deck integration](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay).

## Existing responsibilities and proposed interface

Keep transport acquisition, station summaries, OSM entrance association, stop
identity, line selection, popup ownership and fitting in `transport/layer-gl.js`
and its existing helpers. Keep vehicle fetching, observed positions, ages,
staleness, visibility/zoom gates, filters and current snapshot transition semantics
in `buses/index.js`. Do not add prediction, change timers or expand feed access.
The rendering replacement consumes the same eligible observations; it does not
reinterpret an unavailable bearing or invent movement.

Proposed internal interface (not a new HTTP/public API):

- `createTransportScene({map, maplibre, onStopSelect})` installs/owns one layer
  after native building volumes and before map symbol layers. No second canvas,
  context, camera scheduler or animation loop.
- `setSigns(records)` accepts deduplicated `{key, mode, coordinates, focused}`
  instances from the existing entrance/stop path. Keys and source coordinates
  are unchanged; entrances remain separate physical instances while HTML metro
  summaries remain unique. No tile-query duplicates become extra objects.
- `setVehicles(records)` accepts eligible `{id, coordinates, bearing, old}`
  observations from the existing bus owner; route labels retain their current
  identity and freshness styling. Empty arrays clear only that owner's objects.
- `dispose()` removes listeners/layer and releases owned programs, VAOs, buffers,
  texture and pending queries exactly once. Clearing one transport layer must not
  dispose the other owner's objects. No caller manipulates GL handles.

`createMap3d` owns this module once per map and provides it through the existing
`attach` context and transport composition. A small adapter at each existing
consumer replaces native physical rendering; DOM presentation remains upstream.
Avoid per-consumer renderer factories or a global singleton. The module hides
coordinate conversion, instancing, picking and resource recovery behind these
three operations. Tests cross this same interface; any GL command recorder is
injected at the context seam, not exposed as a production diagnostics API.

### Camera, batches and depth

Target the **vendored MapLibre 6.19.0** interface, `render(gl, options)`, using its
public Mercator matrix. `renderingMode: '3d'` shares native depth; the module must
establish its other GL state and handle add/remove and context loss/restoration.
The current app is Mercator without terrain. Globe/terrain support is outside R2;
unsupported projection selects fallback. Do not use private `map.transform` or
copy old `render(gl, matrix)` examples. [Pinned interface](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/v6.19.0/src/style/style_layer/custom_style_layer.ts).

Use a fixed city-local origin and per-anchor Mercator metre scaling to avoid
large Float32 world translations. Keep exact longitude/latitude in the CPU
snapshot. No snapping to streets, elevation inference or source mutation.

Proposed normal passes: instanced poles, instanced boards, near bus mesh and
simple distant bus mesh: at most four draws with nonempty batches. Colors/mode,
old opacity and atlas region use instance/vertex attributes, not one material or
texture per object. One shader program can serve these passes; flat shading and
simple existing-style directional illumination only. No dynamic shadows, animated
wheels or independent Three camera. Camera callbacks update uniforms; rotation
must not rebuild a source, instance buffer, atlas or mesh.

Board yaw follows camera bearing around its own vertical axis; poles and ground
anchors remain fixed. Keep board fronts readable with correct UV/winding at all
four bearings; no mirrored back lettering. Preserve existing size/fade policy
(start z16, full z16.6, current sign scale 6.4), replacing prism glyphs with full
words: yellow bus pole/board + blue panel + white `bus`; dark-green tram
pole/board + white `tram`; distinct red/white metro. Near-zoom appearance remains
progressive with the trees. Bus near/distant transition must preserve recognition,
scale and heading; initially test z15–19 with near model from z16, smooth transition
around z16, and never draw two opaque coincident bodies. Exact transition is a
visual acceptance choice within the proposed scenario, not measured evidence.

DOM discovery markers remain visible through buildings, keyboard operable and
owned by existing presentation helpers. Service labels stay above transports,
popups above services and navigation above both. Native depth applies to physical
geometry, not to HTML discovery. No new bus/tram name labels are added.

## Physical-sign picking: explicit integration experiment

Custom meshes are not registered as native source features. Retaining the old
`queryRenderedFeatures` handler without a replacement would break selection.
A standalone CPU hit test or Three Raycaster cannot establish occlusion by native
MapLibre buildings. Do not use invisible native proxy volumes as proof of exact
rotating-board visibility.

Proposed method, **unverified in the actual map**:

1. On a map click not already consumed by a service/reference/DOM stop, CPU-test
   the actual transformed sign triangles at that exact screen point and order
   intersections by depth. No approximate bounding-box hit is sufficient.
2. Queue a revision-bound request for the next MapLibre render. Before drawing
   the scene's own transparent geometry, use native building depth in the shared
   main framebuffer. For the candidate sign's real triangles, enable a one-pixel
   drawing-buffer scissor and issue `ANY_SAMPLES_PASSED` with color and depth
   writes disabled. Keep the same projection, growth, alpha eligibility and depth
   function as the visible pass. No framebuffer clear or blocking pixel read.
3. Restore all touched state. Check `QUERY_RESULT_AVAILABLE` in later map renders;
   only then read the result. A query cannot become available in the issuing
   event-loop task; do not busy-wait or assume one later callback suffices.
4. Bound the request to eight candidate signs, eight subsequent renders and
   250ms. Request repaint only while pending; render callbacks check the deadline.
   One cancellable deadline timer may end the request while the page is hidden;
   it does not render. Cancel on camera, snapshot, visibility, style or context
   revision changes and disposal. A timeout/unsupported query gives no physical
   selection; the accessible HTML discovery path remains available.
5. Open the existing popup only after a positive result for the nearest eligible
   visible candidate. Preserve click-consumption precedence so the same click
   cannot open a route popup while the asynchronous stop query is pending.
   A miss does not later replay a stale route click. Document this small physical
   selection latency; DOM stop selection remains immediate.

WebGL2 exposes exact occlusion queries; scissor uses lower-left drawing-buffer
coordinates, requiring correct DPR/Y conversion. These mechanisms support the
proposal, not a claim that its implementation works. [Query specification](https://registry.khronos.org/webgl/specs/latest/2.0/#3.7.12),
[scissor](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/scissor).

The **disposable experiment needs approval**. It may live only under
`.scratch/prototypes/r2-transport-renderer/`, use retained local data and an
isolated fixture/port other than 4317, 4323 or 4324, and install nothing. It must
show, on the pinned vendor build: building in front blocks clicks; unobstructed
boards/poles select the correct source; overlapping signs select the nearest
visible one; transparent onset is not picked; no framebuffer damage or GL errors;
DPR1/2, AA on/off, bearings 0/90/180/270 and pitch0/45/60; cancellation, timeout,
context loss/restoration and 20 mount/toggle/dispose cycles. Test native building
parts and iconic volumes at the chosen layer order, not just synthetic occluders.
Query equality/MSAA edge precision and translucent self-occlusion require checks.

If this fails, report the result and revisit architecture. Do not ship click-through
buildings, private-depth access, a second render loop or native-only recoloring as
silent substitutes. Approval of the experiment permits adoption only if the
proposed public-API design passes these checks without a material change.

## Assets, licensing and conversion

Recommend original deterministic app-owned meshes and lettering paths: one pole,
one board, one reusable bus with windows, wheels and distinct windshield/rear.
Retain the current schematic enlarged sign/bus dimensions initially. Build near
bus geometry once, target 200–300 triangles with a hard proposal ceiling of 500;
distant silhouette at most 24 triangles. Mesh color/UV data is shared. No glTF
loader, external model, texture pack, transport logo or downloaded font is needed.

Create an original editable SVG panel/lettering atlas, nominal 256×128, covering
`bus`, `tram`, `M` and white/color swatches, rasterized once per scene and uploaded
once. Use original vector paths instead of browser/system-font rendering so the
same lettering needs no font or font-license acquisition. Keep editable source,
output dimensions, deterministic conversion recipe and checksum in asset provenance.
Use existing browser image/SVG facilities; no new conversion dependency. Bound the
atlas to 512×256 if readability requires it; larger or third-party assets need a
new decision. No original artwork/model is created in EGI-122.

Record app-original authorship/provenance under the repository's existing terms,
without inventing a new repository license. Keep MapLibre's existing notices.
If Three is chosen instead, pin/review its release and retain its MIT notice;
that dependency is not authorized by this recommendation.
[Three license](https://raw.githubusercontent.com/mrdoob/three.js/master/LICENSE).

## Cost register: measurements, estimates, proposed budgets

Baseline measurement: macOS15.5 arm64, Node26.13.1, unchanged `signGeometry` at
accepted R1 `1308db0`, 25 builds per scenario, 100/300 unique synthetic stops per
mode; no focus highlight. Local raw output: `.local/r2/native-sign-baseline.json`.
Bytes are serialized GeoJSON bytes generated in memory, **not transfer/GPU bytes**.
Timing is pure geometry construction, not serialization, worker update or frames.

| Mode | Prisms/sign | 100 signs: GeoJSON bytes | 300 signs: GeoJSON bytes |
| --- | ---: | ---: | ---: |
| Bus | 19 | 685,382 | 2,057,196 |
| Tram | 13 | 468,516 | 1,406,922 |
| Metro | 24 | 868,279 | 2,607,214 |

The current bus source uses 18×4m boxes and 4.8m layer height (code inspection).
No new browser/GPU timing or phone measurements were taken for this design.
R1's measured gesture figures are historical context, not R2 evidence.

| Item | Estimate/basis | Proposed acceptance ceiling, not an achieved result |
| --- | --- | --- |
| New dependency | None in recommended design | Zero new runtime packages/build tools |
| Atlas | RGBA 256×128 =128KiB; with full mip chain about171KiB | ≤512×256, about683KiB including mipmaps; compressed output ≤64KiB, measure actual |
| Shared meshes | ≤500 near-bus triangles, ≤24 distant, ≤24/sign; exact indexed vertices/UVs TBD | Mesh buffers ≤128KiB; original asset source+atlas transfer ≤128KiB; report actual |
| Instances | Estimated 48 bytes/instance: 300 signs +300 buses ≈28.1KiB; growth/capacity overhead excluded | Allocated instance buffers ≤128KiB at combined300+300; no per-object resource ownership |
| Draw calls | Up to4 nonempty normal batches independent of object count | ≤4 normal draws; click adds ≤8 bounded candidate-query draws, tracked separately |
| Renderer module | Approximately10–25KiB source estimated from limited shader/lifecycle scope; not a measured saving | ≤32KiB source, ≤16KiB gzip incremental JS; if complexity exceeds this, revisit raw-vs-library tradeoff |
| Per-frame CPU | Instance uploads only on snapshot change; camera updates uniforms | Proposed R2 render CPU p95≤1ms at100 signs+100 buses, ≤2ms at300+300 on benchmark desktop; measure with R1's work separately |
| Initial preparation | One shared allocation/upload, no model decode/download per object | Proposed CPU p95≤25ms at100+100 and ≤50ms at300+300, report cold/warm load separately |
| Frames/heap | Existing ≥30FPS and reported JS heap<150MB remain mandatory | Desktop steady gesture frame p95≤33.4ms; compare slow-frame counts before/after. No GPU/RSS savings inferred from JS heap |
| Picking | Asynchronous query, no mandatory full-frame picking target | ≤8 candidates/8 renders/250ms; exact occlusion and zero stale-result selections, latency distribution reported |
| Physical phones | No fresh device baseline | Measure before/after on available iOS Safari and Android Chrome; retain ≥30FPS floor, establish precise device p95/initialization targets after baseline. Pending phones preclude final phone acceptance |

These ceilings are a **proposal for the architecture gate**. The user previously
confirmed broader budget direction, not these concrete atlas/model/renderer/phone
choices. Approving desktop ceilings cannot waive existing phone acceptance or
stricter regression floors. No performance improvement is claimed before matched
browser measurements, including partial fading/overlapping transparent signs.

## Verification and delivery after approval

Use existing Node VM/module/lifecycle tests for the shared module interface,
identity/deduplication, matrices/bearings, unchanged camera-only upload counts,
byte/triangle/draw bounds, resource deletion, revision cancellation and fallbacks.
A GL command-recording fake proves calls/ownership, not GPU depth. The approved
browser experiment is the necessary second test seam; do not replace it with mocks.
No test dependency is proposed.

Compare current native and proposed renderer with identical retained dataset,
viewport, DPR, path and source coordinates: normal scene;100/300 unique signs;
20/100/300 vehicles;combined100+100 and300+300. Separate unique objects from tile
query duplicates. Record cold/warm initialization, JS bytes, texture allocation,
geometry/materials, upload/source-update CPU, normal/picking draw calls, render CPU,
frame p50/p95, gaps>33.4ms, JS heap and scoped GL resources. Optional GPU timer
extension results must be labelled unavailable/disjoint when unsupported. Raw GL
resource accounting is scoped allocation, not total GPU memory.

EGI-123 delivers the real shared layer with signs, atlas, click integration and
fallback. EGI-124 adds its reused bus mesh/instances and combined benchmarks.
Preserve existing route labels, service-label foreground, popups, station summaries,
entrance coordinates, filters and stale/removal behavior. Fallback after shader,
texture, capability or restoration failure atomically removes the failed custom
layer and restores current native physical representations; it does not draw both.
DOM access stays available throughout. Fallback is degraded continuity, not R2
visual acceptance; failed target scenarios remain reported failures. Fail-closed
physical picking can retain custom visuals only as an explicit degraded state,
never as a passed R-AC4 result.

Context restoration rebuilds owned resources once from retained CPU snapshots;
disposal never loses/destroys MapLibre's context. No idle continuous repaint.
Twenty layer/mode cycles must return scoped live buffer/texture/program/query and
listener counts to the same baseline. Real GL error/depth/resource recovery
checks accompany Node counters.

## Gate to close before EGI-123/124

Approve or revise this concrete package:

1. One dependency-free WebGL2 custom layer and the internal interface above,
   including asynchronous exact-depth picking and native recovery policy.
2. Original procedural bus/sign geometry plus original SVG lettering atlas,
   without third-party asset/font acquisition or additional conversion tools.
3. The isolated no-dependency experiment and two verification seams; adoption
   follows only after the proposed public-API approach passes. Material changes
   return to the user, not an automatic architecture fallback.
4. Proposed concrete desktop/asset ceilings; phones remain an explicit measured
   baseline/acceptance step, not presumed passed by the desktop experiment.

R2 whole-set/local-commit execution resumes after this gate. No C work, bridges,
monument expansion, dependency installation, push, PR, merge or preview mutation
is implied by this proposal. The final R2 milestone review remains required.
