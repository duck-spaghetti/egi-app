# Saved-place implementation checkpoint — 2026-11-27

Status: local implementation checkpoint requested by the user after the session
retrospective. This is a save point, not release acceptance or permission to merge.

## Resume here

- Repository: `egi-app`; branch: `ms/offline-service-list`.
- Worktree: `/Users/marco-macbook/dev/project_egi/.scratch/worktrees/egi-app-offline-list`.
- Original base: `a75bd0ec726df817ac082a6b032b608c1aa38616`.
- The commit containing this document captures the implementation below. Resolve
  its SHA from branch history rather than treating the original base as the save.
- Local preview URL: `http://127.0.0.1:4335/map`.
- Runtime PID/worktree metadata and logs are under the parent workspace's
  `.local/favorites-demo/`. Verify the recorded process before restarting it.
- The preview uses the canonical B1 reader database. Runtime files, browser data
  and the database are outside this Git checkpoint. This is not a browser-storage
  backup, and restarting the preview is separate from restoring source code.

## Current behavior

1. Preferences → Preferiti opens the existing app sheet at `/map`, without a
   separate collection-management page in the menu.
2. The sheet groups saved POIs by Favorites and named collection. A POI can belong
   to several collections independently. The footer keeps new-list creation visible.
3. Result rows, saved-group rows and detail headers share one bookmark flow. Its
   dialog offers Favorites, an existing collection or a new collection; existing
   memberships are marked. Color indicates membership in any list. Removing one
   membership preserves the others.
4. Saved-group rows reuse the normal service-result renderer and information.
   Catalog cards are reused when available; offline copies retain explicit dates,
   content language and unknown current opening state.
5. Each group offers map and print actions. The filtered map shows its group name,
   Torna alle liste and Tutti i servizi. The list view also has a direct return.
6. Native IndexedDB stores public snapshots and collections in separate territory
   namespaces. Confirmed withdrawal scrubs saved details on refresh. Compare-token
   updates prevent late refreshes from reviving removed memberships.
7. The narrow offline worker serves the saved-card/collection fallback routes;
   it does not cache the complete map or API responses. Existing fallback pages
   remain, but the main app menu uses the integrated sheet.
8. Text zoom uses the Aa preference, 100–200% in 10% steps, local persistence and
   a conditional reset. Map geometry does not scale with the text.
9. Print/save-PDF prepares the selected collection with expanded public information,
   sources and timestamps. Saving the actual PDF is a native browser user action.

## Acceptance evidence and limits

Fresh checkpoint checks on the saved source state:

- Python discovery: 142 tests, OK, 13 existing configured skips; exit 0.
- All 14 JavaScript suites: PASS; exit 0.
- `git diff --check`: exit 0.

The configured test-only httpx deprecation remains visible. No dependency upgrade
was performed to suppress it.

Native desktop journeys in this session verified the integrated sheet, shared
service rows, bookmark destination selection, independent memberships, map filtering
and direct return. Earlier offline testing stopped only this preview's server,
reopened the cached fallback, created a collection and added an existing saved card.
The server was restored afterward. Three QA collections remain in browser storage;
existing user favorites were preserved.

Actual PDF saving/pagination, physical Android/iOS, installed-PWA behavior and full
Arabic print layout remain unverified. There is no operator-account model or
cross-device synchronization. The main map is not established as offline-ready.

Independent reviews covered earlier collection/storage snapshots and their fixes.
The subsequent integrated-panel/shared-row/navigation corrections have automated
checks and native desktop self-review; do not describe the earlier independent
reviews as coverage of this entire final checkpoint.

## Authority and next work

The user authorized direct feature implementation without new specifications or
tickets, then requested saving the current implementation and drafting the six
retrospective improvements. This checkpoint permits a local commit only; no push,
PR, merge or deployment is included.

The retrospective improvements are a separate draft under the parent workspace's
`.scratch/agent-workflow-improvements/`. Their specification is not implementation
approval. Tracker destination, browser-test tooling, CI/hook adoption and related
rule changes remain decisions for that draft's approval.

See [collection evidence](local-collections-verification.md) and
[favorites evidence](offline-favorites-verification.md) for the historical journeys.
This checkpoint describes the current state where those chronological records
contain superseded UI descriptions.
