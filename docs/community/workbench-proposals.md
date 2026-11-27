# Inspecting retained proposals and selecting private additions

`createProposals(host)` reads only the bounded workbench result projections. It
uses the existing workspace, plan and card draft; it has no second editable card
store, no provider client and no automatic write. Root integration owns the editor
mount and callbacks. The controller exposes `render`, `cardChanged`, `planChanged`
and `dispose`.

For a current card, explicitly read its retained result links and choose one job
at a time. Different jobs remain separate, including valid partial outcomes and
abstentions. The link and proposal/hypothesis pages are bounded; additional pages
require an operator action. A changed annotation version is not automatically
rejected: selection uses the current exact head after the existing draft flush,
and SQL decides whether the older retained source proof remains unchanged.

The UI shows original category labels separately from description interpretations,
actual human catalog labels, reasons and original passages. Source metadata is
visibly weaker context, never proof of a category. A no-supplied-match outcome
refers only to the supplied catalog; insufficient context and partial catalogs are
explained without inventing a category. Missing cited supports disable a useful
selection until the relevant bounded context page has been inspected. Arbitrary
result-local keys remain in JSON bodies and never enter URL paths or query text.

Select useful proposals to add their alternatives as unconfirmed private decisions.
No choice is accepted, no category is assigned, and no whole card is confirmed by
this action. Hypotheses have separate selection and addition controls and remain
unverified; their trigger passage does not prove an expansion or justify a category.
At most 100 proposal or hypothesis keys are selected per action, without clipping.

Current `materializations` are a separate server sidecar, not a rewritten model
DTO. Confirmed/rejected/ignored/stale/removed decisions and unverified/verified
hypotheses are shown and cannot be silently reset by another selection. Existing
stable result identities make a new-key reselection a no-op when already added.
Known/no-op receipts refresh the shared draft through the root's reconcile callback.
A failed refresh does not turn a known write into an uncertain write.

An uncertain write preserves its exact endpoint, expected head, keys and request
key. Nothing retries automatically. Its explicit replay reconciles that original
request rather than flushing a new head and inventing another body. New selections
for that card wait until the pending intent is resolved. Successful receipts always
reach `refreshItem(receipt, originalWorkspace)`; the integrator rebases later local
edits and exposes conflicts. Workspace/card/plan generation checks discard stale
read projections, and access loss disables additions.

For category groups, explicitly page the declared plan manifests and choose a
retained group-label job. Equivalent, related and ambiguous relations and membership
issues remain distinct; no claim is made about all possible pairs. Member and support
pages are at most 50 rows. The operator selects actual retained members, up to 1,000,
while the full total and unresolved occurrences stay visible. Repeated descriptions
retain interpreted member identities and original evidence; they are never fabricated
literal category labels. Nothing is silently clipped at 100 members/supports.

Preparing a group hands the selected DTO to `groups.prepareProposal`: retained
`packet_id:proposal_key`, checked context, exact members, safe historical details,
full member total, actual catalog choices, relation and issues. The handoff must
return true before success is reported. It does not save or apply the group.
Related/ambiguous proposals remain inspectable and may be saved as proposed; the
separate group controller/server govern acceptance and application.

Run `node --experimental-vm-modules tests/test_workbench_proposals.cjs`. The actual
module tests partial job inspection, source versus weak context, no-match and
insufficient-context copy, unconfirmed proposals versus unverified hypotheses,
exact uncertain replay, preserved review state, current-head selection after an
annotation, 101-member/support paging, related-only proposed group handoff and
late-card response guards. No model call, credentials or new dependency is needed.
