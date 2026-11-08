# Local preview v0.1 — compact specification and execution plan

Date: 2026-11-08. User request: first repeatable Helpinet load, recovery of the
existing app and adaptation to the new database, producing a usable v0.1.
The user confirmed a local preview of imported, unreviewed data. Publication rules
are retained; missing descriptions are not invented. The user subsequently confirmed the existing FastAPI/Jinja2/Uvicorn subset; installation and local startup completed in its dedicated .venv.

## Scope and acceptance

1. Load validated Helpinet bundles into the existing sources schema atomically;
   preview the action; repeated/concurrent loads of one bundle do not duplicate
   content; changed source claims/interpretations retain history; failure rolls back.
2. Deploy existing Sqitch migrations into a fresh, private local preview database.
   Never modify other database targets or rewrite released migrations.
3. Recover the original frontend at c090950874a8c5ac39c83f9ba2aa1ae06356af84,
   preserving the reference checkout. Reuse map, list, category filters, details,
   language catalogs and city/language entry flow.
4. Adapt a minimal read-only API to source evidence using a dedicated restricted
   reader. Scope routes under /api/preview; no publication or old CRUD endpoints.
5. Label preview data as unreviewed. Preserve unknown descriptions, costs, contact
   purpose and hours scope. Display native hours as evidence without claiming
   open/closed. Handle source UUIDs and missing coordinates correctly.
6. Serve on loopback only. Provide repeatable load/start/stop instructions and
   verify browser behavior, HTTP responses, database permissions and actual counts.

## Execution sequence

A. Implement the evidence loader and real PostgreSQL repeat/history/failure checks.
B. Bootstrap/deploy the isolated database; load the retained capture and repeat it.
C. Restore frontend assets into egi_app and implement the preview adapter.
D. Reuse the approved minimal existing stack in an isolated environment, then run
   endpoint/integration checks and a real browser walkthrough.
E. Record evidence, exact runtimes and limits; leave the local preview available.

The request authorizes this loading/app preview group; it does not authorize all
remaining importer tickets. No source retrieval, geocoding, category adoption,
canonical entity merging, publication, Git delivery, remote setup or hosting.
No credentials are committed. Runtime cluster files live outside component histories.
