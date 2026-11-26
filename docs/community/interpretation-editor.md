# Select and update interpretation candidates

EGI-110 adds the analysis controller to the same private editor. The first eligible
public insertion debounces text/attestation changes, saves the exact input and
requests one durable interpretation. Recognition creates no cards automatically.
Later source edits mark results stale and wait for explicit **Aggiorna proposte**.
Card-field editing, layout switches and reloading a saved card start no IA request.
Non-public input remains manually editable.

The controller polls the authorized job route; it never loads credentials or calls
the provider. Status distinguishes queued, leased, running, succeeded, failed,
uncertain and cancelled. Budget exhaustion leaves the manual editor usable. An
uncertain request explains that an explicit new attempt may incur another cost;
there is no automatic provider retry. Cancellation affects future result use while
the worker/database still account for any committed dispatch.

A completed result lists names, delivery mode, proposed place and exact submitted
excerpts. Nothing is selected by default. The operator selects candidates and
creates only those cards, or selects one to update the opened card after saving its
pending edits. Server-minted candidate IDs, input/job identity and expected card
version are used. Receipt/selection keys remain stable across uncertain application
responses. The database preserves manual/cleared fields and reports conflict paths;
the UI reports the corrections retained and opens the current saved card.

Source-stale proposals cannot be materialized. Remote-service candidates remain
without a place unless one was actually proposed. Explicit refresh reads metadata
without discarding local card/source edits, allowing an operator to inspect the
new original before saving against a refreshed metadata version.

Verification (2026-11-27): the actual Node controller test covers one debounced first
request, no automatic card creation, explicit selected creation, no analysis on card
changes, subsequent explicit Update and stale-result blocking. A native HTTP/worker
journey recognizes two services, creates only one, repeats the receipt without a
duplicate, changes the source, refuses old results and preserves manual name/cleared
description on update. A real browser on the isolated demo verified automatic queueing
and selected-only creation with no invented place, using a clearly labelled **simulated
response** fixture. This does not establish actual model recognition or quality.
Human corpus/model/live-call acceptance and the final milestone review remain pending.
