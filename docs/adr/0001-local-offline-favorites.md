# Store complete public favorite cards locally

Status: accepted in the offline-favorites specification (2026-11-27).

A favorite must remain readable after closing and reopening the page without a
connection. An identifier-only list cannot provide that behavior. The user selected
complete local public cards, removal of old details after confirmed withdrawal,
and support for desktop, Android and iOS. Initial acceptance runs on the local PC.

Use native IndexedDB for card records and a dedicated Service Worker/Cache Storage
shell for `/preferiti`. Store only fields consumed by public card presentation;
never retain visitor positions, private contribution data or server credentials.
Namespace cards by territory, canonical mode and stable service identity. Version
both records and the explicit shell cache. Reuse the public detail read contract.

A favorite is offline-ready after the shell and card writes succeed. Failed refresh
keeps the last saved copy; confirmed public 404 scrubs details and retains an
unavailable entry. Refresh writes compare the stored token, so a late request cannot
revive a removed favorite or overwrite a newer mutation. Current opening state is
not inferred from a saved server result.

Storage remains tied to origin and browser profile and may be cleared or evicted.
Offline withdrawal cannot be learned until a successful online read. No server-side
favorites, account sync, offline map or third-party storage library is introduced.

## In-app bookmark experience — 2026-11-27

The user corrected the initial presentation: favorites belong to the app/PWA
experience, with a colored selected bookmark in both service detail and list, and
the same icon in the menu. The menu now selects a favorites view in the existing
app shell. Both controls share one delegated controller and committed storage state;
list row selection remains an independent sibling button. The offline reopening
route retains the same icon and uses the same saved records. This changes the UX,
not the storage or public read contracts.
