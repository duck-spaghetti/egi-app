# Service preview v0.2 — execution evidence

2026-11-08. Authorized by the user's “ok procedi” after the description/grouping decisions and review specification. One local delivery group; existing local-checkout exception retained. No Git initialization, commit, push, remote, schema change, new dependency or canonical publication. Self-review performed; no independent review claimed.

## Result and acceptance

- AC01–02: all 315 original descriptions stay null. A separate `helpinet-summary/1` deterministic summary has source-record/JSON-pointer references. Every record has a summary from prestations or type; tampering is rejected even after content rehashing.
- AC03–05: 315 independent service cards, 201 native provisional groups. Browser: Social Market Ferraioli has three separately selectable services; selecting Abbigliamento then Sportello sociale changes the active title, category, prestations and source card. A shared marker opens a three-service chooser. Unit fixtures verify different hours/contacts and missing sibling geometry are never merged or inherited.
- AC06: all 44 flags are retained and measured. Positive claims appear as procedure, documents/requirements, audience or cost; false/missing flags never become unrestricted access or free service. Source uncertainty remains visible.
- AC07: native needs OR; type, prestation, positive access and text terms AND. Browser: Mensa sociale + Pranzo yields 14 results. A structure search yields its three independent services. Node checks include accent-insensitive text, empty need selection and positive-only flags.
- AC08: seven readable weekdays; missing intervals mean unknown, not closed. Source scope and ambiguous/overnight intervals remain flagged; no open-now claim.
- AC09–10: valid local category SVG icons render. Original points/itinerance retained. Browser: explicit reference 41.9,12.5 produces ascending distances (841 m, 1.4 km, 1.6 km…). Unknown distances sort last in Node tests. No browser location permission was granted or automatically requested. Geolocation-button behavior with an actual permission grant was not exercised.
- AC11: the two missing-point services retain their addresses under “Posizione da completare”. Rubrica is empty for this capture because no explicit telephone/online delivery is asserted; synthetic unit fixtures check explicit remote delivery. Missing coordinates never imply remote delivery.
- AC12: `/benchmark` and `/api/preview/coverage` account for all 12 native service fields, all native group fields and 44 access flags. Original description population remains 0/315 independently of derived summaries. Unknown future fields remain retained with pending interpretation.
- AC13: original SHA256 remains `9b2ee030254e3429f5e17f3345c5a6cc2a74b29f90878cc6df91d05431834cfc`. New run reuses the frozen v0.1 extraction. Two identical v0.2 loads returned run `b37a4540-6ba0-591b-a8aa-d174d5890e47`; prior interpretations retained. See verification.json for actual aggregate counts.

## Executed checks

- Importer: `EGI_TEST_DSN=<dedicated egi_import_contract DSN> python3 -m unittest discover -s tests -v`: 15 passed, including real PostgreSQL concurrent retries, version history, forced rollback and reader isolation.
- App: `EGI_APP_BASE_URL=http://127.0.0.1:8000 .venv/bin/python -m unittest discover -s tests -v`: 9 passed, including live HTTP/DB coverage.
- JavaScript: `node --check app/frontend/static/js/map.js`, entry.js syntax check and `node tests/test_map.cjs`: passed.
- Browser walkthrough: list/detail/related services, shared marker chooser, native filters, source-missing position section, empty Rubrica and manual reference distances. No errors/warnings in the checked tab. Screenshot retained with the deliverable.
- Notebook cells are exercised by importer tests through the same functions. No Jupyter UI or browser geolocation permission flow is claimed.

## Repeat

From egi-importer, with the recorded preview database running:

```sh
python3 -m egi_importer run --checkpoint runs/helpinet-01/extraction/bundle.json --output runs/helpinet-03
python3 scripts/load_preview.py --input runs/helpinet-03/normalized/bundle.json --preview
python3 scripts/load_preview.py --input runs/helpinet-03/normalized/bundle.json
```

Choose a new run directory; outputs refuse overwrite. Reload the app to read the latest succeeded interpretation. To repeat exactly the delivered load, select `runs/helpinet-02/normalized/bundle.json` instead; records, captures and interpretations are reused.

Local data remains unreviewed. Canonical taxonomy, location/address enrichment, geocoding, cross-source deduplication and editorial approval remain subsequent work. New preview copy uses Italian; recovered interface catalogs remain available.
