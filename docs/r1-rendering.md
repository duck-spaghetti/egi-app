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
