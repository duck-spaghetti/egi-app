# Private card and field editor

EGI-108 adds `/moderazione/contribuisci`, rendered with the existing editorial
session, Italian catalog, font/color foundations and CSP. Its external modules own
private draft state (`draft.js`), shared typed controls (`fields.js`), service-card
composition (`card.js`), citation matching (`evidence.js`) and workbench actions
(`editor.js`). No browser persistent storage is used. Database versions, permissions
and retained original bytes are authoritative.

An operator selects or registers a source and can paste the initial material in the
creation form. A blank title derives from the selected source and local date; the
explicit create action persists the preparation and material through existing
contracts. Public-material attestation remains explicit. Existing preparations can
still retain/revise text separately and create blank cards. The card and field layouts edit one payload, including separate
service and location bodies, structured contacts/conditions/hours and disclosed
advanced fields. The shared field dictionary reuses existing editorial vocabularies;
PostgreSQL still validates all writes. Territories use the existing named options;
other advanced reference fields use canonical UUIDs. Broader
catalogue search is not supplied by this editor. A contact's publishability remains
unset until the operator chooses it.

Source/interpretation and card occupy adjacent columns above 640px; smaller widths
stack them. The preparation library sits above the workbench. Card view composes a
service heading, description, hours, access, contacts and source footer using the
same control instances/dictionary as field view. Inline text grows to show content;
advanced fields remain expandable. Moderation reuses the card presentation.

Field citation buttons inspect the retained input version, with exact code-point
offsets and a marked excerpt. They never replace the editable source or silently
normalize offsets. Failed matching is explicitly unverified. Superseded inspection
responses cannot replace a new card/value's context. Manual edits remove citations;
publishability never borrows a contact's quotation. Moderation inspection remains
limited to submitted quotes and filters citations whose proposal value is not the
displayed baseline value. Accepted previews do not reuse original private citations.

Preliminary checks distinguish the name required for submission from the mode,
description and public channel needed later. They are advisory, not a substitute
for canonical validation. Existing paginated item summaries project the authorized
service name as `display_name` (at most 160 characters), without exposing the full
payload or adding per-card requests. Navigation uses these names immediately and
preserves the current local name during editing. Advanced canonical references still need a separate readable-search
contract decision. These remain explicit UX limitations.

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

Follow-up on 2026-11-27: the sidebar's native input/select/fieldset minimum widths
are constrained to its grid column. With the creation form expanded at the actual
1280px browser width, all six visible controls fit and none overlaps the card.
The browser's requested narrow viewport did not take effect (it remained 1280px),
so this follow-up does not establish mobile behavior. The existing CSS breakpoint
is retained. No state/permission behavior changed.

UX follow-up: source/card columns were measured at 272px/408px in the actual 740px
viewport, with no horizontal page overflow. Browser checks cover direct edits,
card/field switching, reopen, precise source highlighting, nested collection
redraw, initial text/automatic-title persistence and name-only explicit submission.
The full application suite ran 185 tests: 179 passed, six external-prerequisite skips.
Four actual-module Node checks pass, including Unicode/BOM/CRLF and prevention of
borrowing proposal citations for baseline values. Small-screen behavior below 640px
is not established by a browser measurement. Independent milestone review and the
human corpus/live-provider gates remain pending.
