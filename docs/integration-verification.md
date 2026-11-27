# Identified cross-repository Integration

Run `python scripts/check.py --profile integration --json` using the selected
app environment and native PostgreSQL18/PostGIS/Sqitch prerequisites. Complete
remains a separate required profile; neither one substitutes for the other.

`.checks/integration.json` identifies the app comparison base, each owning
database/Reviewer check source, the Community native-schema source and the
consumer Reviewer wheel. Exact clean source revisions and wheel/installed-file
bytes are verified before importing native tests or executing provider commands.
Explicit environment variables in that manifest can select another filesystem
location for the same revision; they cannot silently select a different source.

The app owns orchestration only. It invokes each provider's existing
`scripts/check.py --profile integration --json`, validates report schema, repository,
profile, source, per-stage states and process exit, and preserves the actual reports
under `.local/integration/`. The Reviewer wheel receipt must match the source and
artifact hash in the manifest. Locally, the Reviewer build can use the manifest's separate selected interpreter (`EGI_REVIEWER_PYTHON` overrides its path), so checking the provider does not replace the app's installed consumer wheel. Child failure, missing prerequisites or a mismatched
success report produce a non-success result. Supervised resource runs retain exact
ownership and teardown; paid IA and arbitrary live database selection are excluded.

The consolidated database provider and native-schema selections now identify the
same integrated branch revision. Reviewer source/build checks and the Community
consumer likewise share the integrated Reviewer source; the exact rebuilt0.5.1
wheel, fixed source epoch and installed-file hash are pinned in the manifest.
The consumer lock is refreshed to that artifact without changing the selected
package version or adding a dependency. Local builds/installations use only an
ignored task-owned target; other worktrees' environments remain unchanged.

## Applicability

The specification makes native, retained-pilot and sibling checks mandatory when
their contracts change or they are explicitly requested. The app manifest/base
and actual changed paths determine the selected domains. Uncommitted tracked
changes are included when checking a candidate.

- Canonical/Community native suites and the owning database/Reviewer checks are
  required for this integration. Missing selected prerequisites block the profile.
- The historical315-record live preview suite is named as unselected when its
  source/transport/cycleway APIs have not changed. Supplying `EGI_APP_BASE_URL`
  explicitly selects it; changing those contracts makes the URL mandatory. It is
  not run against an arbitrary current canonical demo or replaced by synthetic data.
- The private sibling importer byte-drift case is optional for unchanged transport
  payload fixtures/network contracts and remains named with its prerequisite reason.
  A changed transport contract requires the exact clean importer checkout pinned in
  `importer_fixture`; `EGI_IMPORTER_REPO` selects its location for both the orchestrator
  and actual byte-drift test. Its fixture is required instead of waiving it.
  Importer/source enforcement is outside this milestone's initial repository scope.
- Every other unexpected skip in a selected suite still blocks. No historical
  skip count, blanket test exception or permissive mock replaces native properties.

The shared Python observer accepts these explicit caller selections without
embedding app-domain policy in provider repositories. Existing provider callers
retain their original default behavior. Fixtures prove unselected live setup is
not imported, unknown selected skips block, and actual provider child errors,
source mismatches and exit/report disagreements propagate to the app boundary.

## Delivery and CI

Commit-msg, pre-push and CI invoke the same canonical title policy. Shared check,
configuration, workflow, native fixture/test and provider-orchestrator changes require Integration as well as Complete
before push. App profile results are retained at `.local/checks/<profile>.json`,
including failures captured by a hook; stdout and exit semantics remain unchanged.
The owning app command clears inherited `GIT_*` routing variables
before checking its explicit root, so hooks cannot redirect disposable test repositories
or the report source identity. CI uses identified checkout revisions and preserves reports/artifacts.
Required-check settings and controlled negative/positive remote evidence are recorded
in the workspace execution record. Native Save PDF remains separate acceptance;
CI does not manufacture a native-dialog result or authorize final merge/deployment.

The app workflow checks out each exact provider/schema/consumer source from the
manifest under ignored `.local/providers/` paths. It installs the existing app
locks, selected setuptools75.1.0/wheel0.43.0 and pinned npm lock; Chromium comes
from the selected Playwright version. Rebuilding the Community consumer uses its
manifest-pinned SOURCE_DATE_EPOCH and the hash-locked wheel requirement.
PostgreSQL18/PostGIS and Sqitch run against disposable owned fixtures. Reports,
provider output, browser traces and PDFs are retained with the PR head identity.
These automatic checks need no API keys and do not dispatch paid model requests.

The hook-routing regression uses two real disposable Git repositories and verifies
that a fixture identity write affects only the checked fixture. A foreign repository
configuration must remain byte-identical when inherited GIT_DIR/GIT_WORK_TREE point
to it. Synthetic identities never configure the shared application repository.
