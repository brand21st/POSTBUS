# POSTBUS TRACKING SYSTEM AUDIT

Date: 17 Oct 2026  
Scope: repository inspection, existing tests, **read-only** production schema/job counts on `hgacoeoovjxkzfbesmvl`.  
No code changes. No India Post live calls. No Shopify writes. No job triggers.

Verification labels used below: **CONFIRMED**, **LIKELY**, **UNVERIFIED**, **NOT IMPLEMENTED**, **NOT APPLICABLE**.

---

## 1. EXECUTIVE SUMMARY

PostBus already implements the official CEPT **POST `/beextcustomer/v1/tracking/bulk`** path, a shared ingest pipeline (`applyIndiaPostTracking` / `ingestBulkTrackingArticle`), database-backed **background `tracking-sync` jobs**, a public `/track` page, Shopify fulfillment URLs of the form `https://www.postbus.in/track?tracking={AWB}`, and an India Post webhook inbox that is **CIDR-gated** (empty allowlist quarantines processing).

Production evidence that automatic tracking is **not** a browser-only feature:

| Fact | Value | Label |
| --- | --- | --- |
| Orgs with `auto_tracking_sync=true` | 53 | CONFIRMED (SQL) |
| `tracking-sync` jobs last 24h | 27,291 SUCCEEDED, 1,425 FAILED, 7 QUEUED | CONFIRMED (SQL) |
| Pollable barcoded shipments with `last_tracked_at` in last 2h | 509 / 509 | CONFIRMED (SQL) |

The system is **not** a greenfield gap. It is a working hybrid with operational waste (tens of thousands of jobs/day), **~5% job failures**, tracking workers that take the **booking session lock**, webhook authenticity that is **not** HMAC-based, and India Post rate limits that remain **unknown**.

**Verdict: PARTIALLY READY.**

---

## 2. CURRENT TRACKING ARCHITECTURE

### Actual diagram (discovered)

```
Merchant India Post connection (encrypted creds, per org)
        |
        v
IndiaPostProvider.trackShipment()
  POST {prod|uat}/beextcustomer/v1/tracking/bulk
  body { bulk: [AWB...] }  max 500, chunked
        |
        v
parseBulkTrackingResponse + articlesForRequestedBarcodes
        |
        +-- ingestBulkTrackingArticle / applyIndiaPostTracking
        |         |
        |         v
        |   tracking_events (unique org+shipment+event_code+occurred_at)
        |   shipments.status / operational_status / last_*
        |   orders.status (IN_TRANSIT | DELIVERED) when planned
        |
        +-- Merchant dashboard (DB read; optional POST /api/v1/ndr-rto/:id/sync)
        +-- Public /track + POST /api/v1/public/track (rate-limited; optional live CEPT)
        +-- Shopify fulfillment (tracking number + PostBus URL; separate job)
        +-- WhatsApp/VaChat side effects (enqueueTrackingStageSideEffects)

Scheduled path (not the merchant browser):
  POST /api/cron/jobs (CRON_SECRET)
    -> enqueueDueTrackingSyncJobs
    -> drainDueJobs / workers processJob("tracking-sync")
    -> syncTracking() in workers/processor.ts

Webhook path:
  POST /api/v1/webhooks/india-post/{connectionId}/{booking|events}
    -> acceptIndiaPostWebhook (CIDR / quarantine)
    -> provider_webhook_inbox + job india-post-events
    -> processIndiaPostInboxEvent -> applyIndiaPostTracking
```

This is **not** Redis-required for the default runner. `JOB_RUNNER` defaults to **database** (`lib/env.ts`). Redis/BullMQ exists only if `JOB_RUNNER=redis`.

SFTP tracking (document §1.7): **NOT IMPLEMENTED** in application code. REST bulk is the implemented channel.

---

## 3. INDIA POST API COMPLIANCE

### Endpoints (code, not a live probe)

| Environment | Host allowlist | Default base (`lib/env.ts`) | Session tracking URL |
| --- | --- | --- | --- |
| UAT / sandbox | `test.cept.gov.in` | `https://test.cept.gov.in/beextcustomer` | `{root}/v1/tracking/bulk` |
| PRODUCTION | `app.indiapost.gov.in` | `https://app.indiapost.gov.in/beextcustomer` | `{root}/v1/tracking/bulk` |

Isolation: `assertIndiaPostEnvironmentUrl` **CONFIRMED** refuses sandbox host for PRODUCTION and production host for UAT (`modules/india-post/environment.ts`).

Effective Coolify `INDIA_POST_PROD_BASE_URL` on the running site: **UNVERIFIED** (secrets not printed). Code default matches the documented production host, not `test.cept.gov.in`.

### Bulk contract vs code

| Spec | Implementation | Label |
| --- | --- | --- |
| POST JSON | `fetch(..., { method: "POST" })` | CONFIRMED |
| Bearer token | `Authorization: Bearer ${token}` | CONFIRMED |
| Body `{ bulk: [...] }` | `JSON.stringify({ bulk })` | CONFIRMED |
| Max 500 | `INDIA_POST_TRACKING_BULK_LIMIT = 500`; `chunkIds` | CONFIRMED |
| Documented response `booking_details`, `tracking_details`, `del_status` | Zod `passthrough` + aliases | CONFIRMED |
| Customer ID restriction | Relies on **that merchant’s** CEPT login; no extra client-side customer-id filter on AWB list | LIKELY (provider-enforced) |

Login: `POST .../v1/access/login` with encrypted username/password (`provider.login`). Tokens cached on `india_post_connections` with 60s expiry skew. `refresh_token` is **stored** but **not used**; expiry always re-logins. **CONFIRMED**.

---

## 4. BULK TRACKING AUDIT

File: `modules/india-post/provider.ts` `trackShipment` (approx. lines 323–378).

| Question | Finding | Label |
| --- | --- | --- |
| Official bulk API? | Yes, `/tracking/bulk` | CONFIRMED |
| Empty AWBs excluded? | `trim` + `filter(Boolean)` | CONFIRMED |
| Duplicates removed? | `new Set(...)` | CONFIRMED |
| Batches >500? | `chunkIds(..., 500)` | CONFIRMED |
| Match by AWB not array index? | `articlesForRequestedBarcodes` / `matchingBulkTrackingArticle` by article number | CONFIRMED |
| One-AWB fallback if CEPT omits number? | Single requested + single article with scans still accepted | CONFIRMED (intentional; tests) |
| HTTP 400/403/404 on a chunk? | **Entire chunk skipped** (`continue`), no throw | CONFIRMED |
| HTTP 200 `success: false`? | Throws; remaining chunks abort | CONFIRMED |
| Malformed JSON? | `response.json().catch(() => ({}))` then schema parse may 502 | CONFIRMED |
| Partial missing AWB? | Caller stamps `last_tracked_at` and continues | CONFIRMED (worker) |
| Isolate per-AWB HTTP failures? | **No** (worktree had experimental isolate; main `trackShipment` does not) | CONFIRMED |

### Scalability (theoretical; no load test)

Assumptions: page size 500, worker `maxPages = 4` ⇒ **2,000 AWBs per job**, then re-enqueue (`workers/processor.ts` ~754–761). Cron enqueue limit default **50 orgs**. Interval default **15 minutes**. India Post **rate limit: UNKNOWN**.

| Active AWBs (one org) | CEPT batches / cycle | Jobs (2k/page cap) |
| --- | --- | --- |
| 100 | 1 | 1 |
| 500 | 1 | 1 |
| 1,000 | 2 | 1 |
| 5,000 | 10 | 3 |
| 10,000 | 20 | 5 |
| 50,000 | 100 | 25 |
| 100,000 | 200 | 50 chained |

**Bottleneck CONFIRMED today:** 53 orgs all have auto-sync; **~27k SUCCEEDED jobs / 24h**. Enqueue does **not** check whether any shipment is due; it creates a job whenever the org is idle. Empty due-sets still cost a job drain. At 100k AWBs this model becomes CEPT- and queue-heavy; serverless `maxDuration = 300` on `/api/cron/jobs` is a drain-window risk if `JOB_RUNNER=database` and many jobs run inline.

No `last_tracked_at` index on production (`pg_indexes` read-only). Fine at ~1.5k shipments; **LIKELY** painful at 50k+ due queries.

---

## 5. INDIVIDUAL TRACKING AUDIT

| Path | Mechanism | Same ingest? | Session helper |
| --- | --- | --- | --- |
| Shipment detail “Refresh tracking” | `POST /api/v1/ndr-rto/:id/sync` → `syncNdrShipment` | Yes `ingestBulkTrackingArticle` | **`ensurePersistedIndiaPostTrackingSession`** (no booking lock) |
| NDR list visible page | `POST /api/v1/ndr-rto/sync-visible` one bulk call | Yes | Tracking session |
| Public `/track` live refresh | `refreshLiveTracking` in `modules/tracking-pages/public.ts` | Yes | **`ensurePersistedIndiaPostSession`** (**booking lock**) |
| Background | `syncTracking` | Yes | **`ensurePersistedIndiaPostSession`** (**booking lock**) |

Dashboard orders list does **not** bulk-call CEPT on table load. Shipment detail **polls GET `/api/v1/shipments/:id` every 15s** while `shipmentNeedsLiveTracking` (`refetchInterval`). That is DB refetch, not CEPT, unless the user hits Refresh. **CONFIRMED**.

Loading/errors: toast on sync success/fail. Public live failures become `"Live tracking unavailable."` without exposing CEPT text. **CONFIRMED**.

Stale vs fresh: public in-process cache `LIVE_TTL_MS = 60_000` labeled `liveTracking: "cached"`. Merchant GET uses DB. **CONFIRMED**.

Repeat expensive CEPT: public 20 req/min/IP (`app/api/v1/public/track/route.ts`). Merchant NDR sync: **no dedicated CEPT rate limit** found. **CONFIRMED** gap (P2).

---

## 6. BACKGROUND TRACKING AUDIT

| Question | Answer | Label |
| --- | --- | --- |
| Worker exists? | `syncTracking` in `workers/processor.ts` | CONFIRMED |
| Scheduler? | `POST /api/cron/jobs` → `enqueueDueTrackingSyncJobs` | CONFIRMED |
| Browser required? | No; jobs in `background_jobs` | CONFIRMED (27k/24h) |
| Merchant login required? | No | CONFIRMED |
| Frequency? | Default min interval **900_000 ms (15 min)**; unscanned barcodes as low as **2 min** | CONFIRMED (code). Actual Coolify cron period **UNVERIFIED** |
| Which shipments? | Barcode not null; status in `TRACKING_POLL_STATUSES`; not `operational_status = RTO_DELIVERED`; due `last_tracked_at` filter | CONFIRMED |
| Newly booked? | BOOKED / LABEL_READY / MANIFEST_READY included | CONFIRMED |
| In-transit / OFD / NDR / RTO? | Yes | CONFIRMED |
| Stop when delivered? | `DELIVERED` **not** in poll list | CONFIRMED |
| Duplicate open jobs? | Skip if QUEUED/PENDING/RUNNING/RETRYING | CONFIRMED |
| Resume after restart? | Database jobs; drain/workers reclaim | LIKELY |
| Stalled jobs? | Standard job retry (`lib/jobs/retry`); 7 QUEUED now | PARTIAL |
| Monitor last success? | `logInfo india_post.tracking.sync_ok`; no dedicated admin tracking dashboard | CONFIRMED gap |
| Failures 24h | 1,425 FAILED (~5%) | CONFIRMED; **root cause UNVERIFIED** (error text not queried) |

`TRACKING_POLL_STATUSES`: BOOKED, LABEL_READY, MANIFEST_READY, IN_TRANSIT, OUT_FOR_DELIVERY, NDR, RTO (`apply-tracking.ts`).

Production mix with barcodes (read-only): MANIFEST_READY 474, FAILED 70, IN_TRANSIT 20, LABEL_READY 15, DELIVERED 14, QUEUED 3.

---

## 7. AUTHENTICATION AND TOKEN MANAGEMENT

| Topic | Finding | Label |
| --- | --- | --- |
| Cache until ~15 min | `expires_in` from login; reuse if >60s remaining | CONFIRMED |
| Refresh grant | Stored, unused; full login on expiry | CONFIRMED |
| Concurrent logins | `withProcessSessionLock` per connection; tracking helper uses it | CONFIRMED |
| Background tracking vs booking | Worker tracking uses **`ensurePersistedIndiaPostSession` → booking advisory lock** | CONFIRMED **P1** |
| Manual NDR sync | Tracking session **without** booking lock | CONFIRMED |
| 401 login | `PERMANENT_AUTH_ERROR` | CONFIRMED |
| 401 mid-track | Not retried with new token; throws (not in 400/403/404 skip list) | CONFIRMED |
| Browser exposure | Tokens only on `india_post_connections` encrypted columns; not in public redact | CONFIRMED |
| Cross-merchant creds | Connection keyed by `organization_id` | CONFIRMED |
| Logs | Webhook masks tracking numbers; login body not logged in provider | LIKELY |

A failed login **does** abort that org’s `syncTracking` (throw). Other orgs are separate jobs. **CONFIRMED**.

---

## 8. TRACKING EVENT PROCESSING

`ingestBulkTrackingArticle` sorts scans by `bulkEventOccurredAt` (civil date + time as **+05:30**, ISO passthrough). Events **without** a parseable time are skipped (`missing_event_time` log). **CONFIRMED**.

History: **all** parseable events inserted, not latest-only. Duplicate unique `(organization_id, shipment_id, event_code, occurred_at)` → Postgres `23505` treated as duplicate; status plan still runs. **CONFIRMED** (`tracking_events_dedupe_uidx` present in production).

Older than `last_event_at`: `planTrackingUpdate` sets `applyStatus: false` (no downgrade). `updateLastScan` also false for older. WhatsApp on older non-duplicate is possible; duplicates clear notifies. **CONFIRMED**.

Unknown events: `classification` null → last scan fields update, shipment status unchanged. **CONFIRMED**.

`rts: true` → operational RTO. **CONFIRMED**.

`del_status.del_status === "delivered"` synthesizes ITEM_DELIVERED if not already return/delivered. **CONFIRMED**.

Insert event then update shipment: **not one DB transaction**. Insert success + update fail → retry is idempotent on event, may miss status once. **CONFIRMED P2**.

Webhook vs poll: same `applyIndiaPostTracking`; older webhook cannot overwrite newer `last_event_at`. **CONFIRMED**.

---

## 9. SHIPMENT STATUS MAPPING

Classifier: `modules/india-post/event-mapper.ts` `classifyEvent` — **phrase matching on code+description**, not a closed official code list.

| Pattern (normalized) | Operational | Shipment status | Risk |
| --- | --- | --- | --- |
| rto_delivered / delivered_to_sender | RTO_DELIVERED | RTO | Low |
| return in transit / redirected_to_sender | RTO_IN_TRANSIT | RTO | Low |
| `rts===true` or return_to_sender | RTO | RTO | Low |
| `non_delivery_reason` set | NDR | NDR | Low |
| item_delivered | DELIVERED | DELIVERED | Low |
| undelivered / delivery_attempt | NDR | NDR | Low |
| out_for_delivery / ofd | OUT_FOR_DELIVERY | OUT_FOR_DELIVERY | Low |
| **delivered** (if not intimation) | DELIVERED | DELIVERED | Medium if CEPT wording is ambiguous |
| bag_close / dispatch / bagged | DISPATCHED | IN_TRANSIT | Low |
| in_transit / item_received / **bag_received** | IN_TRANSIT | IN_TRANSIT | **Bag Received is not OFD** — CONFIRMED |
| held_up / delay / detention | delay flag, not DELIVERED | last-scan only unless other class | **Hold ≠ Delivered** — CONFIRMED |
| unmatched | null | no status change | Safe |

Ranks prevent booking-phase regression; DELIVERED is sticky unless return operational. **CONFIRMED**.

UI extras (Reached Destination, On Hold as first-class statuses): **NOT IMPLEMENTED** as `shipment_status` values.

---

## 10. DATABASE AND MULTI-TENANT AUDIT

| Object | Role | Isolation |
| --- | --- | --- |
| `shipments` | AWB, status, last_tracked_at, last_event_* | Unique `(org, barcode)` |
| `tracking_events` | History | Unique org+shipment+code+time; RLS enabled |
| `india_post_connections` | Creds | Per org |
| `background_jobs` | tracking-sync, india-post-events | `organization_id` |
| `provider_webhook_inbox` | Raw CEPT | Org + hash/event unique indexes |
| `automation_settings.auto_tracking_sync` | Opt-in | Per org |

Merchant APIs use tenant context (`ndr-rto.test.ts` rejects other-tenant sync). Public lookup uses `public_find_shipment` / `public_find_shipment_global` RPCs then **redacts** phone/address. **CONFIRMED** for redaction in `redactShipment`. RPC SQL body: not re-audited line-by-line this pass — isolation **LIKELY** from prior public-track work; hosted RPC **UNVERIFIED** beyond existence implied by production traffic.

Webhook `findShipmentByArticle`: if **two** orgs share an AWB, returns null (fail closed). **CONFIRMED**.

---

## 11. WEBHOOK AUDIT

| Topic | Finding | Label |
| --- | --- | --- |
| Endpoint | `/api/v1/webhooks/india-post/{uuid}/booking\|events` | CONFIRMED |
| Sample fields | `CEPT_SAMPLE_WEBHOOK_PAYLOAD` matches documented names | CONFIRMED |
| Signature | **None** in CEPT sample; app does **not** invent HMAC | CONFIRMED |
| Auth in app | Optional IPv4 CIDR allowlist; **empty list quarantines** (ack but no ingest) | CONFIRMED |
| Default `.env.example` | `INDIA_POST_WEBHOOK_ALLOWED_CIDRS=` empty | CONFIRMED |
| Production CIDR | **UNVERIFIED** (not printed) | |
| Inbox rows | 5; `india-post-events` jobs 5 in 24h | CONFIRMED some path executed |
| Idempotency | hash + barcode:code:timestamp; RPC `accept_india_post_webhook` | CONFIRMED |
| Async | Job `india-post-events` | CONFIRMED |
| Static IP / CEPT whitelist | Must be confirmed with CEPT | UNVERIFIED |
| Official CEPT enablement | UNVERIFIED | |

Hybrid poll+webhook is **implemented** and status-rank/time guarded. **CONFIRMED**.

---

## 12. SHOPIFY INTEGRATION AUDIT

`shopifyTrackingInfo` / `buildPostBusTrackingUrl`:

- URL: `https://www.postbus.in/track?tracking={AWB}`  
- Rejects `indiapost.gov.in` URLs  
- Company PostBus  

Fulfillment is job `shopify-fulfillment` after booking/manifest, **not** created by tracking-sync. Tracking ingest can `syncShopifyOrderStage` for in_transit/delivered via optional automation (`tracking-effects.ts`) — **fulfillment create vs stage update are separated**. **CONFIRMED** in code. Live Shopify API success: **UNVERIFIED**.

Saving PostBus events does **not** by itself set Shopify’s native delivery status unless that Shopify stage sync runs. **CONFIRMED**.

---

## 13. FRONTEND TRACKING AUDIT

**Public:** `app/(public-tracking)/track/page.tsx`, `PostbusTrackPage`, APIs above. Rate limit 20/min. Live CEPT optional. Redacts phone/full address; still exposes city/state, order number, COD amount if COD, event office names. **CONFIRMED**.

**Merchant:** shipment detail timeline from `tracking_events`; Refresh via NDR sync; `last_tracked_at` shown. Orders page: no bulk CEPT. **CONFIRMED**.

**Failed updates:** worker sets `last_tracked_at` even when CEPT returns no article — UI can look “fresh” without new scans. Toast distinguishes “no scans yet” on manual sync. **CONFIRMED**.

---

## 14. SECURITY AUDIT

| Risk | Severity | Notes |
| --- | --- | --- |
| Cross-tenant shipment/event reads | P0 not demonstrated | Tenant filters + unique barcode per org |
| Public PII | P2 | Cities, order number, COD; not phone |
| Webhook spoofing if CIDR empty vs 0.0.0.0/0 | P1 if allowlist is `/0`; P2 if quarantined | Empty = quarantine (safe default) |
| Credential leak in FAILED job last_error | UNVERIFIED | Not queried |
| Service-role in public live refresh | By design; org-scoped ingest | CONFIRMED |

---

## 15. PERFORMANCE AUDIT

Measured: 509 pollable AWBs all touched in 2h; 27k sync jobs/day. **CONFIRMED** over-enqueue.

Estimates only beyond current volume. Unknown CEPT QPS. In-memory public cache is **per server instance**, not shared. Sequential `applyIndiaPostTracking` per event (N+1 writes) **CONFIRMED**.

---

## 16. RELIABILITY SCENARIOS

| ID | Current | Expected safe | Sev | Files |
| --- | --- | --- | --- | --- |
| A CEPT down | Job throws, FAILED, retry | Same; don’t mark scans delivered | P1 | processor `syncTracking`, provider |
| B Token expired | Re-login if >60s; mid-request 401 fails job | Re-auth once per request | P2 | `provider.token` |
| C One batch HTTP 5xx | Whole `trackShipment` throws | Retry batch | P2 | provider |
| D One AWB missing | last_tracked_at updated | Same | OK | processor |
| E success:false | Throw | Treat as provider error | OK | provider |
| F Bad JSON | Schema 502 / throw | Same | OK | tracking-response |
| G Partial list | Match by AWB | Same | OK | articlesForRequestedBarcodes |
| H DB insert fail | TEMPORARY_PROVIDER_FAILURE | Retry | P2 | apply-tracking |
| I Worker dies mid-batch | Job retry; events unique | Same; possible re-CEPT | P2 | jobs |
| J Duplicate jobs | Open-job skip | Same | OK | tracking-sync |
| K Creds revoked | PERMANENT_AUTH_ERROR | Stop that org | OK | login |
| L Two merchants | Isolated jobs | Same | OK | org_id |
| M Webhook before poll | Same ingest | Same | OK | webhook.ts |
| N Poll older than webhook | eventIsOlder | Same | OK | event-mapper |
| O Unknown event | Scan only | Same | OK | classifyEvent |

Retries do not duplicate tracking_events (unique index). **CONFIRMED**. Uncontrolled CEPT amplification from 27k jobs/day is the larger retry-adjacent issue. **CONFIRMED**.

---

## 17. OBSERVABILITY

Logged: `india_post.tracking.sync_ok` (org, jobId, durationMs, pages, barcodesSynced), `sync_fail` message, webhook accept/quarantine/duplicate, duplicate events.

Missing as first-class admin metrics: CEPT latency histogram, per-org fail rate, backlog of due AWBs, last CEPT 401 org list. **CONFIRMED** gap.

---

## 18. PRIORITIZED BUG / RISK REPORT

| Priority | Issue | Evidence | Root cause | Impact | Recommendation |
| --- | --- | --- | --- | --- | --- |
| P1 | ~1,425 FAILED `tracking-sync` jobs / 24h | SQL counts | **UNVERIFIED** without error column | Missed/delayed scans for some orgs | Inspect `last_error`/`progress` in a **follow-up** (may contain CEPT text); fix classified causes |
| P1 | Background tracking takes **booking** session lock | `processor.ts` `ensurePersistedIndiaPostSession` vs `ensurePersistedIndiaPostTrackingSession` | Wrong helper | Booking and tracking can block each other | Use tracking session helper in `syncTracking` (and public live refresh) |
| P1 | Job storm: enqueue without due-AWB check | 27k jobs/24h, 53 orgs | `enqueueDueTrackingSyncJobs` always queues idle orgs | DB/cron/CEPT waste | Enqueue only if due shipments exist |
| P2 | HTTP 400/403/404 skips **whole 500-AWB chunk** | `trackShipment` continue | Batch treated as one HTTP | One bad AWB can delay 499 | Isolate failures only with CEPT-confirmed behavior |
| P2 | No 401 retry inside `trackShipment` | provider | Token skew | Failed job until retry | One re-login on 401 |
| P2 | `refresh_token` unused | `login` always | Extra logins | Login rate risk | Use refresh if CEPT documents it |
| P2 | No `last_tracked_at` index | `pg_indexes` | Schema | Scale | Add index when volume grows |
| P2 | Event insert + shipment update not transactional | apply-tracking | Two round-trips | Rare split brain | Single function/transaction |
| P2 | Public live CEPT uses booking lock | public.ts | Same helper as booking | Public track vs book contention | Tracking session helper |
| P2 | Merchant manual sync unbounded | no rate limit on ndr-rto sync | Missing limiter | CEPT abuse | Per-org rate limit |
| P2 | Webhook not cryptographically signed | CEPT sample + code | Provider | Spoofing if CIDR weak | Confirm CEPT IPs; never `0.0.0.0/0` |
| P3 | In-process public live cache | LIVE_TTL 60s | Multi-instance | Extra CEPT | Shared cache later |
| P3 | SFTP tracking | No code | REST-only | N/A if REST sufficient | Confirm with CEPT if required |

No **P0** cross-tenant leak demonstrated.

---

## 19. MISSING vs MALFUNCTIONING

**Missing / not in product**

- SFTP tracking ingest  
- First-class “On Hold” / “Reached Destination” shipment statuses  
- Signed CEPT webhook  
- Admin tracking-ops dashboard  
- Documented India Post QPS contract in-app  

**Present but strained / inconsistent**

- Automatic bulk poll (runs, over-enqueued, some failures)  
- Session lock choice (manual vs background)  
- Webhook (code ready; production enablement UNVERIFIED)  

---

## 20. VERIFIED WORKING FEATURES

- Official bulk POST `{ bulk }` with 500 chunking, unique AWB set  
- Parse documented + aliased CEPT JSON  
- AWB-keyed matching (not index-only)  
- Shared ingest + unique event history + no status downgrade on older scans  
- Bag Received → IN_TRANSIT; hold/delay ≠ Delivered  
- Database cron/jobs; 53 orgs auto-sync; `last_tracked_at` heartbeat on all pollable rows  
- Public `/track?tracking=` + 20/min rate limit + PII redaction of phone/address  
- Shopify PostBus tracking URL builder + tests  
- Webhook parser/inbox/idempotency/job pipeline in code  
- Production env host isolation for UAT vs `app.indiapost.gov.in`  
- Unit tests: `tracking-response.test.ts`, `apply-tracking.test.ts`, `tracking-sync.test.ts`, `event-mapper.test.ts`, `webhook-process.test.ts`, `ndr-rto.test.ts`, `provider.session.test.ts`

---

## 21. UNVERIFIED ITEMS

- Live CEPT 200 body shape in production today  
- Coolify values of `INDIA_POST_PROD_BASE_URL`, cron schedule, `INDIA_POST_WEBHOOK_ALLOWED_CIDRS`, `JOB_RUNNER`  
- Reason strings for 1,425 FAILED jobs  
- Whether CEPT has actually enabled webhooks for merchants  
- Shopify fulfillment API outcomes  
- Hosted RLS of `public_find_shipment*` beyond code review  
- India Post rate limits and commercial API costing  
- Multi-instance public cache behavior  

---

## 22. RECOMMENDED FIX PLAN (DO NOT IMPLEMENT IN THIS AUDIT)

**Phase 1 — Critical ops (no CEPT contract change)**  
1. Classify FAILED tracking-sync errors (read-only).  
2. Switch `syncTracking` + public live refresh to `ensurePersistedIndiaPostTrackingSession`.  
3. Enqueue tracking-sync only when due barcodes exist.

**Phase 2 — Reliability**  
4. 401 re-login once per `trackShipment`.  
5. Merchant sync rate limit.  
6. Confirm webhook CIDRs with CEPT; keep quarantine if unknown.

**Phase 3 — Performance**  
7. Index `(organization_id, last_tracked_at)` WHERE barcode not null.  
8. Reduce empty jobs; consider longer interval for MANIFEST_READY with no scans.  
9. Batch DB writes if event volume grows.

**Phase 4 — Webhook / advanced**  
10. Production webhook enablement with CEPT IP list.  
11. Optional isolate-failure bulk mode **only** if CEPT documents partial HTTP errors.  
12. Ops dashboard for sync_ok/fail.

Regression tests already exist for mapping, matching, enqueue skip, webhook sample; extend with “tracking session must not take booking lock” and “enqueue skipped when no due rows”.

---

## 23. FINAL PRODUCTION READINESS VERDICT

### PARTIALLY READY

- **Bulk Tracking API:** correctly implemented in code (method, path, `{bulk}`, 500, matching). Live CEPT not probed this audit.  
- **Individual tracking:** implemented via NDR sync + public live; same ingest as bulk.  
- **Automatic background tracking:** **actually running** (job + `last_tracked_at` evidence), not dashboard-bound. Efficiency and ~5% failures prevent a full READY.  
- **Statuses:** mapping is conservative; Bag Received / Hold not mis-tagged as OFD/Delivered in code. Ambiguous “delivered” substring remains a residual risk.  
- **Database:** sound uniqueness and org binding at current scale; missing due-index and over-jobbing.  
- **Webhooks:** **code-ready, production-enablement UNVERIFIED**; fail-closed quarantine when CIDR empty.  
- **Shopify:** URL/fulfillment payload **correct in code**; delivery-status update optional and separate.

**Do not treat this document as authorization to change code or production.**

---

## SUMMARY ANSWERS

| Question | Answer |
| --- | --- |
| What works? | Bulk REST client, ingest/history, status guards, public track, Shopify URL, DB-backed auto-sync heartbeat |
| What is broken / strained? | Job storm; 1,425 failed jobs/day; booking lock on background tracking; unused refresh tokens |
| What is missing? | SFTP; signed webhooks; ops UI; proven CEPT QPS |
| Bulk API correct? | **Yes in code** (CONFIRMED). Production payload **UNVERIFIED** |
| Individual tracking correct? | **Yes**, same pipeline (CONFIRMED) |
| Automatic background running? | **Yes** (CONFIRMED via jobs + last_tracked_at) |
| Statuses accurate? | **Mostly** (CONFIRMED mapping tests); CEPT wording **UNVERIFIED** |
| DB architecture reliable? | **Yes at current volume** (CONFIRMED); scale indexes/jobs P2 |
| Webhook ready? | **Implementation yes; production CEPT/CIDR UNVERIFIED** |
| Shopify tracking correct? | **URL/payload yes in code** |
| Production-ready? | **PARTIALLY READY** |
| Fix first? | FAILED-job triage, tracking session lock, enqueue-only-when-due |

STOP. Wait for explicit approval before any code or database change.
