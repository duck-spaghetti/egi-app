# Submit and review private cards

EGI-111 completes the local editorial bridge. A confirmed card can be explicitly
sent from Contribuisci. Its immutable selective snapshot enters the existing queue;
submission creates no canonical service or publication. The response links to that
proposal. Editing afterward creates a private version; another explicit send links
an update instead of a second logical service.

`POST /moderazione/contribuisci/api/preparazioni/{id}/invii` accepts
`{request_key,items:[{item_id,expected_version}]}` (1–1,000 distinct items). The outer
key seeds deterministic per-item keys (`UUID5(key,item_id)`); each item is a separate
verified transaction/receipt. Retrying that item with its original version is stable;
reusing its key with a changed version conflicts. A retry may contain the unresolved
subset. Successes survive a later exclusion or transport failure. The response lists
`submitted` receipts or safe `excluded` codes/status/request identifiers. Hidden
workspaces return 404 before processing; grants are checked again for every item.
No request holds one canonical transaction across the entire selected set.

The queue routes Community contributions to a selective review view. It reads only
`read_community_snapshot`, the submitted source metadata and already-authorized
canonical heads/aggregates. It never reads the original input, private siblings or
preparation history. The snapshot's own immutable resolution makes accepted proposals
read-only. Their preview shows the accepted service revision, with the submitted
snapshot retained in a separate expandable view. A linked location preview uses
its current authorized working/public body. The canonical workspace remains the
place to compare/publish.

New services start from submitted values. Existing services start from the complete
current canonical baseline; proposal fields require explicit selection. Selecting
proposed collections merges by component identity/appends entries, preserving other
components. Editable card/field previews and a before/after comparison show the final
values. The decision uses exact working/public heads and selected submitted citation
IDs. Canonical proof is never accepted from caller JSON. Changes without matching
submitted evidence require an explicit method/note/verification choice, recorded by
the database as the actual moderator's observation. No automatic EGI attribution is
attached to every field. Contacts need explicit visibility.

The card presentation is shared with preparation. Field-level citation inspection
shows only submitted quotes, never the original input. Citations are hidden for a
different baseline value/component and for the accepted canonical preview; the
immutable original snapshot/evidence remains separately inspectable. This display
filter does not replace authoritative server-side evidence matching.

Acceptance creates or updates only a draft. Every source actually used in canonical evidence, including the original source
and editorial observations, needs separate Admin admission before publication. Admin controls
are shown individually; enabling an unrelated source cannot bypass this check.
The canonical publication refusal explains when evidence sources need Admin admission,
alongside the existing completeness diagnostics.
The existing canonical compare/approve/publish action is reused, as is generic
contribution closure. SQL requires a publication of the resolved service descended
from that proposal's accepted revision; unrelated or older publications cannot close
it as published. An updated proposal preserves the service identity and untouched
canonical component evidence. Source changes/heads never silently overwrite a draft.

Verification on 2026-11-27: the real HTTP/PostgreSQL journey covers a confirmed card
and excluded sibling, stable receipts/version-key conflict, uninvited Admin denial
for originals, selective snapshot rendering, incomplete acceptance refusal, amended
acceptance with an explicit observation, separate draft/source admission/publication,
wrong-source and wrong-service refusal, public read and a linked new-version update
preserving contacts/proof. The actual JS builder checks selected differences,
complete arrays, exact heads and removal of caller proof. The full application
suite ran 185 tests (179 passed, six external-prerequisite skips); final targeted integrated
checks also passed after local hardening. No real provider calls occurred. Combined
milestone review, human corpus/model evaluation and user acceptance remain pending.
