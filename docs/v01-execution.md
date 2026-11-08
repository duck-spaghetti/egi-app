# EGI app local preview v0.1 — execution checkpoint

Date: 2026-11-08. Status: verified complete as a running local unreviewed preview.

The user requested the first repeatable source load and app recovery, then explicitly
confirmed a local preview of unreviewed imported data. The original clone is unchanged.
Frontend baseline: c090950874a8c5ac39c83f9ba2aa1ae06356af84. Database deployment baseline:
dfdd5cfe9589be48016cb9ccb9b5b382dea48615, four existing Sqitch changes deployed/verified.

Implemented: recovered map/list/detail/filter/language frontend, read-only preview
routes, source UUID handling, source-hours display without open/closed inference,
missing-coordinate retention, source provenance/review flags, private reader role,
loopback startup script and exact-cluster start/stop/bootstrap scripts.

Verified without installing framework dependencies: the actual DB adapter reads
315 services, nine native category groups and 313 points. All 315 descriptions
remain unknown; 23 itinerants are flagged. Frontend helper checks pass for UUIDs,
unknown hours and missing-coordinate list/distance behavior. Shell syntax and Python
AST/docstrings passed. The pre-installation checkpoint is superseded by the verified runtime/browser results below.

## Runtime confirmation and final verification

The user explicitly confirmed the existing minimal FastAPI/Jinja2/Uvicorn stack.
Installed in a dedicated .venv: FastAPI 0.136.3, Jinja2 3.1.6 and Uvicorn 0.46.0,
with their normal transitive dependencies. requirements.lock.txt records exact versions.
The app started successfully on 127.0.0.1:8000 and remains running for local review.

All three real HTTP integration checks passed, covering DB-backed 315 services,
UUIDs/unknown descriptions, 313 points, pages, UI catalogs, native filters, invalid
inputs and absence of public/mutation routes. Log: v01-http-tests.log. JavaScript
helper checks also passed after the final basemap change.

A real browser walkthrough confirmed: map markers; all 315 list entries; a UUID-backed
Telefono Rosa detail with original hours/provenance; native cibo filter yielding 46;
restoration of all categories and 315 results. No console errors/warnings were observed.
Screenshot: v01-preview.jpg. The old CARTO endpoint displayed API-key placeholders;
the implementation now uses the standard OpenStreetMap tile endpoint with visible
attribution, browser-managed caching and no prefetch/offline tile functionality.
Policy source: https://operations.osmfoundation.org/policies/tiles/ . Initial view
uses the Rome center/zoom rather than fitting the entire preview framing region.

The original/source data and publication constraints remain unchanged. This is a
local unreviewed preview, not a deployed public directory. No Git delivery, canonical
merge, geocoding or public publication is performed. Self-review; no independent
review was requested. No further dependency confirmation is pending for this stack.

An automatic approval review rejected a combined documentation update because it
included persistent AGENTS.md changes. Those instruction edits were omitted; the
separate operational script/documentation update was approved. AGENTS.md is unchanged.
