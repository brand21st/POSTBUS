# POSTBUS ROUTING / TRACKING MISMATCH AUDIT

Date: 18 Oct 2026  
Mode: **read-only** production SQL + source inspection.  
Live CEPT calls: **none**. Manual tracking jobs: **none**. Writes: **none**.  
Patches 2–4 / tracking-engine rewrite: **not started**.

Production app at last verified Coolify GET: SHA `d2beb8b420c70a9a68c22b60026b4128803e4a68`. This audit uses the current repository copies of the tracking pipeline (Patch 1 did not change ingest/parser/UI).

---

## 1. Executive Summary

PostBus is **not hiding** India Post routing scans for AWB `CX075364450IN`.

**There are zero `tracking_events` rows** for that shipment. **`last_event_at` is null.** Shipment status in Postgres is **`MANIFEST_READY`**, not `IN_TRANSIT`. The public page maps `MANIFEST_READY` + empty events to the label **BOOKED** and renders an empty Shipment Journey.

The same merchant org has **0 tracking_events for any shipment** and **0 shipments with `last_event_at`**, despite **thousands of SUCCEEDED `tracking-sync` jobs**. Background tracking therefore completes “successfully” **without persisting scan history**.

After the last successful job that touched this AWB (`last_tracked_at` **2026-10-17 14:51:13 UTC**), this org’s `tracking-sync` jobs are **FAILED `HTTP_403`** (97 in that window). Public India Post website scans are **not** proof that customer-scoped CEPT `POST /tracking/bulk` returned those events.

**Classification: H — multiple contributing issues**, dominated by **A (provider bulk data / authorization)** plus **C (last_tracked_at stamped on empty match)** plus **E/F/G display of stale BOOKED**.

---

## 2. Reference AWB

`CX075364450IN`

Internal shipment id (not customer PII): `828e7c16-d2ca-42e6-9e79-959c03727e3d`  
Org hash `md5(organization_id)`: `1611061c64c98c069cb5d84034c624ce`  
India Post connection: **CONNECTED** (no credential values read).

---

## 3. Official India Post vs PostBus comparison

| Field | Official India Post (user evidence) | PostBus production DB / UI |
| --- | --- | --- |
| Current status | IN TRANSIT | UI **BOOKED**; DB **`MANIFEST_READY`**, `operational_status` **null** |
| Journey | 9 scan events (Booked → Bagged → Dispatched → RMS → Destination SO → Invoiced → Bagged) | **Empty** |
| Event store | n/a | **`tracking_events` count = 0** |
| Last scan | Perinthalmanna SO (user) | `last_event_code/description/office/at` all **null** |
| Last tracked stamp | n/a | `last_tracked_at` **2026-10-17 14:51:13 UTC** |
| Booked-on | 16 Oct 2026 (user) | `booked_at` **2026-10-15 07:42:34 UTC** (shown as 15 Oct) |

---

## 4. Database Findings

Read-only query on `shipments` where barcode/tracking_number = `CX075364450IN`:

| Column | Value |
| --- | --- |
| `status` | `MANIFEST_READY` |
| `operational_status` | null |
| `provider` | `INDIA_POST` |
| `booked_at` | 2026-10-15 07:42:34+00 |
| `created_at` | 2026-10-15 07:42:32+00 |
| `last_tracked_at` | 2026-10-17 14:51:13+00 |
| `last_event_at` | **null** |
| `last_error_code` | null |
| `tracking_events` | **0** |

Related jobs on this **shipment entity**: booking, label, invoice, manifest, vachat `booked`, Shopify skipped (`not_shopify`). **No per-shipment `tracking-sync` row** (jobs are organization-scoped).

Org `tracking-sync` (72h snapshot at query time): 1853 SUCCEEDED; then after 14:51 UTC almost all new jobs **FAILED HTTP_403**.

Org-wide (same merchant): **`tracking_events` = 0**; shipments with `last_event_at` **= 0**; pollable barcodes **163**.

**CONFIRMED:** events are missing **in the database**, not only in the UI.

---

## 5. India Post API Findings

| Topic | Finding | Evidence | Verdict |
| --- | --- | --- | --- |
| Endpoint | `POST` `{session}/tracking/bulk` body `{ bulk: string[] }` | `IndiaPostProvider.trackShipment` `provider.ts` ~325–380 | CONFIRMED code |
| Chunk skip | HTTP **400/404** `continue` (empty chunk, job still success) | `provider.ts` 346–353 | CONFIRMED |
| HTTP **403** | **throws** (not treated as empty journey) | `provider.ts` 350–353 comment + throw | CONFIRMED |
| Parse | `parseBulkTrackingResponse` + `articlesForRequestedBarcodes` | `tracking-response.ts` 164–228 | CONFIRMED code |
| Match | `matchingBulkTrackingArticle` requires article number or single-row fallback with details | `apply-tracking.ts` 148–157 | CONFIRMED |
| Live CEPT body for this AWB | Not captured | Audit did not call CEPT | **UNVERIFIED** |
| Official website vs bulk | Different product; customer-scoped bulk | User instruction + 0 DB events | CONFIRMED distinction |
| This org after 14:51 | `tracking-sync` **HTTP_403** | SQL 97 FAILED | CONFIRMED |
| This org SUCCEEDED jobs | 2930 in 7d with `last_error_code` null and **still 0 events** | SQL | CONFIRMED outcome |

**Hypothesis (not payload-proven):** SUCCEEDED jobs returned **no matching `tracking_details`** (empty `data`, unmatched article numbers, or 400-skipped chunks). **Hypothesis:** later **403** is “not authorized” for Bulk Tracking while booking remains connected.

Do **not** treat public www.indiapost.gov.in HTML as a CEPT bulk response.

---

## 6. Tracking Event Ingestion

Pipeline: `workers/processor.ts` `syncTracking` → `provider.trackShipment` → `matchingBulkTrackingArticle` → `ingestBulkTrackingArticle`.

**If no article match** (`processor.ts` 727–733):

- Updates **`last_tracked_at` only**
- **Does not insert events**
- **Does not fail the job**

**If article has empty `tracking_details`** (`apply-tracking.ts` `ingestBulkTrackingArticle` 377–383):

- Same: **`last_tracked_at` only**

**If a detail has no parseable time** (`apply-tracking.ts` 323–331):

- Logs `india_post.tracking.missing_event_time` and **continues** (event dropped)

Duplicate uniqueness: `(organization_id, shipment_id, event_code, occurred_at)` — irrelevant here (zero rows).

This AWB matches the **empty-match / empty-details** DB fingerprint: `last_tracked_at` set, `last_event_at` null, event count 0.

**Events were not discarded after insert.** They **never landed**.

---

## 7. Status Mapping

Mapper (`event-mapper.ts` `classifyEvent` 85–148) **never ran** for this AWB (no ingested events).

If those official phrases were ingested, current mappings would be:

| Observed text | Phrase match | Operational |
| --- | --- | --- |
| Item Booked | (no booked rule in `classifyEvent`) | **null** (scan stored, status may stay booking-phase) |
| Item Bagged | `bagged` | DISPATCHED → shipment **IN_TRANSIT** |
| Item Dispatched | `dispatch` | DISPATCHED → **IN_TRANSIT** |
| Bag Received / Bag Received for Forwarding | `bag_received` | **IN_TRANSIT** |
| Item Received at Destination | `item_received` | **IN_TRANSIT** (not DELIVERED) |
| Item Invoiced to BO | no match | **null** (event still stored if ingested) |

`Item Received at Destination` is **not** mapped to DELIVERED. Older-scan downgrade is guarded by `eventIsOlder` / `canAdvanceShipmentStatus` (`event-mapper.ts` 215–289).

**Why UI says BOOKED:** `shipmentStatusKey` (`customer-track-view.ts` 212–218) maps `MANIFEST_READY` with **no events** to **`BOOKED`**.

This is **display mapping**, not a mapper bug on live scans.

---

## 8. Public Tracking API

Route: `GET /track?tracking=CX075364450IN` → `app/(public-tracking)/track/page.tsx` → `PostbusTrackPage` / `PublicTrackingPage` → `POST /api/v1/public/track` (`app/api/v1/public/track/route.ts`).

Lookup: `publicApexTrackLookup` / `publicTrackLookup` in `modules/tracking-pages/public.ts`.

Events: `tracking_events` ordered by `occurred_at` desc (`loadShipmentRelations` ~147–151). **Would return [].**

`lastUpdatedAt` is **`shipments.last_event_at`**, not `last_tracked_at` (`public.ts` ~206). Public “last updated” is **null** even though a poll ran.

`refreshLiveTracking` (`public.ts` 278–367) **calls CEPT bulk** on page lookup, then ingest. On throw (e.g. 403) it returns `liveTracking: "unavailable"` **without** a user-visible failure (`catch` 362–366). UI components **do not render `liveTracking`**. Journey still empty.

**Stale BOOKED is the stored shipment, not a CDN cache of events.** In-memory `liveCache` TTL exists only for successful live pulls.

---

## 9. Frontend Rendering

`toCustomerTrackView` maps `result.shipment.events` 1:1 (`customer-track-view.ts` 300–311).

`ShipmentJourney` (`shipment-journey.tsx` 12–13): if `events.length === 0`, copy *“Scan events will appear here once India Post updates this shipment.”*

It does **not** hide events because status is BOOKED. Tests already expect `MANIFEST_READY` + `events: []` → BOOKED + empty journey (`customer-track-view.test.ts`).

Empty copy **does not distinguish**:

- provider empty / unauthorized  
- request failed  
- not yet synchronized  
- events available  

`last_tracked_at` is **not shown**, so a failed/empty poll looks like “not updated yet.”

---

## 10. Booking Date Discrepancy

**CONFIRMED field:** public “Booked Date” = `shipments.booked_at` formatted (`customer-track-view.ts` 328–329).

**CONFIRMED source:** booking persistence uses `input.bookedAt || new Date().toISOString()` (`booking-run.ts` 77–87) at **CEPT booking success in PostBus**, not the later India Post **Item Booked** scan.

This row: `booked_at` **2026-10-15 07:42:34Z** (= 15 Oct 13:12 IST). Official “booked on 16 Oct” is a **different calendar day**, not a UTC/IST formatting of the same instant.

Timezone conversion **does not explain** 15 vs 16 Oct.

---

## 11. Confirmed Root Cause

**H. Multiple contributing issues.**

### CONFIRMED

1. **No events in PostBus** for this AWB or this org. Journey empty because the store is empty.  
   Severity: **P0** (customer-visible tracking).

2. **`last_tracked_at` is stamped when bulk returns no usable article** (`processor.ts` 727–733; `apply-tracking.ts` 377–383). Misleading “we tracked it.”  
   Severity: **P0**.

3. **Bulk HTTP 400/404 chunks are skipped; job can still SUCCEEDED** (`provider.ts` 351–353, 378–380).  
   Severity: **P0**.

4. **After 14:51 UTC, this org’s `tracking-sync` is HTTP_403 FAILED** — no successful ingest since the empty stamp.  
   Severity: **P0**.

5. **UI BOOKED** = `MANIFEST_READY` + no events (`customer-track-view.ts` 216–217).  
   Severity: **P2** (label), secondary to missing events.

6. **Public live CEPT errors are swallowed** (`public.ts` 362–366); UI ignores `liveTracking`.  
   Severity: **P1**.

7. **Booked date is PostBus booking clock**, not India Post scan date.  
   Severity: **P3**.

### UNVERIFIED (no CEPT body)

- Whether 14:51 bulk JSON contained this AWB with events that parsing dropped.  
- Exact CEPT 403 message (not dumped).  
- Whether public-page live lookup ran for this AWB (would also 403).

### Not the fault (for this AWB)

- Frontend hiding existing events  
- Status mapper mapping destination receipt to DELIVERED  
- Patch 1 auth-hold logic (do not change in this ticket)  
- Event deletion (none existed)

---

## 12. Required Code Fixes

**Do not implement until explicitly approved.** Minimal, no migration unless a later design needs it.

1. **Stop treating empty bulk as a successful track.** If `matchingBulkTrackingArticle` is null or `tracking_details` is empty, do **not** advance `last_tracked_at` as if scans were applied (or store a distinct “bulk_miss” without looking like a scan). Log **counts only** (requested vs matched vs empty), never raw CEPT bodies.

2. **Do not SUCCEEDED-complete a tracking-sync page when every chunk was 400/404 skip and `data` is empty.** Distinguish “articles not in CEPT yet” vs “unauthorized 403” vs “parse failure.”

3. **Surface 403** as tracking-API unauthorized (connection may still book). Do not equate with empty Routing Steps.

4. **Public `/track`:** if `liveTracking === "unavailable"` or stored events empty after a poll, show **provider/sync failure or no customer-API events**, not only “once India Post updates.”

5. **Optional display:** keep `MANIFEST_READY` internally; label “Booked” only when there is no scan; once events exist, use mapper (`Item Bagged` / dispatch → In Transit).

6. **Booked Date:** keep PostBus `booked_at` as “Booked in PostBus”; if a first `Item Booked` event exists, show that as “India Post booked.”

7. **Do not** add a second public-website scraper. Stay on documented bulk API; fix empty/403 handling.

Out of scope unless approved: Patch 2 scheduler starvation, Patch 3 timestamps, Patch 4 session lock.

---

## 13. Regression Test Plan

- Bulk `data: []` → **no** `last_tracked_at` bump (or explicit miss flag); **no** fake events.  
- Bulk article without `tracking_details` → same.  
- Bulk 400/404 all chunks → job **not** silent success for the page.  
- Bulk 403 → FAILED with code, **no** empty-journey success.  
- Article with Item Bagged / Item Dispatched / Item Received at Destination → events inserted; status **IN_TRANSIT**; **not** DELIVERED.  
- `MANIFEST_READY` + events → journey shows events even if status column lags.  
- Public track: `liveTracking: unavailable` copy visible.  
- Booked Date uses `booked_at`; does not use IST conversion to invent 16 Oct.  
- Multi-tenant: org B events never appear on org A AWB.  
- Mocks only; **no live CEPT** in CI.

---

## 14. Production Safety Risks

- Changing `last_tracked_at` semantics will increase poll frequency for “never scanned” AWBs (load on CEPT). Cap/backoff required.  
- Public `refreshLiveTracking` **writes** ingest on lookup — keep that off accidental live tests; 403 may already fail closed.  
- Do not map destination receipt to DELIVERED.  
- Do not log CEPT bodies / addresses / phones.  
- HTTP_403 may be CEPT entitlement; a code fix cannot create scans the customer API will not return.

---

## 15. Implementation Recommendation

**Wait for explicit fix approval.**

First production-safe change set: empty-match / empty-details **must not look like a successful track**, plus public-page distinction for **unavailable vs no scans**, plus 400-skip not marking the job fully successful.

Separately, operations should confirm with India Post whether this customer id is **entitled for Bulk Tracking** (403 cluster).

---

## Findings table (file / function / line)

| # | Issue | File | Function | Lines | Severity | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Empty DB events | production `tracking_events` | n/a | n/a | P0 | count 0 for AWB and org |
| 2 | Stamp on miss | `workers/processor.ts` | `syncTracking` | 727–733 | P0 | code + `last_tracked_at` set |
| 3 | Stamp on empty details | `modules/india-post/apply-tracking.ts` | `ingestBulkTrackingArticle` | 377–383 | P0 | code |
| 4 | 400/404 skip success | `modules/india-post/provider.ts` | `trackShipment` | 346–353, 378–380 | P0 | code + 2930 SUCCEEDED / 0 events |
| 5 | 403 job fail | same + jobs SQL | `trackShipment` | 354–363 | P0 | 97 FAILED HTTP_403 after 14:51 |
| 6 | Skip untimed events | `apply-tracking.ts` | `ingestBulkTrackingArticle` | 323–331 | P2 | code; **UNVERIFIED** for this AWB |
| 7 | BOOKED label | `customer-track-view.ts` | `shipmentStatusKey` | 212–218 | P2 | code + tests |
| 8 | Empty journey copy | `shipment-journey.tsx` | `ShipmentJourney` | 12–13 | P2 | code |
| 9 | Swallow live errors | `public.ts` | `refreshLiveTracking` | 362–366 | P1 | code |
| 10 | lastUpdated uses last_event_at | `public.ts` | `redactShipment` | ~206 | P2 | null while `last_tracked_at` set |
| 11 | Booked clock | `booking-run.ts` | persist BOOKED | 77–87 | P3 | `booked_at` 15 Oct vs IP 16 Oct |
| 12 | Mapper unused | `event-mapper.ts` | `classifyEvent` | 85–148 | n/a | no rows to map |

---

## Final questions

**Q1. Why India Post IN TRANSIT vs PostBus BOOKED?**  
CEPT-style public scans exist on India Post’s site. PostBus never stored those scans. DB status stayed `MANIFEST_READY`; the tracking page maps that + empty events to **BOOKED**.

**Q2. Why is Shipment Journey empty?**  
`tracking_events` is empty; the UI renders the empty state. It is not filtering out stored scans.

**Q3. Are actual tracking events stored in PostBus?**  
**No** for this AWB. **No** for the whole org (0 rows).

**Q4. Is the Bulk Tracking API returning events?**  
**UNVERIFIED body.** Outcomes: many SUCCEEDED syncs with **zero** persisted events, then **HTTP_403**. Official website HTML is not the bulk API.

**Q5. Are events discarded during ingestion?**  
**Not after insert.** They are **never inserted** on miss/empty (and untimed details would be skipped). Duplicate unique index not involved.

**Q6. Is `last_tracked_at` misleading?**  
**Yes.** Set on empty match / empty details. Looks tracked; `last_event_at` remains null.

**Q7. Is the public tracking API returning stale data?**  
It returns the **true empty store** plus `MANIFEST_READY`. Live refresh errors are hidden. Not a stale event list.

**Q8. What exact changes are required?**  
See §12. Do not deploy until approved. Do not rewrite the whole tracking engine.

---

## Safety

No production writes, no CEPT test calls, no job replay, no migrations, no Shopify changes, no event deletes, no status updates, no deploy in this audit.
