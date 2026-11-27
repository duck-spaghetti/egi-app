# Private category groups — CW1 B10

The group desk uses the same preparation, selected cards and draft store as the
card/field editor. It proposes no canonical merge and makes no provider call.
Manual groups work without IA configuration or Reviewer availability. Local spelling
variants reuse the pinned `review.workbench.normalize_label`: NFC, casefold and
whitespace only. Missing Reviewer disables only variants and explicitly offers
manual grouping; no credential/setup flow is introduced.

## Backend boundary

`preparations.groups.router` exposes fixed private routes beneath
`/moderazione/contribuisci/api/preparazioni/{workspace}`:

- `POST /gruppi/contesto`: current adopted territory/axis context.
- `POST /gruppi/basi`: selected owned cards, paginated category facts/materialized
  interpretations, never private contacts or full inputs.
- `POST /gruppi/varianti`: paginated literal spelling groups and member pages,
  explicit literal/interpretation counts and no inferred category mapping.
- `GET/POST /gruppi`: bounded summaries and one exact versioned save.
- `GET /gruppi/{group}`: frozen metadata/member page and safe original basis details.
- `POST /gruppi/{group}/applica`: at most100 explicit exact-version members.
- `GET /gruppi/operazioni`: current editor's bounded durable operation summaries.
- `GET /gruppi/operazioni/{operation}`: bounded receipts, full outcome counts and
  exact original `resume_request`, with owned frozen card names.
- `POST /gruppi/operazioni/{operation}/annulla`: exact-head compensation.

Static operation routes precede the dynamic group UUID route. Every route uses the
existing fresh session/CSRF/no-store boundary and off-thread transaction execution.
Only fixed preparation functions are called; the app queries no private tables.
Safe projections use `read_item` for explicitly selected/group-member cards and
retain only name/description/category facts/materialized interpretations and their
owned supporting evidence. Historical interpretation passages come from their exact
owned basis version, never from sibling records or moderation input retrieval.

Basis rows contain `member` (the exact GroupMember), name, original label/current
value, origin/state/context and an original field/evidence view. Unsupported field
views remain absent rather than exposing other service fields. Local variant keys
bind the complete actual member/head set; a changed selection between member pages
requires a fresh preview rather than mixing snapshots. Every page reports totals
and cursors. No list is silently clipped or counted as semantic analysis.

## Frontend host interface

`createGroups(host)` needs `root`, `context`, `api`, `workspace()`, `selectedItems()`,
`canEdit()`, `flush()`, `refresh(receipt, workspaceId)` and `error(error)`.
It returns `load(workspace)`, `open(group,version?)`, `refresh()`, `render()`,
`prepareProposal(retainedDto)`, `saveProposal()`, `current()` and `dispose()`.
The editor owns creation/disposal and supplies its existing selected-card set and
draft. The refresh callback must preserve edits made during an in-flight operation
and ignore a receipt for another active workspace; it must not reset unsaved state.
An applied `after_version` is a produced group head, never acknowledgment of a
pending draft save. With no pending save, a current-head reread uses normal
three-way rebase. A committed pending draft first resolves its exact historical
save through the persistence sequence; an unknown pending save remains intact.
Skipped/conflict/pending outcomes cannot grant a produced card version or confirm
the whole card. The optional `openCard(id)` hook opens that same editor after a
successful flush, to inspect a named receipt conflict without another store.

Writes flush first, then freeze the body and request key. An unknown response locks
group controls and retries that exact capture; it never resnapshots changed local
selections. A partial apply/undo uses the same key to process the next bounded slice.
Receipt reload uses database-owned `kind` and exact `resume_request`: apply contains
group/version/selection/key; undo contains original operation/key. No localStorage
or newly generated replacement key becomes authority for pending work.

The UI creates proposed manual/spelling groups before any acceptance. Explicit
acceptance chooses a named current category; application separately selects at most
100 members. Source corrections, rejected/conflicting decisions and later edits are
preserved through skipped/conflict receipts. Compensation only targets successful
unchanged heads. Per-page displayed counts and full durable summaries remain distinct.
The accepted stored category is displayed separately from a pending selector change;
changing the selector cannot change the target of an already accepted operation.

Split creates an explicit selected subset with the checked parent version; its
parent stays visible. Combine fetches every bounded parent member page and creates
the complete union with checked current parents, which the DB archives atomically.
Duplicate identities with different expected versions conflict rather than selecting
one silently. Normal same-group edits use `expected_version`; `parent_versions` is
explicit lineage, not mandatory for every state change. Choosing an initial valid
context for an unresolved group may therefore omit lineage parents. AI-to-manual
extension preserves the original context/parent and clears `proposal_id`; it never
claims new members were inspected by IA. A different territory/axis needs an explicit
new group. Related/ambiguous/missing AI applicability metadata never implies equivalence.
The `linked_proposal` summary uses authoritative total issue counts with a separate
issue cursor; an empty issue page never means an issue-free complete proposal.
An explicit integration action can add selected actual elements and replace their
expected versions with those the operator just reviewed; it creates a proposed
manual revision with lineage, not an expanded claim of IA coverage.

## Acceptance evidence and remaining gate

`tests/test_workbench_groups.cjs` exercises the actual controller: manual creation
without IA, bounded basis state, separate acceptance, frozen ambiguous retry,
partial apply/undo, receipt recovery after reload and workspace isolation.
`tests/test_workbench_journey_native.py` reuses the owned worker and moderation
fixtures for the declared multi-packet plan, valid/abstaining/missing outcomes,
continuation/comparison, retained AI proposal, explicit unconfirmed interpretation,
manual lineage extension, protected mapping/undo, selected snapshot and existing
explicit moderation/publication. A second case checks manual variants with IA
disabled and verifies private contacts never enter basis/variant responses.

The two native journey cases passed against accepted database source through036:
2 tests in3.565s, ownership-aware harness3.967s with owned teardown passed. The
controlled HTTP group application (4 members/3 cards) measured31.669ms; compensation
of2 successful cards measured16.231ms. No predecessor group API provides a comparable
before measurement. The first journey attempt correctly failed publication because
the fixture lacked description/telephone-channel completeness; adding explicitly
human-checked synthetic values satisfied the existing unchanged publication rules.
Controller Node tests, v3 Node tests, syntax and diff checks also passed.
Final integrated browser/whole-set review and coordinator source pinning remain
separate gates; these component checks alone do not establish B10/CW1 acceptance.
All data/identities are synthetic, transports controlled; no model-quality claim,
live provider call, credential access, shared environment change or publication of
real user data is part of these checks.

Context options may be loaded from the catalog, but the context selector stays at
its explicit prompt until a human chooses territory/axis. Group acceptance stays
disabled until that choice and a mapping are both present. Apply and undo receipt
headings name their distinct action, even though their per-item applied status uses
the same compensating-operation contract.
