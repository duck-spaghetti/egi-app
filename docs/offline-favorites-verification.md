# Offline favorites — local verification, 2026-11-27

Implementation: `ms/offline-service-list`, worktree
`project_egi/.scratch/worktrees/egi-app-offline-list`, based on fetched
`origin/dev` `a75bd0ec726df817ac082a6b032b608c1aa38616`.
The user approved specification r0.1, explicitly skipped tickets and authorized
whole-set implementation in this session. No commit, push, PR, merge or deployment
was performed. The reference checkout and other worktrees were preserved.

## Automated evidence

Using the existing workspace `.local/venvs/app-a3` environment:

- `python -m unittest discover -s tests -v`: 142 tests, OK, 13 declared skips.
  The unavailable native database/live HTTP prerequisites remain skipped; no new
  database was provisioned or migration executed. The existing TestClient/httpx
  deprecation warning remains.
- Every `tests/test_*.cjs` via `node --experimental-vm-modules`: eight suites passed,
  including the new favorites suite. Node reports its existing experimental VM
  Modules warning.
- `git diff --check`: passed.

Focused checks cover public-field filtering, protected addresses, duplicate saves,
network/server/invalid-payload failures, canonical versus preview 404, withdrawal
and republication, coalesced refresh with at most three requests, removal/newer-write
races, territory isolation, failure propagation from shell/storage, retryable worker
readiness, newest-worker selection and exact/encoded asset allowlisting. HTTP checks
verify shell delivery, worker scope, every offline asset and the imported module graph.
Quota failure is injected at the domain seam; actual browser quota exhaustion has
not been forced.

## Desktop browser evidence

Used a disposable synthetic canonical app, no PostgreSQL connection, on the isolated
origin `http://127.0.0.1:4333`, through the Codex in-app browser. Browser user agent:
Chrome/157.0.0.0, AppleWebKit/537.36, Macintosh. This is desktop evidence, not an
Android or iOS device test.

Observed:

1. Save two synthetic public cards and save one again: two entries, no duplicate.
2. Stop the owned fixture server, close the favorites tab and create a new tab at
   `/preferiti`: the interface, both entries and full saved details remain readable.
   Removing a favorite also works with the fixture server stopped.
3. Restart the fixture and change a public description: Refresh replaces the saved
   text. Return an authoritative canonical 404: old name/description/contacts disappear
   and the entry becomes unavailable. Republication restores the card.
4. Native IndexedDB probes through the actual `createStore` adapter: transaction
   commit is readable after resolution; a non-cloneable write aborts; missing storage
   rejects; previous entries survive; an open lower-version connection produces a
   visible blocked-upgrade rejection. These probes use disposable test data.
5. Keyboard Space toggles the actual map-sheet favorite control; focus returns to
   the reenabled control. With a two-second fixture response delay, focus on an
   expanded saved-card summary survives the automatic refresh and stays on SUMMARY.
6. At a 390 × 844 CSS-pixel viewport, document content width equals viewport width
   (390 px); no horizontal overflow. The viewport override was reset afterward.
7. On final shell v2 with the server stopped, reopen the page and select Arabic:
   interface dictionaries load offline, document language becomes `ar`, direction
   becomes `rtl`, and saved card language remains explicitly IT. Switch back to Italian
   and open a saved detail successfully.

The fixture server was stopped and its browser tabs closed after testing. No system
network setting or other session's server was changed. The entire browser process
was not terminated; close/reopen evidence refers to tabs/pages.

## Measured size and latency

Final-code sample in this browser on the synthetic fixture:

- Two favorite records serialized: 3,665 UTF-8 bytes (content dependent).
- Offline shell v2: 35 explicit resources, 145,518 response-body bytes, zero API
  responses cached. This includes the four existing UI dictionaries and local icons.
- One save with the shell already installed: 34 ms, measured around the complete
  `favorites.save` call with `performance.now`. This is one local sample, not a
  mobile/network performance budget or percentile.

The base has no favorites path, so there is no like-for-like pre-feature save timing.
Existing map/service regression suites pass; no mobile performance claim is made.

## Review and limits

Independent standards and specification reviews found and resolved encoded-icon
matching, noncanonical 404 withdrawal and keyboard focus defects. Follow-up review
of the changed snapshot reported no remaining actionable findings.

Android Chrome and iOS Safari remain product targets; physical-device verification
is outstanding. The first save needs an online, secure origin (loopback for this
local slice), browser storage permission and sufficient space. Site data may be
cleared or evicted. Offline clients cannot learn withdrawals until a successful
canonical read. External phone/website actions still require their normal device
or network capabilities. No cloud sync, offline map, PWA installation, live data
acquisition or release is part of this verification.

## Integrated bookmark UX follow-up — 2026-11-27

The user corrected the initial presentation and explicitly placed favorites inside
this app/PWA experience. This section supersedes the initial text-button/menu-link
journey above. Membership now uses one outline/accent-filled bookmark in list rows,
service headers, the menu and offline view. The menu opens Favorites in the same app
shell; All services returns to the catalog. No independent product or account store
was introduced.

Final changed-state checks: 142 Python tests, OK with 13 declared prerequisite skips;
nine Node suites pass, including `test_favorite_controls.cjs`; `git diff --check`
passes. After the last menu-border/cache-version adjustment, the affected favorites
Node and HTTP suites passed again. The controller regression checks committed-only
selection, shared list/detail state, escaped accessible labels, per-service in-flight
deduplication, persistence failure, disposed-page isolation, reconnect forwarding,
withdrawn detail clearing and stale-catalog removal. Independent standards/spec
reviews of the UX delta and subsequent fixes report no remaining actionable findings.

Desktop Chrome 157 native-browser observations on the actual app worktree, using
594 B1 public services through the existing reader-only login at loopback port 4335:

- Add via a list-row bookmark: it becomes selected without opening the service sheet.
  Open that sheet: its bookmark reflects the same selection. Remove in the sheet:
  both bookmarks become unselected. Re-add successfully.
- Menu uses the same bookmark symbol. Opening Favorites preserves the existing
  map/list shell and displays the selected service. Remove its last entry: the empty
  state appears. All services restores the 594-service catalog and add control.
- At 390 × 844 CSS pixels, content width and viewport width are both 390 px, with zero
  nested buttons. The selected icon remains visible in the list and detail header.
  The temporary viewport override was reset.
- With the final shell v5 installed by a successful real-service save, stop only the
  owned 4335 demo server and open `/preferiti` in a new tab: the public real service
  and selected bookmark reopen successfully. The demo server was restarted afterward.

Separate disposable 4333 failure scenarios also pass: force an empty live catalog
and public-detail 503 responses, then open Favorites in an English interface. The
saved Italian cards remain listed with explicit saved-copy notice, timestamp and
IT language. Trigger a delayed canonical 404 while one saved service's sheet is
open: the sheet closes, its detail body becomes empty and only an unavailable entry
remains. That fixture server was stopped and its tabs closed after the check.

The active in-app favorites view refreshes on reconnection and its normal refresh
cycle. Unavailable identifiers scrub stale live-catalog entries and all retained
selected-sheet markup. Repeated favorite refreshes are coalesced. Fallback list rows
and detail headers expose their timestamp/language and unknown current opening state.

An instrumented native audit of shell v4 (before the final menu-border adjustment)
reported 37 resources, 152,298 response-body bytes and zero API responses cached.
Shell v5 has the same explicit resource graph, including the shared bookmark SVG
and controller, verified by the HTTP/import-graph checks.

A repeatable Node rendering microbenchmark ran the actual service-list renderer on
594 synthetic canonical cards: five warmups and 20 measured samples. At the fetched
base a75bd0e, median HTML-generation time was 66.42 ms (range 65.14–72.07), with 462,506
UTF-8 markup bytes. The final bookmark implementation measured 64.41 ms
(range 63.71–73.58), with 758,098 markup bytes. The environment substitutes the DOM
container and event targets; this excludes real DOM parsing, layout and paint. The
similar timings are not evidence of a browser speedup, and the additional markup
is the explicit cost of the 594 independently labeled bookmark controls.

The real read-only demo remains running at `http://127.0.0.1:4335/map?lang=it`, from
this worktree. One public service is saved in the demo browser profile to show the
selected state. The browser tab is retained for the user. Android/iOS physical-device
verification, actual quota exhaustion, commit and remote delivery remain outside
the evidence/grants recorded here.

## Empty favorites navigation correction — 2026-11-27

Reproduced on the native desktop preview: opening empty favorites and switching
back to the map hides the list header's only catalog-return button. Added a
catalog-return action to the menu whenever favorites are active, plus an explicit
button in the empty list. Returning closes the menu, resets the favorites filter
and restores focus to the visible view control or list title.

Verified both native browser paths: empty-list button → 594 catalog results;
empty favorites → map → Menu → Tutti i servizi → complete catalog again.
The shared-controls regression suite now checks the menu exit in both map/list
states and its removal outside favorites. Shared controls, service journeys and
the two favorites HTTP checks passed; git diff --check passed.

Future product direction requested by the user: “Le tue liste”, allowing multiple
collections of POIs (potentially for operators), with PDF export. This is recorded
as future work in that correction. The subsequent user instruction “Ok implementa”
authorized the implementation recorded in [collections verification](local-collections-verification.md).
