# Native desktop print acceptance — EGI-137

Status: **pending actual native saved-file evidence**. Generated Chromium PDFs
pass separately; this document does not treat that as a native-dialog result.

The owned synthetic preview is `http://127.0.0.1:4340`, configured with
`checks.fixture_app:app` through `scripts/preview.py`. It uses neither a database
nor a provider. Existing Community 4328 and saved-list 4335 profiles/data are preserved.

1. Open `http://127.0.0.1:4340/__fixtures/native-print` in the chosen desktop browser.
   It prepares only the named synthetic collection **Verifica stampa EGI-137** on
   this separate origin and opens the actual selected-list page.
2. Confirm the collection contains **Sportello orientamento**, **Via Esempio 10,
   Roma**, and **Associazione Alfa · catalogo sintetico** with source dates
   **2026-11-20 / 2026-11-19** and a visible copy-update date.
3. Press **Stampa / salva PDF**, choose the native PDF destination, and save as
   `egi-native-print.pdf` in Downloads. Record browser/version, OS, UI language,
   chosen paper/page settings and actual output path.
4. Inspect the saved file: intended collection/service/source/dates, readable text,
   pagination and no leaked page controls or other lists. Preserve the observed
   output and source/print input identity with the milestone evidence.

The Codex browser runtime successfully initialized, listed the existing Community
tab and returned bounded DOM observations. A new synthetic print tab loaded the
collection. Clicking Print timed out at Input.dispatchMouseEvent; a subsequent
AX snapshot still exposed the page, not a native save dialog. No native desktop
control tools are exposed in this chat. A user save is therefore pending, rather
than inferring that browser automation or printing is globally unavailable.

The user was asked to save this exact synthetic file and identify the browser.
After it exists, use `pdfinfo`/`pdftotext` and render its pages to verify the actual
artifact. Do not mark EGI-137 verified until that evidence is present. This is the
explicit task acceptance step, not an additional intermediate review gate.
