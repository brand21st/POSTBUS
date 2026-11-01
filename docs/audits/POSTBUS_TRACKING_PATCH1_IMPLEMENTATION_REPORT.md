# POSTBUS TRACKING PATCH 1 — IMPLEMENTATION REPORT

Date: 17 Oct 2026  
Scope: Authentication-failure tracking-sync job storm (local code only).  
Patches 2–4: **not implemented**.  
Migrations: **none**.  
Production/staging deploy: **not performed**.

---

## 1. Executive summary

Patch 1 stops the scheduler from creating a new `tracking-sync` job every cron tick after a **confirmed India Post LOGIN authentication failure**.

Login HTTP 400 with an authentication-failure phrase (and login HTTP 401) is recognized as permanent auth for **tracking only**. Booking still sees `HTTP_400` on login 400. A **connection/org-scoped hold** is derived from bounded `background_jobs` history plus existing `last_verified_at` / `last_refreshed_at` on `india_post_connections`. After a bounded cooldown, **one recovery probe** may be enqueued, subject to the existing open-job check.

Local verification: **68 related tests passed**, `tsc --noEmit` exit 0, ESLint on changed files exit 0.

---

## 2. Confirmed root cause

RCA window: 28,702 tracking-sync jobs, 1,424 FAILED, **1,405** login HTTP 400 auth failures on **one org**.

`organizationHasOpenTrackingSync` ignored `FAILED`. Cron re-enqueued immediately. This is a **new-job storm**, not in-record retries (4xx already non-retryable).

Current code matched the RCA. `login()` previously set `HTTP_400` for status 400. No change to bulk tracking skip (`400`/`404` continue; `403` throws).

---

## 3. Implementation overview

1. Tag login errors with `indiaPostOperation: "login"` (booking-compatible codes).  
2. Tight phrase allowlist for confirmed auth.  
3. Tracking worker tags confirmed login auth as `PERMANENT_AUTH_ERROR` on the FAILED job.  
4. Before enqueue, evaluate hold from last 10 FAILED `tracking-sync` rows (org-scoped).  
5. Success after failure (`last_verified_at`, `last_refreshed_at`, or later SUCCEEDED tracking-sync) clears the hold.  
6. Cooldown expiry → probe (`reason: "probe"`) if no open job.

---

## 4. Files changed

| File | Function | Reason | Before | After | Side effects |
| --- | --- | --- | --- | --- | --- |
| `modules/india-post/login-auth.ts` | **added** | Login vs bulk classification | n/a | Phrase allowlist, login error factory, job-row classifier, tracking tag | None outside tracking/login |
| `modules/india-post/tracking-auth-hold.ts` | **added** | Durable hold | n/a | Bounded job history + cooldown/probe | Extra 1–2 job reads per enqueue candidate |
| `modules/india-post/provider.ts` | `login()` | Mark login origin | Plain `Error` + `HTTP_*` / `PERMANENT_AUTH_ERROR` | `createIndiaPostLoginError` (same codes) | Booking login errors gain `indiaPostOperation` only |
| `modules/india-post/tracking-sync.ts` | `enqueueOrgTrackingSyncIfIdle`, `enqueueDueTrackingSyncJobs` | Skip held orgs | Open-job check only | Hold check; connection timestamps selected | Post-booking enqueue also respects hold |
| `workers/processor.ts` | `syncTracking` catch | Durable job code | Rethrow raw login `HTTP_400` | Tag confirmed login auth as `PERMANENT_AUTH_ERROR` | Tracking FAILED `last_error_code` changes for auth 400 only |
| `modules/india-post/login-auth.test.ts` | **added** | Tests 1–6, bulk 400 | | | |
| `modules/india-post/tracking-auth-hold.test.ts` | **added** | Hold/probe/tenant tests | | | |
| `modules/india-post/tracking-sync.test.ts` | enqueue mock | Compatible with hold queries | Incomplete job chain | `eq/in/order/limit` | |
| `modules/india-post/provider.session.test.ts` | login 400 | Booking code unchanged | | Assert `HTTP_400` + login origin | |

**Not modified:** `lib/jobs/retry.ts`, `claim_background_jobs`, booking payload, labels, Shopify, `apply-tracking`, session lock helpers, `integrations.ts` (recovery uses existing verify/persist timestamps), no SQL migrations.

---

## 5. Authentication classification logic

**Live errors (must be login-tagged):**

- HTTP **401** → confirmed auth (`PERMANENT_AUTH_ERROR` from `login()`, unchanged).  
- HTTP **400** + phrase allowlist (`authentication failed`, `invalid credential(s)`, `invalid username`, `invalid password`) → confirmed for tracking hold; **code remains `HTTP_400` until the tracking worker tags it**.  
- HTTP 400 without those phrases → **not** a hold.  
- Untagged bulk/track errors → **not** a hold.

**Durable job rows:** `HTTP_401`; `HTTP_400` + phrase; `PERMANENT_AUTH_ERROR` + phrase. Explicitly **excludes** “not connected”.

Classification is **not** inside `classifyProviderError`, so booking retry semantics stay 4xx non-retryable with `HTTP_400` on login 400.

---

## 6. Tracking auth hold design

Storage: **no new columns**.

Reads (bounded):

- `background_jobs` where `organization_id`, `job_type=tracking-sync`, `status=FAILED`, `order created_at desc`, **limit 10**.  
- If latest is confirmed auth, also latest SUCCEEDED tracking-sync **limit 1**.  
- Connection `last_verified_at` / `last_refreshed_at` already loaded for enqueue.

Uses `jobs_org_status_idx` (`organization_id`, `status`) plus filters. Not a full table scan.

Hold is **not** `auto_tracking_sync=false` and **not** `status=DISCONNECTED`.

---

## 7. Cooldown and recovery

| Strikes (consecutive auth FAILED jobs after last success marker) | Delay |
| --- | --- |
| 1 | 15 minutes |
| 2 | 1 hour |
| 3 | 4 hours |
| 4 | 12 hours |
| 5+ | 24 hours |

No random jitter (deterministic, testable, identical across instances).

**Recovery**

- Cooldown elapsed → enqueue one probe if idle.  
- Probe fails → new FAILED row → higher strike.  
- Probe succeeds → SUCCEEDED after failure → idle.  
- `persistIndiaPostTokens` / connect+login / verify updates `last_refreshed_at` or `last_verified_at` **after** the failure → idle **without waiting**.  
- Saving credentials **without** successful login does not bump those timestamps → hold remains.

**Limitation:** immediate recovery requires a durable timestamp **newer than** the last auth FAILED job. In-memory flags are not used.

---

## 8. Scheduler changes

`enqueueOrgTrackingSyncIfIdle` order:

1. Open `QUEUED|PENDING|RUNNING|RETRYING` → skip.  
2. Hold check → skip (`auth-hold`) or allow probe.  
3. Insert `tracking-sync`.

Hold-check errors skip **that org only** (`hold-check-failed`); other orgs continue.

Enqueue limit 50 unchanged. Due-shipment filter **not** added (Patch 2).

---

## 9. Worker error handling

`syncTracking` catch tags confirmed login auth, logs `errorCode`/`httpStatus` (not tokens/bodies), rethrows. `processJob` still marks FAILED, non-retryable, does **not** mark shipments FAILED for `tracking-sync`. Events/statuses untouched.

---

## 10. Booking compatibility

Shared `login()` still throws `HTTP_400` for login 400. Extra field `indiaPostOperation` is unused by booking. Booking lock, payload, barcode, labels unchanged. Booking successful login still persists tokens and thereby **can** clear a tracking hold (intended: credentials work).

---

## 11. Multi-tenant isolation

All job queries filter `organization_id`. Neighbor org SUCCEEDED does not clear another org’s hold (tested). No hardcoded org IDs.

---

## 12. Concurrency safety

Hold state is in Postgres job/connection rows (survives restart/deploy/multi-instance).

Probe uniqueness: **same check-then-insert as today**. Two cron instances may both see probe-allowed and insert two QUEUED jobs in a race. Existing open-job check shrinks the window; there is **no unique index** on tracking-sync. **Documented remaining limitation** (same class as pre-patch duplicate idle jobs). Not worse than the previous storm.

No global lock. `claim_background_jobs` unchanged.

---

## 13. Regression tests

Mapped to the requested cases:

| # | Coverage | How |
| --- | --- | --- |
| 1 | Login 400 auth → hold | `login-auth.test.ts`, `tracking-auth-hold.test.ts` |
| 2 | Login 400 validation → no hold | `login-auth.test.ts` |
| 3 | Login 401 | `login-auth.test.ts`, `provider.session.test.ts` |
| 4 | 429 no hold, retryable | `login-auth.test.ts`, `retry.test.ts` |
| 5 | 500 no hold, retryable | same |
| 6 | Timeout no hold | same |
| 7 | Org A held, B enqueued | `tracking-auth-hold.test.ts` |
| 8 | Repeated cron no jobs | same |
| 9 | Cooldown → probe | same |
| 10 | Success marker clears hold | `lastVerifiedAt` / SUCCEEDED |
| 11 | Second fail lengthens cooldown | consecutive strikes |
| 12 | Reconnect timestamps | `lastVerifiedAt` after failure |
| 13 | Failed verify (stale timestamps) | hold remains |
| 14 | Booking login code HTTP_400 | `provider.session.test.ts` |
| 15 | Concurrent probe | open-job skip only; **true dual-insert UNVERIFIED** |
| 16 | QUEUED/RUNNING skip | existing + probe+open test |
| 17 | Restart | durable rows, not a live process restart |
| 18 | Other job types ignored | booking FAILED auth text ignored |
| 19 | Other org success | evaluateTrackingAuthHold tenant test |
| 20 | Events/status | `apply-tracking.test.ts` unchanged, passed |

---

## 14. Actual test results

```
npx vitest run modules/india-post/login-auth.test.ts \
  modules/india-post/tracking-auth-hold.test.ts \
  modules/india-post/tracking-sync.test.ts \
  modules/india-post/provider.session.test.ts \
  modules/india-post/session.test.ts \
  lib/jobs/retry.test.ts \
  modules/india-post/apply-tracking.test.ts \
  modules/india-post/booking-lock.test.ts
```

**Result: 8 files, 68 tests, passed. Exit 0.**

```
npx tsc --noEmit
```

**Exit 0.**

```
npx eslint modules/india-post/login-auth.ts modules/india-post/tracking-auth-hold.ts \
  modules/india-post/tracking-sync.ts modules/india-post/provider.ts \
  modules/india-post/login-auth.test.ts modules/india-post/tracking-auth-hold.test.ts \
  workers/processor.ts
```

**Exit 0.**

Not executed: live CEPT, production cron, production SQL writes.

---

## 15. Known limitations

1. Hold depends on `background_jobs` retention of recent FAILED tracking-sync rows.  
2. Legacy `HTTP_400` without an auth phrase is not held (by design). Legacy rows **with** the production phrase **are** held.  
3. Dual-scheduler probe insert race remains (pre-existing pattern).  
4. No in-schema strike counter; strikes from last **10** FAILED tracking-sync rows.  
5. Immediate recovery needs `last_verified_at` / `last_refreshed_at` / SUCCEEDED **after** the failure.  
6. Public/manual tracking is not gated by this hold (scheduler/post-booking enqueue only).  
7. Optional jitter from the plan was omitted for determinism.

---

## 16. Staging verification requirements

- Org with mock login 400 auth: ≤1 FAILED then silence until 15 minutes.  
- Neighbor org still enqueues.  
- After mock login success (verify), enqueue resumes.  
- Booking of a healthy org still books.  
- No Shopify fulfillment code path change.

---

## 17. Production deployment risks

Low. Worst case: false hold if a non-auth login 400 uses the exact allowlist phrases. Held merchant’s auto-tracking pauses until probe/credential repair. Booking of that merchant already fails at CEPT login.

---

## 18. Rollback instructions

Revert the Patch 1 commits/files listed in §4. Scheduler returns to storming the bad-credential org. No DB rollback. No data rewrite.

---

## 19. Follow-up improvements

- Patch 2 due-shipment enqueue.  
- Optional `tracking_sync_hold_until` column if job retention is short.  
- Unique partial index to make probe insert atomic.  
- Patch 3/4 as previously planned.

---

## 20. Final implementation verdict

**COMPLETE for Patch 1 (local).** Ready for explicit staging authorization. **Not deployed.**
