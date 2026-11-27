# Category plan preview and progress

The category plan panel uses the existing preparation, card list and private draft.
Select native checkboxes beside existing cards; the limit is 100 explicitly selected
cards. Selecting all is available only when the whole visible preparation fits.
Nothing is silently clipped. Selection alone starts no request.

Create an **anteprima** to freeze the selected server card versions, public source
context, taxonomy scope, task dependencies and request/cost envelope. Null
configuration resolves the current reviewed server configuration. The panel shows
its model and pricing reference, initial/planned/maximum requests, later-request
allowance, worst-case planned cost and authorized total cap before one explicit
**Avvia questo piano**. Preview grants no additional live provider permission.
The default editable envelope is eight requests, including at most three later
requests, with a one-USD cap; the existing database enforces its monthly ceiling.

Source names and the named territory/axis come from authorized existing references.
Label inventory shows supplied and omitted counts. Safe catalog coverage shows
complete or partial status and supplied terms when the server provides it. A
partial catalog has unknown total/omissions unless explicitly known; missing
coverage is never displayed as complete. No raw provider configuration, credentials
or opaque digests are shown in the main flow.

Source input edits block preview/start until explicitly saved or restored. Card
preview flushes the existing draft through its current save path; conflicts stop
the action without dropping cards or unsaved values. A changed selection, limit,
source snapshot or card version requires a new preview. **Nuova anteprima dalla
selezione** calls the explicit amendment endpoint and preserves the old plan; it
never starts the new one. The previous plan can be inspected and the operator can
return to the latest preview. Reading another plan does not replace the draft.

Record analysis and category comparison are separate sections. Record totals
identify available analyses, abstentions, partial work, pending/blocked records and
stale heads. Available means contract coverage, not human acceptance or semantic truth. Rows disclose unresolved passage counts and comparison state. Description
proposals awaiting explicit materialization/new preview are distinct from no-match
or insufficient-context abstention. Reference-only context earns no primary record
coverage. Comparison scopes/units/references/omissions are never derived from a
record percentage or treated as a global pairwise-comparison guarantee.

Manifest, record, result and event reads are bounded pages. Packet rows disclose
primary/reference counts and predecessor requirements. Continue is an explicit
request for unresolved declared work. An uncertain packet shows the possibly paid
prior attempt and held reservation; a new paid attempt requires a visible checkbox
acknowledgment plus a separate button. It is never automatically repaired/retried.
Cancelling does not refund already incurred or uncertain costs.

Opening/reloading a preparation reads `latest_analysis_plan` and restores its
frozen selection without starting it. Active work polls bounded state; terminal
states, access loss, errors and page/workspace exit stop polling. Workspace and
read-generation guards discard late responses. Network retries reuse the original
request key only after another deliberate action. No browser persistent store or
second card editor is introduced.

`createPlans(host)` owns this projection. Its public hooks are `load`,
`selectionControl`, `sourceChanged`, `cardChanged`, `refresh`, `pause`, `dispose`,
`current`, `selectedItems`, `subscribe` and bounded `recordResults`. Subscribers get
`{plan, coverage, workspaceId}` for the group-review consumer. Existing editor save
acknowledgment remains unchanged in this task; proposal materialization remains a
separate explicit consumer operation.

Run `node --experimental-vm-modules tests/test_workbench_plans.cjs`. The actual
module checks deliberate preview/start and same-key explicit retry, source/draft
barriers, selected-card cap, changed limits, separate coverage, partial catalog
copy, micro-USD precision, visible comparison limitations/wait reasons, bounded pages, paid-retry acknowledgment, amendment/history, reload,
permission loss and late workspace responses. Existing analysis/draft module tests
remain regressions. Native HTTP tests independently exercise ACL/CSRF/no-store and
SQL plans; actual browser/viewport verification belongs to whole-set integration.
No real model call is needed for these tests.
