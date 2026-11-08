# UI refinement — 2026-11-08

User explicitly requested cross-category POIs, integrated need/type/prestation controls, category badges containing icons, opening/countdown information in detail and list, and phone/email values when no explicit label exists. This continues the approved local preview, in one delivery group. No dependency, schema, data load, canonical publication, Git action or remote delivery.

## Implemented behavior

- A matching service reveals the source site marker with all colocated sibling services, including categories outside active filters. The marker shows category colors/icons and the service count; the chooser labels siblings outside the search. Different positions and fixed/itinerant contexts remain separate; no source point is inherited.
- Need/category, type and prestation are together in a compact fieldset with responsive category chips and adjacent refinement selects. Native OR/AND semantics are retained.
- Category icon lives inside its colored badge in list, detail and sibling chooser. Captions use initial capitals with word spacing (for example “Igiene Personale”).
- Detail and list share an ephemeral client-side source-schedule status calculated in Europe/Rome. Within a valid declared interval: “Aperto ora”; with at most 180 minutes remaining: “Aperto ora · chiude tra …”. Before a later same-day interval: “Apre tra …”. Overlapping/adjacent intervals merge before calculating the closing boundary. Bad/overnight-ambiguous intervals stay unknown; absent days never mean closed. Later-day declarations are labelled “Prossimo orario indicato”, not asserted as the next actual opening. Status includes the Helpinet/unreviewed qualification and refreshes every 30 seconds and on returning to the tab.
- This explicitly requested preview calculation supersedes the earlier UI deferral of open-now display. Backend source-schedule completeness, scope and open_now remain unknown; computed UI state is not saved as a source fact or approval.
- Phone/email links display the original value unless a nonempty explicit label is available; link destinations retain tel:/mailto:.

## Evidence

Self-review completed. JavaScript syntax and Node checks passed, covering existing filters/distance, contact labels/default values, cross-category source-site siblings, missing/different points, opening/closing boundaries, the three-hour threshold, overlapping intervals, Rome winter/summer dates and ambiguous/missing schedules. All 9 live HTTP/presentation tests passed.

Browser: an Abbigliamento-only search for Social Market Ferraioli showed a point with Cibo, Ascolto and Abiti E Coperte; the chooser retained all three independent services and identified the two outside the filter. Category icons/captions rendered in badges. All 315 list entries had a source-schedule status; live open/upcoming results were present. A Casa di Amore detail displayed “Aperto ora” and phone values 067001668 / 0677260230. No errors or warnings were observed in the checked tab. Responsive layout and icon contrast were inspected and corrected. An actual browser location permission flow was not exercised.

Reload the existing local map to receive updated JS/CSS/template. Database, importer and original files were not changed by this refinement. Previous v0.2 archived evidence remains historical; the new archive contains the refined app.

Current behavior was subsequently revised under approved discovery UX r1 on
2026-11-09; see [the maintained contract](discovery-ux.md). This record describes
its historical acceptance, including older opening/countdown wording.
