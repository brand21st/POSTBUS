# POSTBUS TRACKING RELIABILITY — PHASE 1 RCA

Investigation date: 17 Oct 2026  
Window (UTC): **2026-10-16 14:53:26** → **2026-10-17 14:53:26** (`now() - interval '24 hours'` at query time).  
Method: current source + **read-only** SQL on production project `hgacoeoovjxkzfbesmvl`.  
No code changes, no job retries, no India Post calls, no secret/PII dumps.

Previous report (`docs/audits/POSTBUS_TRACKING_SYSTEM_AUDIT.md`) is a starting point only. Counts below **revalidate** it.

---

## 1. EXECUTIVE SUMMARY

The prior “~5% tracking-sync failure” finding is **still valid in magnitude** (1,424 FAILED / 28,702 created ≈ **4.96%**). The **cause is not platform-wide lock contention**.

**CONFIRMED:** **98.8% of FAILED jobs (1,405 / 1,424)** are a **single organization** whose India Post **login** returns **HTTP 400** with an authentication-failure phrase. Those jobs never reach bulk tracking. HTTP 4xx is classified **non-retryable**, but the scheduler treats `FAILED` as idle and **enqueues a new job every cycle** — a **new-job storm**, not in-record retries.

Remaining **19 FAILED** jobs (`PROVIDER_ERROR`, 12 orgs) are **UNVERIFIED** in detail (messages do not match lock/timeout/lookup patterns).

Background tracking **does** take the **booking advisory lock**, but **only around token persist**, with a **200 ms** wait. That path did **not** appear in 24h `last_error_code` values. Session-lock contention is a **potential** booking-vs-tracking risk, **not** the observed failure mass.

Unnecessary jobs: **LIKELY majority**. 53 orgs have `auto_tracking_sync`; only **27** produced jobs (connection filter). Only **15** orgs currently have pollable AWBs. All **27,271 SUCCEEDED** rows have **empty `progress`**, so batch sizes are **not stored**. Median success duration **0.31 s** (p95 **1.54 s**) vs 30 s CEPT track timeout — consistent with **no bulk HTTP** on most runs. Exact no-work % is **UNVERIFIED**.

Previous PARTIALLY READY stance still holds. Tracking freshness for 509 pollable AWBs remains good (`last_tracked_at` within 15 minutes for all).

---

## 2. CURRENT BASELINE

Job store: `public.background_jobs`  
`job_type = 'tracking-sync'`  
Statuses observed in window: `SUCCEEDED`, `FAILED`, `QUEUED`  
Columns used: `created_at`, `started_at`, `completed_at`, `attempt_count`, `max_attempts`, `last_error_code`, `last_error` (pattern-classified only), `progress`, `organization_id`.  
Worker id: **not stored**. Attempts: `shipment_job_attempts`.

| Metric | Value | Denominator |
| --- | --- | --- |
| Unique job rows created | **28,702** | rows with `created_at` in window |
| SUCCEEDED | **27,271** | 95.01% of created |
| FAILED | **1,424** | 4.96% of created |
| QUEUED (still pending) | **7** | 0.02% |
| RUNNING at snapshot | **0** | — |
| RETRYING at snapshot | **0** | — |
| Rows with `attempt_count > 1` among FAILED | **13** | 13/1,424 FAILED (0.91%); 13/28,702 created |
| `shipment_job_attempts` rows | **1,476** (1,463 jobs) | attempts, not unique jobs |
| Attempt rows marked retryable | **43** | of 1,476 |
| Auto-sync orgs | **53** | `automation_settings` |
| Orgs that had any tracking-sync job | **27** | created in window |
| Orgs with ≥1 FAILED | **12** | |
| Orgs with pollable barcoded shipments **now** | **15** | eligibility query analogue |
| Pollable AWB freshness | **509 / 509** within 15 min | current snapshot |
| Median SUCCEEDED duration | **0.31 s** | `completed_at - started_at` |
| P95 SUCCEEDED duration | **1.54 s** | same |
| Mean SUCCEEDED duration | **0.49 s** | same |
| FAILED duration | started avg **0.75 s**; `completed_at` null | fail path does not set `completed_at` |
| SUCCEEDED `progress = {}` | **27,271 / 27,271** | **no-work rate UNVERIFIED** |

**Vs previous audit:** SUCCEEDED 27,291 vs 27,271; FAILED 1,425 vs 1,424 — same phenomenon, new 24h window.

No-work job rate: **cannot be counted** from job rows (observability gap). Theoretical lower bound: 12 of 27 job-producing orgs have **zero** current pollable AWBs, yet median load is **~1,307 jobs/org/day**.

---

## 3. FAILED JOB ROOT CAUSE ANALYSIS

### Execution path (actual files)

```
POST /api/cron/jobs                    app/api/cron/jobs/route.ts
  enqueueDueTrackingSyncJobs           modules/india-post/tracking-sync.ts
  drainDueJobs / claim_background_jobs lib/jobs/drain.ts + SQL
  processJob("tracking-sync")          workers/processor.ts
  syncTracking                         workers/processor.ts ~680
  ensurePersistedIndiaPostSession      modules/india-post/session.ts
    withIndiaPostBookingLock waitMs=200
    provider.ensureSession / login     modules/india-post/provider.ts
  trackShipment                        provider.ts ~323
  ingestBulkTrackingArticle            apply-tracking.ts
  status SUCCEEDED or classify+FAILED  processor.ts ~170–228
```

Fail points: enqueue skip (not a FAILED row); `autoTrackingSync` false returns success; missing connection throws `PERMANENT_AUTH_ERROR` (not seen); login throw; lock busy/unavailable; `trackShipment` throw (5xx, success:false, schema); DB ingest throw; worker crash (stale RUNNING reclaim 15 min).

### Failure distribution (FAILED unique jobs, n=1,424)

| Error category | Jobs | % of FAILED | Orgs | First | Last | Root cause |
| --- | --- | --- | --- | --- | --- | --- |
| INDIA_POST_HTTP_400 + auth-failure phrase (login) | **1,405** | **98.7%** | **1** | 16 Oct 14:54Z | 17 Oct 14:52Z | **CONFIRMED** CEPT login HTTP 400 before bulk |
| PROVIDER_ERROR / OTHER | **19** | 1.3% | 12 | 16 Oct 18:28Z | 17 Oct 14:11Z | **UNVERIFIED** (not lock/timeout/lookup phrases) |
| SESSION_LOCK_* | **0** | 0 | 0 | — | — | Not observed in this window |
| HTTP_401/403/404/429/5xx as job code | **0** | 0 | 0 | — | — | Bulk 400 skip does **not** fail the job (see §6) |

`last_error_code` on the 1,405: **`HTTP_400`**. All 1,405 messages match `%authentication failed%` (phrase count only; raw text not copied).

Login mapping: `provider.login` (~66–88) sets `HTTP_${status}` when status is not 401; 401 would be `PERMANENT_AUTH_ERROR`. So CEPT returned **400**, not 401.

`classifyProviderError`: HTTP 400 is **non-retryable**. 1,392 FAILED with `attempt_count=1`; 13 with `attempt_count=2` (still HTTP_400). New cron jobs continue because open-job skip does **not** include `FAILED`.

**Platform vs one account:** **one India Post account / one org** for 98.8% of failures (`max_fail_one_org=1,407` including 2 extra FAILED on that org). **Not** a PostBus-wide CEPT outage.

### Retry behavior (code)

| Rule | Implementation |
| --- | --- |
| Max attempts | 5 (`MAX_ATTEMPTS`, `max_attempts` column) |
| Backoff | 1m, 5m, 15m, 30m + 0–15s jitter (`delayForAttempt`) |
| 4xx | not retryable |
| 5xx / 429 / TEMPORARY_PROVIDER_FAILURE / timeouts | retryable |
| PERMANENT_AUTH_ERROR | not retryable |
| Duplicate execution | `claim_background_jobs` `FOR UPDATE SKIP LOCKED`; open statuses skip enqueue |
| Stale RUNNING | reclaim after **15 minutes** |
| Tracking-sync does not mark shipment FAILED | excluded in processor ~233 |
| Duplicate events | unique index; ingest idempotent |

Permanent login 400 **should not** retry the same row; the **scheduler** creates **new** rows. That is the amplification.

---

## 4. SESSION LOCK ANALYSIS

| Workflow | Helper | Lock | Token | Timeout |
| --- | --- | --- | --- | --- |
| Booking | `withIndiaPostBookingLock` (booking-run) | DB lease `acquire_india_post_booking_lock`, TTL **45s**, wait **40s** | connection row | booking HTTP separate |
| Background tracking session | `ensurePersistedIndiaPostSession` | **Same booking DB lock**, wait **200 ms**, then login | encrypted access token | login timeout in http.ts |
| Background `trackShipment` | after helper returns | **lock already released** | in-memory provider | track **30s** |
| Manual NDR / sync-visible | `ensurePersistedIndiaPostTrackingSession` | **process mutex only** (`withProcessSessionLock` per connection id) | same table | track 30s |
| Public live track | `ensurePersistedIndiaPostSession` | booking lock 200 ms | same | track 30s |

Invariant the booking lock actually protects: **one org-wide exclusive lease** so booking and **login persist** do not interleave. It does **not** wrap the bulk tracking HTTP.

`withProcessSessionLock` is **in-process only** (not multi-instance). Booking DB lock **is** multi-instance.

### Concurrency scenarios

| Scenario | Current | Observed 24h |
| --- | --- | --- |
| Booking + tracking login | Tracking waits 200 ms then `TEMPORARY_PROVIDER_FAILURE` (retryable) | **Not** in FAILED codes |
| Two tracking jobs one org | Open-job skip | CONFIRMED design; 7 QUEUED leftover |
| Token expires mid-bulk | 401 throws; not in 400/403/404 skip | **UNVERIFIED** occurrence |
| Manual NDR during background | Different locks; possible dual login | **UNVERIFIED** harm |
| Booking refresh vs tracking old token | Possible after lock release | **UNVERIFIED** |
| Worker crash holding lock | TTL 45s | **UNVERIFIED** |
| Multi-instance tracking login | Serialized if using booking lock | CONFIRMED intent |
| Slow CEPT login | Holds booking lock up to login duration | LIKELY if login slow |

**Recommendation (not implemented): D then B.**  
Keep **credential/session persist** serialized (process lock + a **short** session lock if multi-instance login races matter). **Do not** use the **45s booking** lease for tracking. Switch `syncTracking` and public live refresh to `ensurePersistedIndiaPostTrackingSession` so booking wait/TTL cannot fail tracking after 200 ms. Accept rare dual-login on two instances rather than failing tracking whenever booking holds the org lock.

Do **not** drop all coordination: `withProcessSessionLock` must stay for in-process stampede.

---

## 5. UNNECESSARY JOB ANALYSIS

Scheduler: `enqueueDueTrackingSyncJobs` (`tracking-sync.ts` 74–97).

Eligibility for **enqueue** (org-level only):

1. `auto_tracking_sync = true` (limit `enqueueLimit * 2` then cap `enqueued`)  
2. `india_post_connections` exists and CONNECTED or has `encrypted_username`  
3. No open tracking-sync job (`QUEUED|PENDING|RUNNING|RETRYING`)

**Not** checked at enqueue: due `last_tracked_at`, pollable status, barcode present.

Worker eligibility (`syncTracking`): barcode not null; status in `TRACKING_POLL_STATUSES`; not `RTO_DELIVERED`; `trackingSyncDueFilter()` (15 min default, 2 min if never scanned); page 500 × 4.

If zero barcodes: loop breaks, job **SUCCEEDED** with no CEPT call. **CONFIRMED**.

| Work-size bucket | Count |
| --- | --- |
| Stored on job | **NOT IMPLEMENTED** (`progress` always `{}`) |

**No-work percentage:** UNVERIFIED exactly. **LIKELY high:** 27 job orgs vs 15 pollable orgs; 27k successes at 0.31s median; 509 AWBs already fresh within 15 min while jobs continue ~every minute per connected org.

Safe optimization: prefilter orgs that have ≥1 due pollable row, **keep worker re-check**. Risk: TOCTOU miss if a barcode is booked after enqueue skip — next cron (minutes) picks it up; also `enqueueOrgTrackingSyncIfIdle` after booking (~processor 422) covers new AWBs. **Do not** remove worker filter.

Starvation: enqueue cap 50; 27 connected orgs today — OK. Permanent HTTP_400 org consumes a slot every cycle — **CONFIRMED** waste; should backoff that org.

---

## 6. BULK API 400/403/404

`trackShipment` (`provider.ts` 344–350): on **chunk** HTTP 400/403/404, **`continue`** (no throw). Job can still **SUCCEEDED**. Affected AWBs get `last_tracked_at` bump without events (worker). **Not** the 1,405 FAILED jobs (those never reached bulk).

| Code | Likely meaning | Job | Freshness |
| --- | --- | --- | --- |
| 400 | Validation / auth-adjacent (login uses 400 in prod) | Login: FAIL job. Bulk: skip chunk | Chunk delayed until next due |
| 403 | Forbidden / customer-id | Skip chunk | Same |
| 404 | Unknown article(s) | Skip chunk | Same |
| 401 | Not in skip list; throws | FAIL / maybe retry | Job fail |

**CEPT questions (do not guess):** Can one invalid AWB 400 the whole `{bulk}` array? Does 403 mean token vs customer-id vs article ownership? Is 404 per-article or per-request?

Safe recovery: **do not** blindly split every failed batch until CEPT answers. Optional: if chunk size >1 and 400, split **once** as experiment behind a flag — **not in this phase**.

---

## 7. FILE-LEVEL EVIDENCE

| Finding | File | Function | Lines (approx) | Confidence |
| --- | --- | --- | --- | --- |
| Login HTTP_400 → job fail | `modules/india-post/provider.ts` | `login` | 66–88 | CONFIRMED |
| 4xx non-retryable | `lib/jobs/retry.ts` | `classifyProviderError` | 73–85 | CONFIRMED |
| FAILED not “open” → re-enqueue | `modules/india-post/tracking-sync.ts` | `organizationHasOpenTrackingSync` | 44–55 | CONFIRMED |
| Tracking uses booking lock 200ms | `modules/india-post/session.ts` | `ensurePersistedIndiaPostSession` | 71–93 | CONFIRMED |
| Tracking helper skips booking lock | same | `ensurePersistedIndiaPostTrackingSession` | 96–109 | CONFIRMED |
| Worker uses booking-lock helper | `workers/processor.ts` | `syncTracking` | 695 | CONFIRMED |
| Bulk 400 skip chunk | `provider.ts` | `trackShipment` | 344–350 | CONFIRMED |
| Empty due set succeeds | `processor.ts` | `syncTracking` | 718–718 | CONFIRMED |
| Enqueue ignores due AWBs | `tracking-sync.ts` | `enqueueDueTrackingSyncJobs` | 74–97 | CONFIRMED |
| No progress metrics | `processor.ts` | `syncTracking` | no progress update | CONFIRMED |

---

## 8. ROOT CAUSE MATRIX

| Issue | Root cause | Evidence | Severity | Confidence | Fix |
| --- | --- | --- | --- | --- | --- |
| ~1,405 fails/day | One org CEPT **login HTTP 400** + **new job every cron** | SQL 98.7% one org; auth phrase; attempt_count mostly 1 | P1 (merchant + queue noise) | CONFIRMED | Stop/cooldown enqueue on permanent auth/HTTP_400; fix merchant credentials |
| 19 PROVIDER_ERROR | Unknown | Sanitized OTHER | P2 | UNVERIFIED | Sample codes only in a later ops review |
| Job storm ~29k/day | Org-level enqueue without due rows | 15 pollable orgs vs 27 job orgs; 0.31s median | P2 | LIKELY | Enqueue iff due shipment exists |
| Booking lock on tracking login | Shared helper + 200ms wait | session.ts | P2 potential | CONFIRMED code; **not** 24h FAIL mass | Use tracking session helper |
| Bulk 400 skips 500 | `continue` on chunk | provider.ts | P2 potential | CONFIRMED code; **not** 24h FAIL mass | CEPT clarify; optional split |

No **P0** platform tracking outage. Freshness for pollable AWBs is healthy.

---

## 9. MINIMAL FIX PLAN (DO NOT IMPLEMENT HERE)

**P1**  
1. After `HTTP_400` / `PERMANENT_AUTH_ERROR` on tracking-sync, **do not enqueue** that org until cooldown or connection repair.  
2. Operator: repair that merchant’s India Post credentials (out of band).

**P2**  
3. Enqueue only orgs with ≥1 due pollable shipment; keep worker filter.  
4. `syncTracking` + public live: `ensurePersistedIndiaPostTrackingSession`.  
5. Write `progress.barcodesSynced` / `pages` for observability.  
6. Index `(organization_id, last_tracked_at)` when due-query is used at enqueue (migration later).

**P3**  
7. CEPT bulk partial-error questions.  
8. Use refresh_token if CEPT documents it.

Protect: booking lock TTL/wait for **booking only**; Shopify fulfillment jobs unchanged; ingest uniqueness unchanged.

---

## 10. REGRESSION TEST PLAN

- Login 400 → job FAILED non-retryable; **next enqueue skipped** for cooldown  
- Booking holds org lock; tracking session helper still tracks  
- Two tracking-sync open → second not inserted  
- Zero due shipments → no enqueue (new) **and** worker no-op success if job exists  
- Bulk 400 on chunk does not fail job; last_tracked_at updated  
- Duplicate event 23505  
- Status rank / older event  
- Tenant isolation on ndr-rto sync (existing tests)  
- Worker restart / stale RUNNING 15 min (claim SQL)  
- Token expiry: 401 vs 400 classification  

---

## 11. DEPLOYMENT SAFETY PLAN

Order: credential cooldown enqueue (low risk) → due-shipment enqueue (watch freshness) → session helper swap (watch dual-login) → progress fields.  
Validate: FAILED/day for that org drops; 509-style freshness holds; booking latency unchanged.  
Rollback: revert enqueue filters first if freshness slips.  
Monitor: `last_error_code` histogram, jobs/org/hour, pollable `last_tracked_at` lag, booking lock_timeout logs.

Do not deploy in this task.

---

## 12. FINAL RECOMMENDATION — Q&A

**Q1. Why ~1,425 failures?**  
Almost all are **one org’s CEPT login returning HTTP 400** (authentication-failure phrase). Repeated **new** jobs each schedule tick.

**Q2. Percentage explained?**  
**98.7% CONFIRMED** (1,405/1,424). **1.3% UNVERIFIED** (`PROVIDER_ERROR`).

**Q3. Is booking session lock causing these failures?**  
**No** for this window (`TEMPORARY_PROVIDER_FAILURE` / lock phrases: 0 FAILED).

**Q4. Should background tracking use the tracking session helper?**  
**Yes** for login/API (avoid 200 ms booking-lock fail during booking). Keep in-process session mutex. Optional short multi-instance login lock later — not the 45s booking lease.

**Q5. Why jobs without due shipments?**  
Enqueue is **org auto-sync + connection + idle**, not due-AWB.

**Q6. What proportion is unnecessary?**  
**Exact: UNVERIFIED** (empty progress). **LIKELY majority** (27 vs 15 orgs; 0.31s median).

**Q7. Can unnecessary jobs be safely eliminated?**  
**Yes**, if due-query enqueue **plus** post-booking enqueue **plus** worker recheck remain.

**Q8. Can HTTP 400/403/404 skip valid AWBs?**  
**Yes, at chunk scope**, if CEPT rejects the whole body. **Not** the source of the 1,405 FAILED rows. CEPT behavior **UNVERIFIED**.

**Q9. Safest minimal correction?**  
Cooldown enqueue on permanent login errors; due-shipment enqueue; switch tracking to tracking session helper.

**Q10. Without harming booking/labels/Shopify/history?**  
**Yes if** booking keeps its own 45s lock; no ingest/status-mapper rewrite; Shopify jobs untouched.

STOP. Wait for explicit authorization before implementation.
