# Browser, offline and print verification

The approved session 2 source base locally integrates saved-list `0566d60` and
Community `3fe17e2` into `ms/development-checks`. Their original branches/previews
are preserved. This is local integration for verification, not acceptance/merge
of either feature into `dev`.

## Reproduce

Activate the app Python environment using the existing runtime/dev/Community
lockfiles, then install the approved locked development tools:

```sh
npm ci
npx playwright install chromium
python scripts/check.py --profile complete --json
```

The current lock selects Playwright Test 1.65.1 and ESLint 10.15.0. PDF inspection
requires the existing `pdfinfo`/`pdftotext` tools (Poppler); missing selected tools
block their stage. Do not install a new PDF library to bypass a prerequisite.
The wrapper selects the current Python for the fixture server; this environment
must provide the existing app dependencies. No provider key or live database is used.

For targeted diagnosis use `python checks/browser.py`, `checks/offline.py` or
`checks/pdf.py`. These are the same required Complete stages. Playwright owns a
synthetic app at fixed loopback origin 4341, refuses an existing listener there,
and creates a fresh context per test. It does not reuse the desktop browser's
profile or existing 4328/4335 previews. `checks/fixture_app.py` composes the real app
factory and substitutes a synthetic canonical reader; Community renders the actual
templates/modules with an explicit synthetic moderator session and intercepted
fixture responses. No mock auth/fixture route is mounted by the production entrypoint.

## Observed boundary

The browser journeys observe menu → empty library → visible exit/focus, result and
detail bookmarks, two independent memberships, one-membership removal, map → lists
→ complete catalog (two distinct services: the unsaved one is excluded in collection
mode and visibly restored on exit), truthful storage/network failures and Community card/field
edits → selective snapshot rendering. They assert controls/content, not an emitted
event alone. A hidden return control makes its visibility assertion fail. The catalog restoration
assertion also rejects an equivalent retained-filter view that conceals the unsaved row. Original
observed focus and stale-membership failures are retained in session evidence.
The fixes preserve the visible menu opener across sheet transitions and rerender
the saved panel after a committed picker change.

Community preserves multiple source names, separate confirmed roles, original
category label and confirmed EGI category across both views and the snapshot page.
An unsent sibling marker is absent from moderation. Fixture transport establishes
the browser/client boundary; actual immutable snapshot/ACL/undo/concurrency claims
still require the native owning checks in milestone Integration.

`strictEnvironment` in the existing Node loader requires declared nodes and rejects
unsupported selectors. The saved-panel integration fixture uses it and demonstrates
missing-node failure plus an explicitly optional absent node. Older focused unit
fakes remain legacy unit-only evidence; they do not establish visible browser paths.
Native-only contribution/moderation suites use `_native.py` names so the existing
discovery selects them for Integration before importing setup; assertions are retained.

Offline coverage opens the actual cached fallback with networking disabled, reads
saved cards, creates/reopens a local collection, and checks that map/API/private
routes are absent from the cache. A failed allowlist fetch prevents a successful
save. The full map, physical mobile and installed PWA remain unverified targets.

PDF tests use actual selected-list presentation/print CSS, generate Chromium A4
artifacts in Italian and Arabic, inspect Unicode, exact source/copy dates, selected
content and pagination, and reject missing/wrong-content files. RTL extraction may
return the date components in visual order; expected day/month/year are retained.
Generated artifacts are independent of native Print/Save dialog acceptance.

Results/traces/screenshots/PDFs live under `.local/browser/`, separated by stage;
the workspace execution record retains source-matched evidence outside temporary
test output. The current eight-card sample spans nine A4 pages in both languages;
page breaks can split source sections. Readability is observed for these fixtures,
not a claim of complete translation or all-print-layout acceptance.

## Representative visual comparison

`node checks/compare_reference.mjs http://127.0.0.1:4317/` captures the retained
prototype at 1440×1000 and 390×844 in a disposable context with the same source,
two organization names, original category wording and uncertain hours. It never
edits the reference files or its normal browser profile. The prototype server is
an explicit prerequisite, not a hidden Complete dependency. CI uses repository
fixtures; the early developer comparison remains separately recorded evidence.

Observed comparison: cream/red palette, serif headings, sidebar, source/card columns
and inline card editing are shared. The integrated editor adds source attestation,
private preparation/card selection, individual roles/resolutions, save state and
selective submission. The prototype has a combined organization field and a simpler
category selection. At 390px the integrated layout stacks source and card vertically;
the extra governance controls make it substantially longer. Moderation includes
the canonical comparison/decision form beyond the editable card. These are visible
differences for final product review, not a declaration of visual equality.

See [owned preview lifecycle](preview-lifecycle.md) and the separate
[native print acceptance](native-print-acceptance.md) procedure.
