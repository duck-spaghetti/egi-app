# CW1 v3 editing and selective interpretation review

The shared `PreparationDraft` stores source facts, resolutions, interpreted
classifications and hypotheses on the existing card/field state. This is B10
foundation work; B10 completion still requires B09 and the coordinator's native
snapshot/moderation/publication journey. No live provider quality is claimed.

## Save and concurrency interface

After a successful v2/v3 save receipt, read its exact `after` version while the
immutable pending attempt remains intact, then call
`draft.reconcileSaved({id,payload}, choices={})`. It returns `[]` after adopting the
authoritative normalized base and stamps while preserving edits made after dispatch.
Conflicts return stable paths and leave the draft/pending attempt unchanged; the
caller resolves them explicitly with `local`/`remote` choices. A failed normalized
read must preserve the attempt for an idempotent retry, not fabricate a saved base.

V3 rebase uses stable `fact_id`, `interpretation_id`, `hypothesis_id` and evidence
IDs, including additions, deletions, remote reorder and concurrent deletion conflicts.
Source-fact evidence/origin paths follow their stable owner across reordering.
Automatic server actor/time/decision stamps do not create false semantic conflicts;
unchanged authoritative stamps survive. `addSourceFact` and compensation never
downgrade a v3 payload. Editing a basis marks its dependent interpretation/hypothesis
stale locally, then the server rechecks provenance and eligibility on save.

## Explicit, separate decisions

`chooseInterpretation(id,target,actor)` accepts only an actual candidate on that
proposal, and `rejectInterpretation(id)` rejects only that proposal. It does not
confirm the whole card. The database stamps authoritative actor/time and normalizes
the accepted category into the saved private service; the editor must reconcile it.

`verifyHypothesis(id,manualEvidence,actor,decisionId)` requires a new manual evidence
record with an independent attribution note, no quote/span, and a distinct evidence
ID. A copied trigger quotation is never verification. Hypothesis verification does
not choose a category; rejection is a separate per-hypothesis action. Client identity
and time are request placeholders; the database remains their authority.

`interpretations.js` supplies shared card/field controls with distinct Italian labels
for original passages, weak source context, “Interpretazione IA — da verificare”
and “Ipotesi IA non verificata — da confermare”, with manual attribution distinct; unverified
sigla hypotheses. Only exact saved evidence and frozen snapshot support are rendered;
there is no private-input lookup. Temporary Italian copy lives in the module's
`interpretationText` object pending the coordinator's shared translation pass.
Unsubmitted explanation text is retained on the same draft across rerenders/views.

## Selective moderator decisions

`reviewPayload(context)` preserves v3 arrays/source facts/resolutions without copying
the server-only `interpretation_support` bundle into an editable payload. Existing
service review starts from its canonical baseline. A new service excludes categories
originating from model interpretations until an explicit per-proposal choice. The
original author-confirmed proposal remains visibly distinct from a moderator choice;
there is no v3 whole-array classification checkbox.

`selectReviewInterpretation` and `clearReviewInterpretation` maintain explicit choices
without removing baseline categories or another selected proposal's shared category.
Each choice requires a human interpretation note and a target from the frozen
proposal's candidates. `decisionFor` consumes the optional final selection map and
uses the existing decision v2/source-fact actions plus service operations. It emits
an observation for `/service/classifications`, method `other`, with that human note.
Category operation evidence IDs stay empty: a description quotation is not direct
proof that a literal source category was stated. No interpretation arrays, caller
proof or source-context metadata are forwarded as canonical provenance. The database
binder attributes the existing `editorial_other` assertion; snapshot support remains
the immutable original/interpretive evidence, including weak metadata context.

## Local verification and remaining acceptance

`node --experimental-vm-modules tests/test_preparation_interpretations.cjs` exercises
actual draft/control/acceptance modules, normalized server stamps with concurrent
edits, stable deletion conflicts, fact reorder/provenance, no schema downgrade,
independent manual verification, frozen snapshot support and explicit moderator
category notes. The existing draft, analysis, evidence, reference and acceptance
Node suites also pass. These module tests do not establish browser layout, native
authorization, canonical provenance or the full integrated CW1 journey; those remain
the coordinator's checks before B10/whole-set acceptance.

A local actual-module timing compared1000 v2 edit/rebase calls per batch against
base `3fe17e2cbe98f54e559b80b94c97d96e5b664c75`: best measured0.0132ms/call before
and0.0131ms after (three measured batches after warm-up). The new v3 path with1000
interpretations, a remote reorder and one local rejection measured7.723ms/call over
100 calls. These are controlled module timings, not browser or database latency.
