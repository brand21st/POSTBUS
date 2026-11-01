# POSTBUS TRACKING PATCH 1 — FINAL SAFETY VERIFICATION

Date: 17 Oct 2026  
Scope: Authentication hold / recovery / concurrency after Patch 1.  
Patches 2–4: **not started**.  
Production/staging deploy: **not performed**.  
Live CEPT / production SQL writes: **not performed**.

Classification key: **CONFIRMED** (code/SQL evidence), **PASSED** (local test), **FAILED**, **UNVERIFIED**, **BLOCKED**.

---

## 1. Executive summary

Patch 1’s original recovery rule treated a later **SUCCEEDED** `tracking-sync` job as proof of authentication. That is **unsafe**. `syncTracking` can succeed with **no India Post login** (`autoTrackingSync` false) and can succeed after a **cached session** plus **zero due shipments**.

A **minimal Patch 1 correctness fix** was applied:

- Hold recovery now uses only **`last_verified_at`** and **`last_refreshed_at`** (set after successful `login()` persist or merchant verify/connect).
- SUCCEEDED / no-work jobs **do not** clear a hold.
- Check-then-insert races can still insert two QUEUED rows (**CONFIRMED** in PGlite). After insert, **newer QUEUED/PENDING duplicates are CANCELLED**. RUNNING continuation jobs are not cancelled. This is **not** an atomic unique constraint.

**Verdict: READY FOR STAGING** — not production-ready from local tests alone.

---

## 2. Authentication recovery findings

| Marker | Reliable login success? | Result |
| --- | --- | --- |
| `last_verified_at` | Yes — integrations connect/verify after `login()` | **PASSED** (code + unit test) |
| `last_refreshed_at` | Yes — `persistIndiaPostTokens` only when `ensureSession` returns **new** `tokens` (login path). Cached reuse returns `tokens: null` | **CONFIRMED** `provider.ensureSession` + `session.persistIndiaPostTokens` |
| Later SUCCEEDED tracking-sync | **No** | **FAILED** before fix; **PASSED** after fix |

`ensureSession` reuses a token when `expires_at - now > 60s` and does not persist. Booking/tracking login that actually obtains tokens still updates `last_refreshed_at`, which is the intended early recovery.

Submitting credentials without a successful login does not bump those timestamps — hold remains (**PASSED**).

---

## 3. No-work job safety

| Path | Authenticates? | Job status | Hold after fix |
| --- | --- | --- | --- |
| `autoTrackingSync` false early return | No | SUCCEEDED | Remains (unless cooldown probe window) |
| Zero due AWBs **after** `ensurePersistedIndiaPostSession` | Login if token stale; else cache | SUCCEEDED | Cache reuse does **not** refresh timestamps → hold remains |
| Bulk 400/404 continue | Not login | SUCCEEDED possible | Not an auth-success marker |
| Login HTTP 400 auth phrase | Yes, failed | FAILED + `PERMANENT_AUTH_ERROR` tag | Hold |

**PASSED** unit: no-work / stale verify timestamps do not clear hold; `last_refreshed_at` after failure does.

---

## 4. Concurrent scheduler findings

| Observation | Result |
| --- | --- |
| `createBackgroundJob` is insert-only; no tracking-sync unique index | **CONFIRMED** |
| PGlite: two concurrent inserts → 2 QUEUED rows | **PASSED** |
| Open-job check-then-insert race | **CONFIRMED** |
| `cancelNewerDuplicateQueuedTrackingSync` keeps oldest QUEUED/PENDING; cancels extras; does not touch RUNNING | **PASSED** (mock race + PGlite) |
| Org B QUEUED preserved while org A duplicates collapse | **PASSED** |
| True serializable uniqueness without a migration | **not available** — remaining risk: two workers may both **start** before cancel; extra job can still run once | **UNVERIFIED** in multi-instance production |

**Risk quantification:** at most about **N application instances** probes per cooldown expiry per org (typically 2), not ~1,400 FAILED jobs/day. Duplicate RUNNING work is brief. Atomic uniqueness would need a **partial unique index** (separate approval / migration).

**Not BLOCKED** for staging: residual race is bounded; cancel is the smallest no-migration mitigation. **Do not** reuse the 45s booking lock for enqueue.

---

## 5. Hold durability findings

| Scenario | Result |
| --- | --- |
| Worker / app restart | Hold is job + connection timestamps in Postgres | **CONFIRMED** (no in-memory map) |
| Multiple instances | Same durable rows | **CONFIRMED** |
| Job cleanup / purge | **No application cleanup** of `background_jobs` found | **UNVERIFIED** if ops/manual SQL deletes FAILED rows — that **would** drop the hold |
| Missing FAILED history | Hold idle | **PASSED** (by design; limitation) |
| >10 consecutive auth failures | Last 10 rows; strike capped; 24h delay at ≥5 | **PASSED** |
| Successful verify/persist after failure | Hold clears | **PASSED** |
| Failed credential verification | Timestamps stale; hold remains | **PASSED** |
| Cooldown expired | `reason: probe`; one enqueue if idle | **PASSED** |
| Multiple organizations | Queries filter `organization_id` | **PASSED** |

---

## 6. Booking compatibility

| Check | Result |
| --- | --- |
| Login HTTP 400 still `HTTP_400` | **PASSED** `provider.session.test.ts` |
| Booking lock TTL/RPC | Unchanged; `booking-lock.test.ts` **PASSED** |
| `classifyProviderError` 4xx/429/5xx | Unchanged; `retry.test.ts` **PASSED** |
| Booking payload / barcode / labels / Shopify | No edits in this verification | **CONFIRMED** by diff scope |

---

## 7. Multi-tenant safety

| Check | Result |
| --- | --- |
| Hold per organization_id | **PASSED** |
| Org B success does not clear org A | **PASSED** |
| Connection timestamps passed from that org’s row | **CONFIRMED** `enqueueDueTrackingSyncJobs` |
| Cancel duplicates scoped by organization_id | **PASSED** PGlite |
| Logs: org id, codes, cooldown — not tokens/passwords/AWBs | **CONFIRMED** code review |
| Cross-tenant hold clear | No path found | **PASSED** locally |

---

## 8. Files changed (this verification)

| File | Change |
| --- | --- |
| `modules/india-post/tracking-auth-hold.ts` | Stop using SUCCEEDED jobs as recovery; drop extra success query |
| `modules/india-post/tracking-sync.ts` | Cancel newer duplicate QUEUED/PENDING tracking-sync rows after enqueue |
| `modules/india-post/tracking-auth-hold.test.ts` | No-work recovery + race collapse tests |
| `modules/india-post/tracking-auth-hold.pg.test.ts` | **Added** isolated PGlite uniqueness/collapse tests |
| `modules/india-post/tracking-sync.test.ts` | Job mock supports update/thenable |

No migrations. No booking/Shopify/label/polling-interval changes.

---

## 9. Actual test results

```
npx vitest run modules/india-post/login-auth.test.ts \
  modules/india-post/tracking-auth-hold.test.ts \
  modules/india-post/tracking-auth-hold.pg.test.ts \
  modules/india-post/tracking-sync.test.ts \
  modules/india-post/provider.session.test.ts \
  modules/india-post/session.test.ts \
  lib/jobs/retry.test.ts \
  modules/india-post/apply-tracking.test.ts \
  modules/india-post/booking-lock.test.ts
```

**9 files, 74 tests, passed. Exit 0.**

```
npx tsc --noEmit
```

**Exit 0.**

```
npx eslint modules/india-post/login-auth.ts modules/india-post/tracking-auth-hold.ts \
  modules/india-post/tracking-sync.ts modules/india-post/provider.ts \
  modules/india-post/login-auth.test.ts modules/india-post/tracking-auth-hold.test.ts \
  modules/india-post/tracking-auth-hold.pg.test.ts workers/processor.ts
```

**Exit 0.**

Staging cron against a hosted project: **STAGING REQUIRED** (not authorized here).

---

## 10. Remaining risks

1. Deleting FAILED tracking-sync history removes the hold until the next auth failure.  
2. Duplicate probe may still **run** if claimed before CANCELLED.  
3. After cooldown, probes enqueue until a real login persist/verify — including no-work successes that do not clear the hold (possible extra empty jobs; not the HTTP_400 storm).  
4. `last_refreshed_at` from **booking** login success also clears tracking hold (intended).  
5. Production instance count and claim timing: **UNVERIFIED**.

---

## 11. Staging requirements

- Merchant A: mock/staging CEPT login 400 auth → FAILED then silence during 15 minutes.  
- No-work SUCCEEDED must **not** resume enqueue during cooldown.  
- Verify/connect with valid staging credentials → tracking enqueue resumes.  
- Merchant B unaffected.  
- Booking of a healthy org unchanged.  
- Optional: two overlapping cron hits → at most one extra CANCELLED row.

---

## 12. Rollback strategy

Revert `tracking-auth-hold.ts`, `tracking-sync.ts`, and tests. No database rollback. Duplicate CANCELLED rows are harmless.

---

## 13. Production readiness verdict

**READY FOR STAGING**

Not **PRODUCTION READY** on local tests alone.

Follow-up (separate approval): partial unique index on open `tracking-sync` jobs if staging still shows duplicate RUNNING probes.
