# Private card and field editor

EGI-108 adds `/moderazione/contribuisci`, rendered with the existing editorial
session, Italian catalog, font/color foundations and CSP. Its external modules own
private draft state (`draft.js`), typed controls (`fields.js`) and workbench actions
(`editor.js`). No browser persistent storage is used. Database versions, permissions
and retained original bytes are authoritative.

An operator selects or registers a source, creates a preparation, retains text and
creates a blank card. The card and field layouts edit one payload, including separate
service and location bodies, structured contacts/conditions/hours and disclosed
advanced fields. The shared field dictionary reuses existing editorial vocabularies;
PostgreSQL still validates all writes. Reference fields use canonical UUIDs. Broader
catalogue search is not supplied by this editor. A contact's publishability remains
unset until the operator chooses it.

Debounced saves use exact item versions. An in-flight request has an immutable body
and request key; a network/server uncertainty retains that attempt for replay. Edits
made while saving stay dirty and follow the acknowledged version. Manual and cleared
origins are recorded, and editing a value removes its related private citations.
The evidence panel updates immediately. Field clearing removes the value rather than
inventing a replacement.

A concurrent write preserves local values and stops autosave. Explicit comparison
shows each collision and requires local/remote choices before rebasing onto the
latest server version. Unrelated remote values survive. Read grants disable mutation
controls; editor grants cannot manage sharing or whole-preparation trash. Database
checks apply even if a client modifies controls. Named sharing/revocation, history,
undo of this page's last saved operation and recoverable workspace/card trash use
the existing private HTTP contracts. Unsaved source text blocks changing preparation;
unload warns for unsaved source/card state. Source originals stay separate from the
selective editorial snapshots.

Verification on 2026-11-26: actual browser journeys on isolated port 4322 covered
preparation creation, retained source, card/field switching, name/description/mode,
contact and explicit visibility editing, save/reload/reopen, and conflict between
two windows with an explicit successful local choice. Native HTTP tests cover role,
revocation, history, undo, exact UTF-8 bounds and CSP-safe source metadata encoding.
The application suite passed 170 tests with six external-prerequisite skips. Node
checks exercise actual draft-state provenance, stable retries, edits during save and
three-way rebase. Final independent milestone review and provider-integrated user
acceptance remain pending. No real provider requests were part of these checks.
