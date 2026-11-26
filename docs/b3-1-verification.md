# B3.1 implementation verification — 2026-11-26

Implementation candidate, not final user acceptance or deployment. The user has
directed Community to integrate/supersede this foundation and receive combined
human testing/review afterwards. B3.1 is not separately marked accepted.

Scope and mode remain the approved B3 r0.4/ticket set, whole-set with final review.
App base a75bd0e, initial candidate 5c2f039; database base74d0d89/candidate cf0c3cb.
Both origin/dev fetches succeeded on resume, with no divergence from those bases.
Existing task branches/worktrees and unrelated primary-checkout files were preserved.

## Final-state evidence

- App:166 Python tests passed,6 known retained-pilot/live prerequisites skipped,
  with native `EGI_DATABASE_REPO` fixtures enabled. Seven EGI-85 tests cover partial
  decisions, stale/forged/repeated decisions, structured hours/conditions, prefilled
  new services, protected-contact release, oversized existing aggregate preservation
  and recovery of unsaved schedule controls. Persisted interval evidence is asserted.
- Node: real ES map/service journeys and transport popup checks passed.
- Importer:357 tests passed,7 external-prerequisite skips, using the selected
  SQLite3.45.3 environment and native PostgreSQL scenarios against the B3.1 schema.
- Database: direct psql deploy, structural verifies, contracts00–16, two-connection
  concurrency, full revert/redeploy and repeat passed on disposable PostgreSQL18.
  **Sqitch CLI/registry were not exercised:** its selected Perl interpreter no
  longer exists; system Perl cannot load the compiled modules. Test deployment
  through the explicitly labelled psql runner does not establish Sqitch behavior.
- Two independent static review axes covered the complete branch plus working
  files. Three P2 findings were fixed and targeted re-review found them resolved:
  insertion limits truncating existing components/ranges, schedule edits lost on
  refused forms, and missing per-interval evidence on accepted hours.

Logs and native runners are retained in the workspace planning evidence directory
`.scratch/mvp/b3-1-checks-20261126/`; actual commit/issue mapping belongs to Linear.
No new dependency, framework or schema was added for EGI-85.

## Real-data isolated browser journey

A separate temporary PostgreSQL cluster restored the previously retained local
B1 backup's594 public services. Original backup/database were not changed. Only
synthetic accounts and a test contribution were added in that disposable cluster.
Browser sign-in → claim → accept → source/public/draft comparison → explicit publish
→ close succeeded. The public list showed the corrected name, with both original
source and Redazione EGI attribution. A controlled31-day fixture-time shift then
ran the actual restricted retention function: text/contact/proposal values removed,
outcome/actor/history preserved. This does not claim31 days elapsed in wall time.

## Performance sample

Same local disposable594-service database; five warmups then30 TestClient requests
per path/configuration. No load/concurrency guarantee or latency threshold inferred.

| Path | Before p50/p95 ms | After p50/p95 ms | Comparison |
| --- | --- | --- | --- |
| Public service detail |68.120 /83.264 |67.872 /84.017 | milestone base a75bd0e vs working candidate |
| Contribution detail, one pending proposal |5.350 /6.484 |24.163 /31.429 | pre-EGI85 5c2f039 vs working candidate |

The contribution page now reads the full editing aggregate and publication choices
and renders typed decision controls. Its extra work is visible in these timings;
public-detail variation in this small local sample is not evidence of a guaranteed
speedup or a statistically established regression.

## Remaining operational/review boundaries

- Real demo login provisioning, installed retention scheduler and SQL application
  outside disposable targets retain their separate grant. Scheduler templates exist
  in the database repository; no launchd job was installed by these checks.
- Google account/client configuration and production/staging are not established by
  fake-provider tests or the synthetic browser login.
- Community integration and combined final acceptance remain next; no PR/merge or
  main/master promotion follows from these checks. The prototype on4317 is preserved.
