# Controlled workbench verification

`scripts/cw1_checks.py` runs the requested native unittest suites with a bounded
subprocess and ownership-aware PostgreSQL teardown. It consumes the resource
owner's standalone standard-library tooling from an explicitly selected checkout;
it does not copy or install that tooling as an application dependency.

Set `EGI_RESOURCE_TOOLS_REPO` to a checkout at
`84044a266dcbabab8319c9f5682d0437c7bea732`. The loader verifies HEAD and the actual
module bytes against that commit before importing them. Select the database
worktree explicitly through `EGI_DATABASE_REPO`; use an immutable checkpoint when
another contributor is editing SQL. `EGI_SQITCH`, `PERL5LIB` and `EGI_PG_BIN` select
the already installed Sqitch/PostgreSQL tools. With no Sqitch selection, the fixture
deploys plan SQL directly and does not establish Sqitch registry verification.
An explicit `EGI_DATABASE_THROUGH` selects an earlier verified Sqitch change for a
provider-seam or before/after regression check. Omit it for final integrated checks;
a partial target never establishes later migration or whole-milestone acceptance.

For example, using the project's selected Python environment:

```sh
EGI_DATABASE_REPO=/absolute/path/to/selected-database-worktree \
EGI_RESOURCE_TOOLS_REPO=/absolute/path/to/pinned-resource-checkout \
EGI_SQITCH=/absolute/path/to/sqitch \
PERL5LIB=/absolute/path/to/sqitch/lib/perl5 \
python -B -m scripts.cw1_checks \
  tests.test_preparations_native \
  tests.test_community_worker_native \
  tests.test_community_review_native
```

The default timeout is 600 seconds; `--timeout` accepts 1–1800 seconds. Every
cluster uses its own private socket directory with TCP disabled. Disk preflight
warns below 30 GiB and blocks below 15 GiB on the allocation filesystem. Only the
active run's resources can be reconciled; historical metadata grants no cleanup
authority. Failed or contradictory shutdown preserves the affected directory and
fails the check. No existing demo database, cluster or port is adopted.

These suites use synthetic identities and controlled provider transports. Their
success establishes mechanics and regressions, not real model quality, credentials,
live-dispatch authorization or final human acceptance. The selected local Python
environment is read without modifying another contributor's installed packages.

Baseline evidence: the three suites above passed 17 tests in 8.873 seconds against
database commit `19ca1ad`, before new workbench consumers were implemented. This
baseline is distinct from the later final CW1 integrated checks.
