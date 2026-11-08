# EGI service preview v0.2 — specification

Date: 2026-11-08. Status: implemented and verified as the local v0.2 preview. The user confirmed the source-summary/group choices and instructed proceeding. Concrete implementation choices and one-group delivery are recorded in v02-plan.md; evidence is in v02-execution.md. No canonical publication, structural migration or remote delivery is authorized.

## Problem Statement

The current Helpinet preview preserves source evidence but exposes only part of it usefully. Repeated facility names obscure distinct services, hours appear as raw JSON, and access information, native classifications, position and related offerings do not yet support efficient discovery. All inspected Helpinet descriptions are empty, although structured fields can support a concise source-based summary.

## Solution

Present one service at a time, with its own information and a provisional link to the source grouping where it is delivered. Use every Helpinet field as a coverage benchmark across retention, interpretation, display and search. Improve readable schedules, access information, icons, progressive filtering and distance ordering without inventing missing information or approving imported facts implicitly.

The user explicitly confirmed two decisions: start with deterministic summaries derived from structured fields, distinguishable from original descriptions, with AI generation deferred; use native Helpinet groups as provisional links between services rather than canonical deduplication.

## User Stories

1. As a person seeking help, I can distinguish the particular service from the facility and discover other services associated with it without losing each service's independent hours, access and contacts.
2. As a visitor, I can narrow results using need, service type and specific prestations, understand access information and read original hours in a useful weekly layout.
3. As a visitor, I can choose a reference position and compare known distances without losing services whose coordinates are unavailable.
4. As a maintainer, I can inspect a field-by-field coverage matrix and see the difference between source omissions, retained evidence and implemented product behavior.

## Acceptance Criteria

| ID | Observable behavior |
| --- | --- |
| AC01 | Original descriptions remain distinguishable from deterministic summaries. Empty original descriptions stay empty; a generated summary never becomes a publisher quotation or an editorially approved description. |
| AC02 | A deterministic summary uses only selected source-supported need/type/prestation information, with its recipe version and evidence recoverable. It does not invent cost, eligibility, delivery mode, availability or organization responsibility. A missing supporting field yields a limited or absent summary. AI generation remains deferred. |
| AC03 | The active detail represents exactly one source-local service, preserving its own identity, contacts, hours, access and native classifications. Navigation to another service changes the active service rather than aggregating independent attributes into a facility-wide claim. |
| AC04 | Related services use the retained native parent-group identifier. Their relationship is labelled provisional/source-derived; shared group, name or address does not create canonical facility, organization or service identity. Current same-address groupings support display without authorizing cross-source deduplication. |
| AC05 | A service shows its facility/group context and available related services, with a clear way to open each independently. Multiple services at one candidate delivery site remain discoverable on the map/list; a shared-position marker opens a service chooser. |
| AC06 | Positive source access flags can be presented as source claims under meaningful groups such as audience, access procedure, documents/requirements and cost. False or absent flags do not imply unrestricted access, absence of requirements or free service. Unresolved meaning remains visible with original evidence. |
| AC07 | Need, type and prestations retain their native identities and remain distinguishable dimensions. Progressive filtering supports efficient discovery without silently treating all dimensions as one canonical taxonomy tree. Needs combine with OR; type, prestation, positive access and text combine with AND. Labels remain source-native. |
| AC08 | Weekly source hours appear as readable day/interval information. Missing days or absent declarations are not displayed as confirmed closed. Inconsistent/ambiguous intervals and uncertainty over operating/contact/intake scope remain flagged. Open-now computation requires separately settled completeness/scope rules. |
| AC09 | Position information exposes source address, usable coordinates and uncertainty/itinerance where present. Icons consistently identify the active service's browsing classification, with a fallback; unknown location is never converted to a fabricated point. |
| AC10 | When a visitor explicitly chooses a reference position, usable coordinates can be ordered by straight-line distance. No browser location permission is accepted automatically. Missing-coordinate services remain listed with unavailable distance; reference controls support an explicit map point, coordinates or user-requested geolocation. |
| AC11 | Contact-only telephone/online services can belong to a directory/rubrica presentation. Missing coordinates/address alone does not establish remote delivery. A physical address without coordinates remains a geocoding case; unresolved delivery mode remains unresolved. |
| AC12 | A Helpinet coverage matrix accounts for every native field and records source population, retained evidence, interpretation state, display and search use separately. Source omissions are not disguised by generated content; retained but unused fields remain visible as implementation gaps. Counts belong to the selected capture, not hardcoded assumptions about future data. |
| AC13 | Original artifacts, source identifiers, prior interpretations and loading idempotency remain intact. These changes do not publish source claims, merge canonical identities or alter existing approval requirements. |

## Implementation Decisions

Confirmed:

- Descriptions already exist in the data model, but the inspected Helpinet capture provides no populated descriptions. Preserve that distinction.
- Begin with deterministic source-field summaries; retain original descriptions and derivation provenance separately. No LLM integration or automatic editorial approval is selected.
- Use native Helpinet parent groups as provisional related-service links, retaining independent service identities and characteristics. They are not canonical deduplication decisions.
- Keep the existing local, explicitly unreviewed preview and original evidence.

Requested product outcomes:

- Use all Helpinet information as a coverage benchmark; improve access information, hours, position, icons, classification/search and distance ordering.
- One active service detail with visible facility context and navigation to other services.
- A directory/rubrica presentation for genuinely contact-based services, distinct from missing geocoding.

Implementation details (recorded in the execution plan):

- Store/expose derivation metadata and native parent links through existing source-evidence boundaries before proposing new schema or API fields.
- Use need, type and prestations as separate search dimensions, with reviewed labels and mappings later.
- Show confirmed positive source claims separately from unknown/false flag semantics.
- Present source schedules before introducing any open-now assertion.
- Keep straight-line distance unavailable for missing coordinates and sort those cases predictably without excluding them.

## Testing Decisions

Prefer the established source/loader entrypoints, read-only preview API and real browser seams. Proposed acceptance cases: stable summaries for identical inputs; absent original descriptions remaining absent; two services in one source group with different schedules/contacts; positive versus false/unknown flags; absent days and ambiguous hours; a physical address without coordinates; an explicitly remote service without a physical site; unknown delivery mode; distance ordering including missing points; multiple native types/prestations; complete field coverage with source omissions distinguished from transformation loss.

Retain existing loader idempotency/history/rollback checks. No new test framework, live geocoder, location-permission grant or implementation is authorized by this specification. Detailed verification choices belong in the reviewed plan.

## Out of Scope

AI-generated descriptions, automatic canonical deduplication, invented eligibility/cost/location, external geocoding or routing integration, publication-policy changes, public deployment, structural migrations and unrelated importer source expansion. The existing preview remains a source-data workspace, not an approved public directory.

## Further Notes

Read-only inspection of the preserved capture found 201 source groups / 315 services; 59 groups have multiple services and all of those groups have matching address strings. These are evidence for provisional display, not proof of physical/canonical identity. Hours are nonempty for 302 services, coordinate pairs for 313, phone lists for 285 and emails for 256; original descriptions are empty for all 315. Both records without coordinates have addresses and must not become rubrica entries just because they lack a point.

Implementation choices, combination rules and verification are recorded in v02-plan.md and v02-execution.md. Future semantic review still needs to validate source access meanings, schedule scope/completeness, canonical classification and explicit remote-delivery assertions. The preview preserves these uncertainties.
