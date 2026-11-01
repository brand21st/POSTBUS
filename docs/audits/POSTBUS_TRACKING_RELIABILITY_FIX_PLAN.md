# POSTBUS TRACKING RELIABILITY — PRODUCTION-SAFE FIX PLAN

Date: 17 Oct 2026  
Status: **PLANNING ONLY** — no application code, migrations, deploys, or India Post calls.  
Evidence: `docs/audits/POSTBUS_TRACKING_SYSTEM_AUDIT.md`, `docs/audits/POSTBUS_TRACKING_RELIABILITY_PHASE1_RCA.md`, current source on this branch.

---

## 1. Executive summary

Confirmed production harm is **not** a platform tracking outage. Pollable AWBs were fresh. The urgent defect is a **scheduler × permanent login failure** loop: one merchant’s CEPT login HTTP 400 produced **~1,405 FAILED `tracking-sync` jobs in 24 hours**, while other merchants continued to track.

A second confirmed inefficiency is **org-level enqueue without a due-shipment check**, which drives tens of thousands of empty SUCCEEDED jobs.

Bulk HTTP 400/404 chunk skip is a **correctness/freshness-semantics** issue in code, **not** the source of those 1,405 failures. Session-lock contention was **not** observed in that failure window and must **not** be the first patch.

**Recommended first patch:** classify confirmed login authentication failures and apply a **per-connection tracking enqueue hold** so FAILED jobs no longer spawn a new job every cron tick. Do not change booking payloads, Shopify fulfillment, barcodes, labels, or ingest uniqueness.

---

## 2. Confirmed root causes

| ID | Cause | Confidence | Priority |
| --- | --- | --- | --- |
| RC1 | `login()` maps CEPT HTTP 400 to `HTTP_400` (non-retryable). Scheduler `organizationHasOpenTrackingSync` ignores `FAILED`, so a new job is created every cycle. | CONFIRMED | **P1** |
| RC2 | `enqueueDueTrackingSyncJobs` selects auto-sync orgs with a connection and no open job; it does **not** test due pollable shipments. | CONFIRMED | **P2** |
| RC3 | `trackShipment` **continues** on chunk HTTP **400 and 404** (not 403 in current main). Worker stamps `last_tracked_at` when the article is missing from `data`. Rejected chunks look “fresh”. | CONFIRMED code; production impact UNVERIFIED | **P2** |
| RC4 | Background `syncTracking` uses `ensurePersistedIndiaPostSession` (booking DB lock, 200 ms wait). Not the 1,405-fail cause. | CONFIRMED code; NOT observed as FAIL mass | **P3** |
| RC5 | SUCCEEDED jobs write empty `progress`. | CONFIRMED | **P2** (ship with P1 or immediately after) |

**Code correction vs RCA:** current `provider.ts` skips chunks on **400 and 404 only**. **403 throws**. Plan against that implementation.

Do not treat general bulk HTTP 400 as authentication failure.

---

## 3. Exact files requiring changes

| File | Patches |
| --- | --- |
| `modules/india-post/provider.ts` | P1 login classification; P2 bulk outcomes |
| `modules/india-post/error-text.ts` (or new `login-error.ts`) | P1 auth-phrase helper |
| `lib/jobs/retry.ts` | P1 treat `PERMANENT_AUTH_ERROR` only (already permanent); no 4xx retry change |
| `modules/india-post/tracking-sync.ts` | P1 hold; P2 due existence query |
| `workers/processor.ts` | P1 record hold on login fail; P2 keep worker filter; P2/P5 progress; P2 stamp rules |
| `modules/india-post/session.ts` | P1 clear hold on successful token persist; **P3 only** for lock strategy |
| `lib/api/v1/integrations.ts` | P1 clear hold after successful connect login |
| `modules/india-post/apply-tracking.ts` | P2 last_tracked_at comments / stamp helper only if needed |
| `modules/india-post/tracking-sync.test.ts` | P1/P2 tests |
| `modules/india-post/provider.session.test.ts` | P1/P2 provider tests |
| New `modules/india-post/tracking-auth-hold.ts` | P1 hold read/write |
| New `modules/india-post/tracking-bulk-outcome.ts` | P2 structured chunk results |
| `lib/env.ts` / `.env.example` | optional flags and hold tunables |
| `modules/tracking-pages/public.ts` | P2 if `trackShipment` return shape changes (keep `data`) |
| `modules/ndr-rto/service.ts` | same |
| `modules/india-post/booking-run.ts` | same; **do not change booking HTTP** |

**Do not change:** Shopify fulfillment job creation, barcode allocation, label generation, booking request body, `planTrackingUpdate`, `tracking_events` unique index, `claim_background_jobs`.

---

## 4. Proposed changes per file

### 4.1 `provider.ts` `login()`

Today: non-401 failure → `HTTP_${status}` (so production 400 → `HTTP_400`).

Change:

- 401 → `PERMANENT_AUTH_ERROR` (unchanged).
- 400 **and** confirmed authentication-failure text → `PERMANENT_AUTH_ERROR`.
- Other login 4xx → keep `HTTP_${status}` (not an auth hold trigger unless we also add `INDIA_POST_LOGIN_REJECTED` for non-retryable login-only failures).

Do **not** apply this mapping inside `trackShipment`.

### 4.2 New `tracking-auth-hold.ts`

- `isConfirmedIndiaPostAuthFailure({ code, status, message })`
- `readTrackingSyncHold` / `writeTrackingSyncHold` / `clearTrackingSyncHold`
- Bounded next-probe time

### 4.3 `tracking-sync.ts`

- Before enqueue: skip if hold active.
- P2: `organizationHasDuePollableShipment` (`select id … limit 1`) using the **same** status list, RTO_DELIVERED exclusion, barcode not null, and `trackingSyncDueFilter()`.
- `enqueueOrgTrackingSyncIfIdle` (post-booking): **do not** require due rows (new AWB may be due via `last_tracked_at` null). **Do** skip if auth hold is active **unless** this call follows a successful login in the same booking (hold already cleared).

### 4.4 `processor.ts` `syncTracking`

- On classified confirmed auth failure: persist hold, rethrow (existing FAILED path).
- On success: clear hold; write `progress` once.
- P2: stamp `last_tracked_at` only for successful lookups (see §8).

### 4.5 `session.ts` `persistIndiaPostTokens`

- Successful persist **clears** tracking auth hold for that connection. Recovery without waiting for cooldown if CEPT accepts credentials again (booking or tracking).

### 4.6 `integrations.ts` connect/login success

- Clear hold when merchant saves credentials and login succeeds.
- Saving new username/password **before** login succeeds: set hold to “probe allowed immediately” (clear hold) so one verification job/login can run. Failed verify restores hold.

---

## 5. Database changes, if necessary

| Change | Required for | Recommendation |
| --- | --- | --- |
| None | **Patch 1 (P1)** | Use existing `india_post_connections.last_error` **only as a non-authoritative hint**. Authoritative hold: either new columns **or** a small JSON key. Prefer **two nullable columns** when a migration is authorized: `tracking_sync_hold_until timestamptz`, `tracking_sync_hold_code text`. Until then, **Patch 1a** can use recent `background_jobs` (`job_type=tracking-sync`, `status=FAILED`, `last_error_code=PERMANENT_AUTH_ERROR`, `created_at` within hold window). Jobs-table hold is **weaker** (depends on job retention) but needs **no migration**. |
| `last_tracking_attempt_at` on `shipments` | Honest freshness **and** bounded retry after rejected chunks | **Required for Fix 3 complete semantics.** One timestamp cannot mean both “due/backoff” and “last successful CEPT body”. |
| Partial index `(organization_id, last_tracked_at)` WHERE barcode IS NOT NULL | Due-existence query | **Optional** at current ~509 pollable rows; add if EXPLAIN shows seq scans after P2. |

**No destructive migrations.** Additive columns only, all nullable, default null = no hold / no attempt yet.

**Do not** flip `india_post_connections.status` away from `CONNECTED` in the tracking worker. That would couple tracking failures to **booking**.

**Do not** set `auto_tracking_sync=false` from the worker.

---

## 6. Authentication cooldown design (Fix 1)

### 6.1 What is a confirmed permanent auth failure

**Yes**

- Login HTTP **401**
- Login HTTP **400** whose **sanitized** message matches a tight allowlist, e.g. `authentication failed`, `invalid credential`, `invalid username`, `invalid password` (case-insensitive). Match **login path only**.

**No**

- Bulk tracking HTTP 400/403/404
- HTTP 429/5xx, timeouts, lock busy (`TEMPORARY_PROVIDER_FAILURE`)
- Missing connection (`PERMANENT_AUTH_ERROR` today from worker) — that can share hold, but it is “not connected”, not CEPT reject
- Generic HTTP 400 without auth phrasing (possible CEPT validation)

### 6.2 State machine (per `india_post_connections` row / org)

```
IDLE
  → (confirmed login auth fail on tracking-sync)
HOLD(next_probe_at, strike=n)
  → (cron, now < next_probe_at): skip enqueue
  → (now ≥ next_probe_at): allow exactly one tracking-sync if otherwise eligible (PROBE)
      → success login + persist: IDLE (strike=0)
      → confirmed auth fail again: HOLD with higher strike
  → (merchant credential save + successful login) OR (booking/tracking persistIndiaPostTokens): IDLE
  → (merchant credential save, login not yet ok): IDLE/PROBE (allow verify)
```

Strike → delay (capped): **15 min, 1 h, 4 h, 12 h, 24 h**. Jitter 0–60 s. **Never unlimited.**

### 6.3 Isolation

Hold is **connection/org scoped**. Other orgs unchanged. Enqueue loop `continue`s.

### 6.4 Booking

Booking keeps existing login and **45 s** booking lock. Tracking hold **must not** wrap `withIndiaPostBookingLock` for booking. If booking login succeeds, tokens persist and hold clears — merchant can book **and** tracking resumes.

If booking login also fails, existing booking error handling applies; tracking remains on hold. **Do not modify booking payload.**

### 6.5 Existing job retries

Unchanged: 4xx non-retryable, 5xx/429 retryable, max 5 attempts, jittered delays. Hold prevents **new** jobs, not in-record retries (those already stop on 4xx).

---

## 7. Scheduler optimization design (Fix 2)

Keep the job runner. Change **eligibility before insert**.

```
auto_tracking_sync
  → connection CONNECTED or encrypted_username present
  → not on tracking auth HOLD (unless probe window)
  → no open QUEUED|PENDING|RUNNING|RETRYING tracking-sync
  → EXISTS due pollable shipment
  → createBackgroundJob
```

Due shipment = worker rules:

- `barcode` not null
- `status IN TRACKING_POLL_STATUSES` (BOOKED, LABEL_READY, MANIFEST_READY, IN_TRANSIT, OUT_FOR_DELIVERY, NDR, RTO)
- `operational_status` is null or not `RTO_DELIVERED`
- `trackingSyncDueFilter()` (15 min default; 2 min if never scanned)

Query: `select id from shipments where … limit 1` **per org** after cheap filters, or one `in (orgIds)` grouped query if mock-friendly batching is easy. Avoid `select *`. Avoid scanning delivered/cancelled.

**Worker recheck stays.** TOCTOU: a shipment can leave due between enqueue and run → empty page → SUCCEEDED `noWork: true`. That is correct.

**Post-booking** `enqueueOrgTrackingSyncIfIdle` (~processor line 423) **stays**. New AWB typically has `last_tracked_at` null → due. If enqueue skipped because a job is already open, the running/queued job or next due pass picks it up. Continuation job when `maxPages` is full (~processor 754–761) **stays**.

**Starvation:** limit 50 vs ~27 connected auto-sync orgs is fine once empty orgs are skipped. Auth-hold org **must not** consume a slot. If due orgs exceed 50, iterate a **deterministic rotating** key (e.g. `organization_id > last_cursor` stored in memory is insufficient across instances). Prefer SQL `order by organization_id` plus skipping already-open jobs so remaining due orgs enqueue next cron (~1 min). Document; no new queue.

**Flags:** `INDIA_POST_TRACKING_DUE_ENQUEUE` default **true** after staging; `false` restores current org-level enqueue.

---

## 8. Tracking success/failure semantics (Fix 3)

### 8.1 Definitions

| Term | Meaning |
| --- | --- |
| Attempt | CEPT bulk HTTP completed (any status) or network error |
| Successful lookup | HTTP **200** and parsed body with `success !== false` for that chunk |
| Processed AWB | Successful lookup **and** article matched by `article_number` (existing matcher) |
| Absent AWB | Successful lookup, no article / empty history |
| Rejected AWB | Chunk HTTP 400/404 (and 403 if we later skip instead of throw) |

`last_tracked_at` today = due clock **and** implied freshness. Worker stamps it when article is missing, **including rejected chunks** because `data` omitted those AWBs.

### 8.2 Preferred schema (when migration is authorized)

- Keep `last_tracked_at` = **last successful lookup** (200, including empty history). Public “freshness” and due-for-**success** displays use this.
- Add `last_tracking_attempt_at` = last attempt (success or reject).
- **Due filter** for polling: `last_tracking_attempt_at is null OR last_tracking_attempt_at < cutoff` (with the same unscanned special case on `last_event_at`). Successful 200 still updates **both**.

Without the new column, **do not** stop stamping `last_tracked_at` on reject: that would re-enqueue the org every cron and amplify CEPT calls. **Interim (no migration):** keep backoff stamp on reject **and** record `awbsRejected` / `batchesFailed` in job progress so freshness is known to be **optimistic**. Full honesty waits for the column.

### 8.3 `trackShipment` return (backward compatible)

Keep `{ …lastJson, data }` for NDR, public track, booking-run.

Add non-enumerating metadata, e.g. `chunkOutcomes: { httpStatus, barcodeCount, accepted: boolean }[]`. Callers that ignore extra fields stay valid (`Promise<unknown>`).

**Do not** blindly split every failed 500-AWB chunk (CEPT unknown). Optional later flag: if chunk size > 1 and HTTP 400, split in half **once**. Default **off**.

**403:** continue to **throw** (current main). Job fails; retry classification applies (403 is 4xx non-retryable). Do not convert 403 to skip without CEPT confirmation.

**401 on track:** still throw (not in the 400/404 continue list).

**Partial 200:** keep `articlesForRequestedBarcodes`. Idempotent ingest and `planTrackingUpdate` (no downgrade) **unchanged**.

**Retries:** rejected AWBs become due again after the min interval via attempt/success timestamps — not a tight loop. Do not mark shipment FAILED (tracking-sync already excluded).

---

## 9. Session coordination strategy (Fix 4)

**Do not swap helpers in Patch 1–2.** RCA did not blame the booking lock for the 1,405 failures. Blindly using `ensurePersistedIndiaPostTrackingSession` accepts **multi-instance dual login** on the same credentials.

| Option | Verdict |
| --- | --- |
| A. Keep booking-lock session helper for background + public live | **Default until tests exist** |
| B. Switch tracking to process-mutex-only helper | Not until dual-login tested |
| C. One credential-scoped DB lock for all India Post HTTP | Too wide; would serialize 30s track with booking |
| D. Separate **auth persist** lock from **booking HTTP** lock | **Target architecture after tests** |
| E. Smaller: only raise tracking `waitMs` | Does not remove booking coupling |

**Safest minimal path:** keep A for production now. Persist is already **inside** the booking lock and **released before** `trackShipment`. In-process `withProcessSessionLock` stays.

**Later D:** new RPC `acquire_india_post_session_lock(connection_id)` TTL ~20s used only around `login`+`persistIndiaPostTokens`. Booking HTTP keeps `acquire_india_post_booking_lock` 45s. Tracking uses session lock, not booking lock. Requires migration + concurrency tests. **P3.**

Booking reliability: **no change** to TTL 45s / wait 40s / fail-closed RPC.

---

## 10. Observability improvements (Fix 5)

Write **once** on job completion to `background_jobs.progress` (jsonb already exists):

```json
{
  "awbsEligible": 0,
  "awbsAttempted": 0,
  "awbsProcessed": 0,
  "awbsAbsent": 0,
  "awbsRejected": 0,
  "batchesAttempted": 0,
  "batchesSucceeded": 0,
  "batchesFailed": 0,
  "authFailure": false,
  "noWork": true,
  "durationMs": 312
}
```

- No tokens, passwords, AWB lists, addresses, phones.
- `SUCCEEDED` + `noWork: true` = scheduler/worker ran, **no CEPT sync**.
- `SUCCEEDED` + `awbsProcessed>0` = real sync.
- Logs: existing `india_post.tracking.sync_ok` already has `barcodesSynced`; extend with the same counters, org id only.

Low overhead: one update beside the existing SUCCEEDED write (processor ~170). Prefer merging into that update rather than a second write.

---

## 11. Regression tests

Mocks / Vitest / PGlite only. **No live CEPT. No production jobs.**

| # | Case | Expect |
| --- | --- | --- |
| 1 | Login HTTP 400 auth phrase | `PERMANENT_AUTH_ERROR`; job FAILED; hold set |
| 2 | Scheduler during hold | No new job; other org still enqueued |
| 3 | Valid merchant | Unaffected |
| 4 | Zero due shipments | No enqueue (P2 flag on); worker noWork success if job exists |
| 5 | Post-booking new AWB | `enqueueOrgTrackingSyncIfIdle` still queues when idle |
| 6 | Open tracking-sync | Second insert skipped |
| 7 | Two claimers | `SKIP LOCKED` existing test coverage |
| 8 | Track timeout | Retryable ETIMEDOUT; no auth hold |
| 9 | Bulk 400/404 | Chunk rejected; 403 throws |
| 10 | Partial 200 | Match by article_number; others absent |
| 11 | Successful 200 | `last_tracked_at` updates |
| 12 | Rejected chunk | Not counted as processed; attempt vs success per §8 |
| 13 | Duplicate event 23505 | Idempotent |
| 14 | Older event | No status downgrade (`planTrackingUpdate`) |
| 15 | DELIVERED | Not in poll list; preserved |
| 16 | Tenant isolation | Updates eq organization_id |
| 17 | Booking lock held | Tracking wait 200 ms / TEMPORARY_PROVIDER_FAILURE (current); no booking payload change |
| 18 | Concurrent login | Process session lock serializes in-process |
| 19 | Stale RUNNING 15 min | Existing claim SQL |
| 20 | Public track | Still uses `data[]`; no PII in job progress |

Hold recovery tests: cooldown expiry probe; successful `persistIndiaPostTokens` clears hold; credential PATCH + login success clears hold; general HTTP 400 **without** auth phrase does **not** set auth hold.

---

## 12. Staging verification plan

1. Isolated staging (non-production Supabase). Flags as designed.  
2. Seed two orgs: A with mock login 400 auth; B with mock 200 bulk.  
3. Run cron enqueue in a loop: A ≤ 1 FAILED then silence until probe; B jobs only when due.  
4. Book on B: tracking-sync appears; labels/Shopify jobs unchanged.  
5. Rejected bulk 400: progress `batchesFailed`; no event deletion.  
6. Measure job counts vs control window.  

No production enqueue drain tests.

---

## 13. Production rollout plan

1. **Patch 1** (auth hold) — highest benefit, lowest booking risk.  
2. **Patch 1 observability** (progress) — may ship in the same deploy as Patch 1.  
3. **Patch 2** (due enqueue) behind `INDIA_POST_TRACKING_DUE_ENQUEUE` default true in staging, then production. Watch pollable `last_tracked_at` lag.  
4. **Patch 3** after CEPT notes + optional `last_tracking_attempt_at` migration (separate authorization).  
5. **Patch 4** session lock only after concurrency tests.

Rollout: single app deploy per patch. No Coolify env required for Patch 1a (jobs-table hold). Hold columns / attempt timestamp need a **non-destructive** migration approval.

---

## 14. Feature flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `INDIA_POST_TRACKING_AUTH_HOLD` | `true` (or always-on) | Disable only if hold logic bugs block a healthy org |
| `INDIA_POST_TRACKING_DUE_ENQUEUE` | `true` after staging | Restore old enqueue if freshness lags |
| `INDIA_POST_TRACKING_SPLIT_REJECTED_CHUNK` | `false` | CEPT experiment; keep off |

Exact-string `true` to match existing PostBus flag style. Tunables: hold delays via env with the defaults in §6.2.

---

## 15. Rollback strategy

| Patch | Rollback |
| --- | --- |
| 1 Auth hold | Revert deploy; scheduler behaves as today (storm returns for bad creds). No data rewrite. Clear hold columns if added (`UPDATE … SET tracking_sync_hold_until = null`). |
| 2 Due enqueue | Set `INDIA_POST_TRACKING_DUE_ENQUEUE` not `true` **or** revert. |
| 3 Stamp/outcome | Revert; `last_tracked_at` meaning returns. New column unused is harmless. |
| 4 Session | Revert to `ensurePersistedIndiaPostSession`. |

Do not delete `tracking_events`. Do not replay FAILED jobs in bulk on rollback.

---

## 16. Success metrics

Compare a 24h window after Patch 1 to RCA window 2026-10-16 14:53:26Z–2026-10-17 14:53:26Z:

| Metric | Target |
| --- | --- |
| FAILED tracking-sync / 24h for the previously storming org | Collapse to **≤ strikes per cooldown** (not ~1,400) |
| Other orgs’ success/fail mix | No regression |
| Pollable `last_tracked_at` within 15–120 min | Hold at least prior 509/509-in-15m quality (allow brief lag after due-enqueue) |
| SUCCEEDED `noWork` rate | Measurable; should drop after Patch 2 |
| Booking error rate / lock timeouts | No increase |
| Shopify fulfillment job types | Unchanged volume pattern |

---

## 17. Remaining provider questions (CEPT)

Do not invent answers. Do not live-probe production.

1. Can one invalid AWB cause HTTP 400 for the entire `{ bulk: [...] }`?  
2. Is bulk 400 ever used for **token** errors vs article validation?  
3. Exact meaning of tracking **403** vs **401** vs **404**?  
4. Does empty `data` on 200 mean “unknown article” or “not yet in network”?  
5. Is `refresh_token` valid for tracking sessions? (Stored, unused.)

Until (1) is answered, **do not** default-on binary-split of failed chunks.

---

## Prioritized patch sequence

### Patch 1 — P1 Auth-failure job storm (**implement first**)

| | |
| --- | --- |
| **Files** | `provider.ts` (login code only), new `tracking-auth-hold.ts`, `tracking-sync.ts`, `processor.ts` (catch/hold + progress optional), `session.ts` (clear on persist), `integrations.ts` (clear on connect), tests |
| **Behavior** | Confirmed login auth → FAILED once → no new tracking-sync until probe/recovery. Other orgs unchanged. Temporary failures still retry. |
| **Side effects** | Storming merchant’s AWBs pause until credentials work or cooldown probe. Booking unchanged unless that merchant’s CEPT login already fails. |
| **Migration** | **None** for 1a (job-history hold). Optional 1b columns when authorized. |
| **Tests** | §11 items 1–3, 8, hold recovery, non-auth HTTP 400 |
| **Deploy risk** | Low. False-positive hold if phrase list is too wide — keep allowlist tight. |
| **Rollback** | Revert deploy |

### Patch 2 — P2 Due-shipment enqueue + progress

| | |
| --- | --- |
| **Files** | `tracking-sync.ts`, `processor.ts` progress, `lib/env.ts`, tests |
| **Behavior** | Enqueue iff due pollable AWB; worker filter remains; post-booking enqueue remains |
| **Side effects** | Possible extra minutes of lag if existence query wrong; flag off restores volume |
| **Migration** | Optional index later |
| **Tests** | §11 items 4–6, 20 |
| **Deploy risk** | Medium (freshness). Staging first. |
| **Rollback** | Flag or revert |

### Patch 3 — P2 Bulk success accuracy

| | |
| --- | --- |
| **Files** | `provider.ts` `trackShipment`, worker stamp path, tests; optional shipment column |
| **Behavior** | Distinguish rejected vs absent vs processed; do not call reject “synced” in progress |
| **Side effects** | Callers must tolerate extra return fields; 403 still throws |
| **Migration** | `last_tracking_attempt_at` **if** honest due-clock is required |
| **Tests** | §11 items 9–15 |
| **Deploy risk** | Medium if due-clock changes; low if progress-only interim |
| **Rollback** | Revert |

### Patch 4 — P3 Session coordination

| | |
| --- | --- |
| **Files** | `session.ts`, `booking-lock.ts`, optional RPC migration, `processor.ts` helper choice |
| **Behavior** | Auth persist serialized without 45s booking lease wrapping tracking login |
| **Side effects** | Dual-login if lock too weak; booking delay if lock too wide |
| **Migration** | Only if new session RPC |
| **Tests** | §11 items 17–18, multi-instance mock |
| **Deploy risk** | Higher than P1/P2 — **after** those succeed |
| **Rollback** | Revert to current helper |

---

## Success criteria mapping

| Criterion | Patch |
| --- | --- |
| Permanent auth does not generate continuous new jobs | 1 |
| Jobs created only when necessary | 2 |
| Failed batches not counted as synchronized | 3 |
| Valid tracking remains reliable | 1–3 must not touch ingest uniqueness / status rank |
| Other merchants unaffected | Org-scoped hold + queries |
| Booking stable | No booking lock/payload changes in 1–3 |
| Shopify unchanged | No fulfillment code in any patch |
| Event history intact | No deletes |
| Status updates idempotent | Unchanged mapper |
| Workers scalable | Less enqueue + hold |
| Activity measurable | Progress JSON |

---

**STOP.** No implementation until explicit authorization. Recommended first patch remains **Patch 1 (authentication hold)**.
