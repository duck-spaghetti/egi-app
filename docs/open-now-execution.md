# Open-now search facet — 2026-11-08

User requested filtering for services open now. Added the optional “Aperti ora” checkbox in the existing discovery fieldset. It combines with the native category/type/prestation/access/text/section filters on both list and map. Only the existing sourceOpeningStatus result kind=open qualifies, including its closing countdown state; upcoming, missing and ambiguous schedules do not qualify.

The existing 30-second/visibility-change status refresh now also refreshes filter membership while active. Disabling the facet restores services subject to the other filters. Cross-category source-site markers retain independent colocated siblings in their chooser, with out-of-filter siblings explicitly labelled, as previously requested.

Checks: JavaScript syntax and Node checks passed, including deterministic open/upcoming/unknown/ambiguous membership, exact closing boundary and disabling the facet. All 9 HTTP/presentation tests passed. Browser DOM verified the selected checkbox and 11 matching list entries, all showing Aperto ora or its closing countdown at the time of inspection; no warning/error logs. The screenshot shows the filtered map. Browser checkbox action reporting was inconsistent with the verified resulting checked state; disabling was verified in the deterministic Node seam rather than claimed as a successful browser interaction.

No database/schema/importer changes, new dependencies, publication or Git actions. Self-review performed. This remains a source-derived, unreviewed indication in Europe/Rome, not a verification of live availability. Reload the map for updated scripts/template.
