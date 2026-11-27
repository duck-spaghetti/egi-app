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
