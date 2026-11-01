# POSTBUS Bulk Tracking Production Audit

Date: 2026-10-10  
Production app: https://www.postbus.in  
Coolify: `mw9larpomkyonxzy1rk3h6jm` **running:healthy**  
Production commit: `865d295d8401aa55a3b20c6a1f937ceda94d846a` (`support-center-release`)  
CEPT doc: India Post External Integrations Approach Document (updated 30.07.2026), Bulk/Individual Tracking API (summary §4.2 / detailed tracking section).  
Webhooks: **not enabled, not implemented in this audit.**

This audit is read-only. No production writes, re-sync, deploy, push, cron change, CEPT webhook activation, Shopify, or WhatsApp.

---

## 14. Production readiness / GO–NO-GO

**NO-GO as “fully operational and reliable Bulk Tracking.”**

The **scheduler and job runner are alive**. CEPT login works for most connected production tenants. **Tracking events are not being ingested from Bulk Tracking onto shipments.** Dashboard NDR/RTO/`operational_status` therefore cannot match live CEPT scans.

| Gate | Result |
|---|---|
| API wiring vs documented `/v1/tracking/bulk` | GREEN (code + Coolify host) |
| Automatic tracking-sync execution | GREEN (jobs succeeding every minute-scale drain) |
| CEPT event → `tracking_events` (last 24h) | **RED** (0 new events) |
| `operational_status` persistence | **RED** (192/192 barcoded NULL) |
| Auth reliability | YELLOW (2 orgs, 246 failed jobs/24h, re-enqueue storm) |
| Classifier correctness (unit tests + live event names) | GREEN (if events were applied) |
| Shopify / WhatsApp isolation | GREEN (code + mocks) |

**Do not run production re-sync or reconciliation until a follow-up fix is approved.**

---

## 1. Current implementation architecture

```
Coolify CRON_SECRET → POST /api/cron/jobs  (JOB_RUNNER=database)
        → enqueueDueTrackingSyncJobs()
              automation_settings.auto_tracking_sync = true
              india_post_connections CONNECTED (or username present)
              skip if open tracking-sync job
        → drainDueJobs → processJob("tracking-sync")
              ensurePersistedIndiaPostSession (login or reuse token)
              page shipments (max 500, up to 4 pages)
              POST {root}/v1/tracking/bulk  { bulk: [AWBs] }
              matchingBulkTrackingArticle by booking_details.article_number
              ingestBulkTrackingArticle → applyIndiaPostTracking
              enqueueTrackingStageSideEffects (WhatsApp/Shopify gated)
```

Documented production session host (Coolify `INDIA_POST_PROD_BASE_URL`): **`app.indiapost.gov.in`**, path `/beextcustomer/v1`.  
Code builds `indiaPostSessionUrl(PRODUCTION, "/tracking/bulk")` → `https://app.indiapost.gov.in/beextcustomer/v1/tracking/bulk`.  
UAT host `test.cept.gov.in` matches the sample URL in the CEPT document. Tenant `environment` on `india_post_connections` selects which host is used. **14 PRODUCTION CONNECTED, 1 UAT CONNECTED.**

Bulk payload matches the document: `POST` + `Authorization: Bearer` + JSON `{ "bulk": [ "RK…" ] }`, max **500** (`INDIA_POST_TRACKING_BULK_LIMIT`). Customer ID is **not** in the tracking URL (booking uses `/process-articles/{customerId}`; tracking is credential-scoped per the document).

---

## 2. Confirmed working features

- Production SHA `865d295` live; `/api/health` API + database Healthy.
- `POST /api/cron/jobs` is draining: **1,580 `tracking-sync` SUCCEEDED in the last 2 hours**, 14 orgs succeeded in 24h.
- 30 workspaces have `auto_tracking_sync = true` (1 false).
- Access tokens: 13/14 PRODUCTION CONNECTED tokens still fresh (>60s).
- Page size capped at 500; tests assert the CEPT limit.
- Mapper unit tests: Delivered(Addressee), OFD, dispatch/bagged/bag received, hold≠NDR, `rts===true`, Shopify/WhatsApp isolation.
- Webhook CIDR env **absent** on Coolify → ingest remains quarantined.
- Schema already has `operational_status`, NDR/RTO columns, `tracking_events.classification`, `tracking_events_dedupe_uidx`, RLS.

---

## 3. API compatibility

| Requirement (CEPT doc) | Implementation | Verdict |
|---|---|---|
| POST `/v1/tracking/bulk` | `IndiaPostProvider.trackShipment` | Compatible |
| Bearer token | `Authorization: Bearer ${token()}` | Compatible |
| Body `{ bulk: string[] }` | Yes | Compatible |
| Max 500 articles | `chunkIds(..., 500)` | Compatible |
| Parse `booking_details`, `tracking_details`, `del_status` | Zod `parseBulkTrackingResponse` passthrough | Compatible |
| Fields date/time/office/officeid/event/remarks/rts | Mapped in `ingestBulkTrackingArticle` | Compatible |
| Partial / unknown articles | `articlesForRequestedBarcodes` drops extras | Compatible |
| HTTP 400/403/404 | **Entire chunk skipped** (`continue`) | **Risk** — one bad AWB can empty a page of 500 |
| 429 / 5xx | Throw; retry classifier | Compatible |
| Refresh token | Stored, **never used**; expiry → full `login()` | Gap |
| Live response shape on production today | **UNVERIFIED** (no CEPT call this audit) | — |

---

## 4. Tracking worker status

- **Jobs execute automatically.** Failed jobs are not in the “open” set, so they are **re-enqueued on every drain**.
- Eligibility: barcode not null; status in `BOOKED | LABEL_READY | MANIFEST_READY | IN_TRANSIT | OUT_FOR_DELIVERY | NDR | RTO`; not `RTO_DELIVERED`; `last_tracked_at` null or older than 15 minutes.
- **Not polled:** `FAILED` (36 barcoded), `DELIVERED` (11), `LABEL_PENDING` / `MANIFEST_PENDING` (none currently).
- Concurrency: drain pool + in-process session lock + DB booking lock for login.
- Duplicate jobs: skipped while QUEUED/RUNNING/RETRYING; **not skipped after SUCCEEDED**, so an org can get a new job every cron tick. The 15-minute cutoff only applies inside the job query — empty jobs still succeed.
- Continuation: after 4×500 pages, another `tracking-sync` job is queued.

**Root cause of “jobs succeed but tracking looks empty”:** succeeded jobs are stamping `last_tracked_at` when **no matching bulk article** is returned (empty `data` or 400-skip), without writing `last_event_*` or events.

---

## 5. Authentication issues

| Fact | Value |
|---|---|
| PRODUCTION CONNECTED | 14 |
| Token expired at snapshot | 1 |
| Orgs with tracking-sync success 24h | 14 |
| Orgs with tracking-sync **auth fail** 24h | **2** |
| Failed jobs 24h | 247 (246 “India Post authentication failed.”, 1 “fetch failed”) |
| Login 401 | `PERMANENT_AUTH_ERROR` (no retry), then **immediate re-enqueue** next cron |

`token()` / `ensureSession()` reuse access token if `expires_at - now > 60s`. Otherwise **password login**, not refresh-token grant. `persistIndiaPostTokens` encrypts access/refresh/id.

Health `indiaPost: Warning` is **not** a CEPT probe: it is Warning whenever a base URL env is set (`lib/api/health.ts`). `jobs: Warning` matches **14 overdue** jobs (`count_overdue_background_jobs`).

---

## 6. Event mapping accuracy

Live historical `tracking_events` (272 rows, **all `classification` NULL**, **0 in last 24h**):

| Stored event | n | Intended class (current mapper) |
|---|---|---|
| Item Dispatched | 76 | DISPATCHED → shipment IN_TRANSIT |
| Item bagged | 51 | DISPATCHED (movement) |
| Bag Received | 40 | IN_TRANSIT |
| Item Received | 33 | IN_TRANSIT |
| Item Booked | 22 | unclassified |
| Bag Received for Forwarding | 22 | IN_TRANSIT (`bag_received`) |
| Item received at Destination | 9 | IN_TRANSIT |
| **Item Delivered(Addressee)** | **8** | **DELIVERED** (P0) |
| Taken out for delivery | 8 | OUT_FOR_DELIVERY |
| Item Kept on Hold | 1 | not NDR |
| Item Redirected | 1 | unclassified (not RTO) |
| Item Invoiced to BO | 1 | unclassified |

If these rows were re-projected with `865d295` mapper, Delivered(Addressee) would **not** be NDR. They have **never been classified in DB** because ingest writes `classification` on insert, these rows predate that path, and **reconciliation apply was never authorized**.

`rts === true` → RTO (not RTO_DELIVERED). Return completion still requires documented phrases (`delivered_to_sender`, etc.). Live CEPT return-completion names: **UNVERIFIED**.

---

## 7. Database persistence

Read-only aggregates (no row mutation):

| Metric | Count |
|---|---|
| Barcoded shipments | 192 |
| `operational_status` NULL | **192** |
| `last_tracked_at` last 2h | 85 |
| `last_event_at` / `last_event_code` set | **0** |
| `tracking_events` | 272 |
| Events last 24h | **0** |
| Classified events | **0** |
| Shipments with events but still NULL ops | 22 |
| Never `last_tracked_at` | 107 |

**Conclusion:** polling heartbeat (`last_tracked_at`) works. **CEPT history is not landing on `shipments` scan fields.** Duplicate unique index would still allow `planTrackingUpdate` if ingest ran; ingest is not running against live payloads.

Tenant isolation: worker filters `organization_id`; NDR summary uses the same; RLS enabled on `shipments` / `tracking_events`. No RLS weakening in this release.

---

## 8. Dashboard accuracy

Dashboard **matches the database**:

- NDR/RTO bucket counts use stored `operational_status` only → all zeros except **unclassified tracked ≈ barcoded poll-eligible with NULL ops** (145 in poll statuses; 192 all barcoded NULL).
- Shipment “Last synced” can show `last_tracked_at` while timeline/`last_event_*` stay empty — **this is consistent with the worker’s empty-article path**, not a UI bug.
- 11 shipments already `status = DELIVERED` without `operational_status` (legacy coarse status, not the new projection).

---

## 9. Failed tracking jobs

- Lifetime: 2031 SUCCEEDED, 259 FAILED (`tracking-sync`).
- Last 24h: 1910 succeeded, 247 failed.
- Dominant error: **India Post authentication failed** (2 organizations, 246 jobs) — FAILED jobs are retried by **re-creating jobs**, not by `RETRYING` backoff.
- 14 overdue jobs → health `jobs: Warning`.

---

## 10. Performance risks

- Enqueue-every-drain × ~14 orgs ≈ **~14 tracking-sync rows per minute** even when no AWB is due (explains 1,580 successes / 2h).
- Bulk 400 skip can mark up to 500 AWBs as “tracked” (`last_tracked_at`) and delay real scans by 15 minutes × retries.
- Login stampede mitigated by process + DB lock; still one login per expired token per job.
- `maxDuration = 300` on cron vs 4 pages × 30s track timeout — theoretically tight if CEPT is slow; not observed as the current empty-payload path.

---

## 11. Required fixes (do not implement in this audit)

Priority order, root-cause based:

1. **Stop treating empty/400 bulk responses as a successful track.** Do not advance `last_tracked_at` unless a parsed article was applied or CEPT returned a definite empty-success for that AWB.
2. **Do not skip an entire 500-AWB chunk on HTTP 400.** Isolate unknown barcodes (smaller batches or per-AWB fallback) so one ineligible AWB cannot hide the rest.
3. **Stop re-enqueuing tracking-sync for orgs with recent permanent auth failure** (cooldown). Fix the 2 failing PRODUCTION credentials separately.
4. **Enqueue only when due shipments exist** (honor 15-minute cutoff at enqueue time).
5. **Optional:** use refresh token before password login.
6. **Separate authorized operation:** dry-run then apply historical `projectShipmentFromEvents` for the 272 existing events (8 Delivered(Addressee) included). Not this audit.
7. Health: `indiaPost: Warning` is a false signal; do not use it as CEPT status.

---

## 12. Test results (isolated worktree, mocked CEPT)

Command: Vitest tracking-sync, tracking-response, provider.session, apply-tracking, event-mapper, tracking-effects, webhook-allowlist, ndr-rto service/reconcile/db, ndr-rto API.

**11 files, 78 passed, 0 failed.**

Covered: 500 cap, 400→empty scans, timeout AbortError, missing timestamps skipped, Delivered(Addressee), NDR reason, hold/intimation, redirected, rts true/false/missing, duplicate 23505, tenant sync rejection, Shopify OFD isolation, WhatsApp existing templates only, dry-run reconcile / apply throws.

No live CEPT, Shopify, or WhatsApp.

---

## 13. Production readiness summary

| Area | Status |
|---|---|
| Documented endpoint + Bearer + 500 cap | Ready |
| Cron + database job runner | Running |
| Live Bulk Tracking **event ingest** | **Not ready** |
| `operational_status` / NDR-RTO dashboard | Empty by design until ingest or approved reconcile |
| Auth for 2 tenants | Broken, noisy |
| Webhooks | Intentionally off |

**FINAL DECISION: NO-GO** for declaring Bulk Tracking fully operational.

**Next allowed step (needs explicit approval):** implement the ingest/`last_tracked_at`/400-chunk/auth-cooldown fixes on an isolated branch, re-test with mocks, then a **single-org canary poll** — not a fleet re-sync and not webhook enablement.
