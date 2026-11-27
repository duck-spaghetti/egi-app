# Native desktop print acceptance — EGI-137

Status: **native desktop save observed and artifact verified, 2026-11-27**.
The user reported using the Codex built-in browser and saving in Downloads.
Actual file: `/Users/marco-macbook/Downloads/EGI — Le tue liste.pdf`.
PDF metadata identifies Chromium158/Skia158 on the macOS host; no exact OS version
or universal browser support is asserted. Italian, two A4 pages,158922 bytes.
`pdfinfo`, full `pdftotext` extraction and both rendered pages confirm the intended
collection, service/address, source dates2026-11-20/2026-11-19, revision000…002 and
copy update27/11/2026. Text is readable; the source section continues onto page2.
Default browser headers/footers show the synthetic origin; no other list or app
controls appear. Paper size is observed from the file; other print settings were
not independently recorded.

Durable artifact, SHA256 receipt and rendered pages are under workspace
`.scratch/agent-workflow-improvements/session3-evidence/native-print/`.
The receipt distinguishes the preview's recorded startup sourcefe13614 from
artifact/input evidence. Production print assets are unchanged from that checkpoint.
Generated Italian/Arabic Chromium PDFs remain separate evidence; only this Italian
user-operated save establishes native-dialog acceptance.

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

## Earlier automation attempt — historical

The Codex browser runtime successfully initialized, listed the existing Community
tab and returned bounded DOM observations. A new synthetic print tab loaded the
collection. Clicking Print timed out at Input.dispatchMouseEvent; a subsequent
AX snapshot still exposed the page, not a native save dialog. No native desktop
control tools are exposed in this chat. A user save was requested, rather
than inferring that browser automation or printing is globally unavailable.

That requested user action is now complete, as recorded above. The ticket remains
subject to the milestone's one final review and user acceptance; native evidence
adds no extra intermediate review gate.
