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
classifications reuse the adopted terms with readable names and actual adoption/term references. Organization references use named catalog choices; other legacy advanced references retain their existing controls. Bounded organization and taxonomy search is described below. A contact's publishability remains
unset until the operator chooses it.

Source/interpretation and card occupy adjacent columns above 1100px; smaller widths
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

Prototype-alignment follow-up (2026-11-27): authenticated editorial pages now use a
204px desktop sidebar and 68px topbar, with only functional insertion/catalog/queue
links and the actual signed-in person. Login and public-map surfaces retain their
own layouts. Preparation creation/library controls close when a workspace opens.
The desktop workbench uses the prototype's approximately 316px/672px proportions
at 1280px, and the card presents classification, heading, place/address, description,
hours, access and contacts with expandable structural details. No flat prototype
payload or simulated authorization is used.

Browser verification on the owned 4326 demo at actual 1280px: no page overflow;
manual adopted-category selection survives save/reload/reopen and both views; exact
source passage remains inspectable; no console errors observed. Native HTTP test
also verifies advertised adopted references survive private save/reopen. That historical check covered manual classification only. Entity/category resolution
is implemented below in EGI-119; cross-card clustering remains the provisional CG set.
Visual fidelity, narrow-screen behavior and whole-milestone acceptance remain open.

## Literal organization/category controls — EGI-116

Private v2 cards show source organization names below the service heading and
original category labels separately from the existing canonical-term selector.
Card and field views edit the same current value. Original spelling and exact
source_value evidence remain retained when a correction is manual or the value is
explicitly cleared. A quote button targets the original claim, not the corrected
value. Unresolved names stay visible without a manufactured organization UUID.

Fact value edits record manual/cleared origins and invalidate that fact's stale
selection. Conflict recovery compares local/current fact values by stable fact ID,
remaps the value path when another editor reorders facts, and preserves another
fact's independent correction and quotation. Existing retry/version/save machinery
and ACLs remain authoritative. No field edit starts an IA request.

Moderation receives the submitted source facts and only their relevant quotes.
These literal submitted claims remain read-only there; EGI-117/119 now supply the
separate explicit resolution/acceptance decisions. Canonical fields retain existing editing.
Accepted canonical previews do not display unresolved source claims as accepted
relationships; the original submitted version remains available separately.

EGI-116 historical suite188 run/182 passed/6 external-prerequisite skips; four Node
actual-module checks pass including reordered-fact conflict recovery. Actual browser
on owned4328 confirms organization edit, card/field switch, explicit clear, save and
reopen preserve the original quote; restore and selective submission show both facts
in moderation with exact quote inspection and no console errors. Measured actual
viewports1280 and390px have no horizontal page overflow; temporary override reset.
Screenshots are retained in the workspace community-checks-20261127 folder. These
checks do not assert final prototype fidelity, automatic matching, group quality or
real-provider acceptance. No organization/canonical public record was created.

## Entity/category decisions — EGI-119

`references.js` shares named catalog controls between the editable card and field
views and selective moderation. Original spelling/current value/quote remain distinct.
A source-fact selection can stay unresolved, reject proposals, confirm an existing
organization/category or prepare a minimal new organization. Role is an independent
explicit selection, including a custom nonblank canonical role. Preparing/saving/
sending a new organization creates no canonical entity. A fresh same-name digest
and visible duplicate warning precede confirmation of a separate draft.

A category uses a selected effective territory/release/axis. Provider-context
suggestions appear on materialized cards in the first extraction exchange. Without
context, choose one in place: local suggestions and manual term browsing/search need
no IA. Results are ordinal unconfirmed proposals. One local request compares one
current fact with at most100 references, discloses incomplete coverage and rejects
stale version/value responses. Values over500 characters remain unchanged and
available for manual search; the local automatic comparison does not truncate them.
Organization labels reload in batches of at most100 IDs with50-entry pages.

Controls protect pending manual choices: stale asynchronous results cannot overwrite
corrections, rejected matches or another card. Rebase compares resolutions by fact
identity, surfaces competing decisions and invalidates a choice bound to a changed
remote value. Cleared/changed values remove confirmation metadata. Existing role and
classification arrays remain canonical baseline data until explicit acceptance.

To add a literal manually, select the saved source text and use Add organization or
Add label, choosing service/location scope. The server prepares an unsaved fragment
from retained bytes, minting IDs and deriving its exact quote/hash/span. Textarea LF
positions and Unicode code points map back to original CRLF/CR/BOM-decoded offsets.
The ordinary expected-version save then persists the fragment; the helper itself
has no write effect. No browser persistent storage or provider call is introduced.


All catalog continuations share one bounded paging control. Reaching the final page
disables continuation; changing the search requires a new search rather than
continuing an obsolete offset. A pending request makes its current reference panel
inert without restoring outdated button states. Database change029 makes undo
restore a literal while leaving a changed-value or stale-head resolution unresolved;
it preserves the immutable earlier decision and the undo receipt.
