# Local collections — 2026-11-27

User authorization: “Ok implementa”, following the requested “Le tue liste”
collections and PDF export. Direct implementation on the existing dedicated
`ms/offline-service-list` worktree, without a new specification or tickets.
No commits, push, merge, deployment or dependency installation were performed.

## Delivered behavior

- Preferences includes “Le tue liste”. Result rows and service detail headers have
  an independent “Aggiungi a una lista” control next to the quick bookmark.
- Local collections support create/select/rename/delete, deduplicated membership
  and member removal. The same service may appear in multiple collections.
- Offline favorites can supply a saved card without a network read, preserving
  its update timestamp. Already present memberships remain unchanged when re-added;
  only refresh changes their current snapshot/withdrawal state.
- The worker allowlist includes the collection shell and dependencies under its
  existing scope. No map, API response, private page or server-side list is cached.
- Printing emits the selected collection, expands source/description details,
  hides editing controls and includes the saved-copy warning and per-card dates.
  The native print dialog offers browser/platform destinations; PDF saving is an
  explicit user choice, not a download the app can confirm.

## Automated checks

The complete Python suite: 142 tests, OK with 13 existing configured skips.
All 13 JavaScript suites passed. New behavioral suites cover:

- collections: CRUD, territory isolation, independent copies, duplicate additions,
  offline copy timestamps, confirmed withdrawal, stale-copy re-addition and races;
- collection picker: pending save, cancellation/reopening ownership and disposal;
- collection page: selection restoration, rename/delete, empty-state navigation,
  native print dispatch and source expansion/restoration.

The offline readiness suite also verifies failed worker updates can fall back to an
installed collection shell. HTTP tests verify the explicit cache graph and all four
localized dictionaries. `git diff --check` passed.

## Native desktop journey

Using the actual canonical preview on port 4335 with 594 public records:

1. Added an existing favorite to “Prova QA · orientamento” from its list-row control.
2. Opened “Le tue liste” via Preferences and verified the full public saved card.
3. Created a second collection, renamed it, and added the same card via the offline
   favorites page. Both memberships remained independently present.
4. Stopped only this preview's server, reloaded the cached lists shell, created
   “Prova QA · offline”, and added a saved favorite to it with the server stopped.
   Its count became 1 and the public copy remained readable.
5. Restarted the preview server. Existing user favorites were preserved. The three
   explicitly labeled QA collections remain visible as demonstration data.

## Review and limits

The two review axes used a captured local working-state snapshot. Standards review
found a pending-picker ownership race; spec review found offline preparation,
offline entry-point and stale-copy issues. All correctness findings were fixed,
covered by regression tests and re-reviewed with no remaining actionable findings.
Shared saved-card wrapper duplication remains a non-blocking maintainability
judgment; inner public-card sections are reused from the existing presentation.

The in-app browser's print invocation did not expose a usable native save dialog
to automation. The dispatch and print preparation are tested, but no actual saved
PDF or paginated PDF layout was verified. Physical Android/iOS, installed PWA print
destinations and full Arabic print layout remain unverified. No operator accounts,
cross-device sync, sharing, custom ordering or offline map were introduced.

## Superseding in-app UX correction — 2026-11-27

The user rejected a separate section and a second add button. The current app menu
opens the existing sheet system at `/map`, titled “Preferiti e liste”. It shows
Favorites first, followed by every named collection and its saved POIs. Each group
has “Vista su mappa” and print actions; “Crea una nuova lista” opens an inline form.
A visible catalog-return control also remains available on the filtered map.

Both detail and result rows now have a single bookmark. It opens a destination
selector with Favorites, existing lists (membership marked with a check) and a new
list. Its color represents membership in any list. Memberships are independent;
removal from the dialog or a group affects only that destination. Existing local
records were preserved. The old dedicated routes remain offline fallbacks and are
not linked as separate sections in the main menu.

Native preview evidence: opened the grouped sheet via Menu → Preferiti while the
URL stayed `/map`; saw the same POI independently in four groups; opened the one
bookmark's selector with Favorites and all named destinations; opened the inline
creation field; used “Vista su mappa”, observed the panel close and map filter,
then used the visible “Tutti i servizi” action to return. Left the grouped panel
open in the preview. Regression checks now include grouped panel routing and
independent removal, bookmark selection through named memberships, the single
bookmark action and menu-to-panel dispatch.

### Shared result rows and explicit map return

User requested the full existing service-list format and reported map navigation
as another dead end. Both normal results and saved groups now call the same
`renderListItem` function. Row selection and bookmark remain independent sibling
buttons, with unique bookmark IDs for each group. The panel delegates row selection
without intercepting the shared bookmark's destination picker.

The filtered map visibly labels its collection and offers “Torna alle liste” next
to “Tutti i servizi”. The list view also has a return action. Native preview
verified category/title/type/address/hours/source rendering in saved groups,
map navigation, visibility of the direct return and actual reopening of the grouped
panel at the same `/map` URL. Regression checks cover both return buttons and their
visibility only while a saved group is selected. All 14 JS suites and 142 Python
tests passed (13 existing skips); diff whitespace checks passed.
