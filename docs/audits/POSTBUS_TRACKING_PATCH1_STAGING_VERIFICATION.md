# POSTBUS TRACKING PATCH 1 — STAGING VERIFICATION & RELEASE GATE

Date: 17 Oct 2026  
Patches 2–4: **not implemented**.  
Production project `hgacoeoovjxkzfbesmvl`: **no writes, no cron, no CEPT, no Shopify**.  
Hosted staging: **not authorized in this session** → **HOSTED STAGING VERIFICATION PENDING AUTHORIZATION**.

---

## 1. Executive summary

Patch 1 hold/recovery was revalidated against current source. Local tests **79/79 passed**.

A **confirmed P1** remained: after cooldown, a recovery probe can **SUCCEEDED without login** (no-work / cached session). Because SUCCEEDED is not treated as auth recovery, the next cron still saw `reason: probe` and could enqueue **every cycle** — an empty recovery-probe storm, not the original HTTP_400 fail storm.

**Minimal no-migration fix applied:** after the latest confirmed auth failure, the newest later `tracking-sync` row (`created_at > failure`) throttles the next probe by the same bounded delay (15m→24h). Verified login (`last_verified_at` / `last_refreshed_at`) still clears immediately.

**Final verdict: READY FOR HOSTED STAGING**  
Not **HOSTED STAGING VERIFIED**. Not **PRODUCTION READY**. Gate 11 (hosted staging) is **unsatisfied**.

---

## 2. Environment identity

| Item | Value |
| --- | --- |
| Local tests | Vitest + PGlite + mocks |
| India Post | Mock `fetch` / no network CEPT |
| Shopify | Not invoked |
| Hosted staging project | **Not selected / not authorized** |
| Production `hgacoeoovjxkzfbesmvl` | Identified as forbidden; **untouched** |
| Local app `.env.local` | Points at the **production** Supabase host — therefore **must not** be used for staging writes. This task did not run production SQL. |

---

## 3. Authentication hold results

| Case | Result |
| --- | --- |
| Login HTTP 401 | Hold-classifiable; `PERMANENT_AUTH_ERROR` | **PASSED** |
| Login HTTP 400 + auth phrase | Tracking tags `PERMANENT_AUTH_ERROR`; booking stays `HTTP_400` | **PASSED** |
| Login HTTP 400 validation | No hold | **PASSED** |
| Bulk tracking HTTP 400 | Not login-tagged | **PASSED** |
| 429 / 500 / timeout | Retryable; no hold | **PASSED** |
| Org-scoped | Neighbor still enqueued | **PASSED** |
| Shipments not marked FAILED | `tracking-sync` excluded in processor | **CONFIRMED** |
| Cached token reuse does not set `last_refreshed_at` | `ensureSession` `tokens: null` | **CONFIRMED** |
| Durable after restart | Job + connection timestamps | **CONFIRMED** |
| Newer HTTP_500 no longer clears auth hold | Scan for newest **auth** fail in last 10 FAILED rows | **PASSED** (fix in this session) |

---

## 4. Recovery probe results

Lifecycle (current code):

`enqueueDueTrackingSyncJobs` → open-job check → `evaluateTrackingAuthHold` (FAILED history limit 10 + optional latest job after failure) → insert probe → cancel duplicate QUEUED/PENDING → `syncTracking` (`ensurePersistedIndiaPostSession` then due query).

| Scenario | Expected | Result |
| --- | --- | --- |
| A Login succeeds on probe | `persistIndiaPostTokens` → `last_refreshed_at` → idle | **PASSED** (unit) |
| B No due shipments / no-work SUCCEEDED | Hold remains; **not** every-cron probe | **PASSED** after throttle |
| C Cached session, no fresh login | Does not clear hold; throttled if a job was created | **PASSED** |
| D Login fails again | New FAILED auth row; cooldown from new failure | **PASSED** |
| E Merchant verify/connect | `last_verified_at` after failure → idle | **PASSED** |
| F Credential save without verify | Stale timestamps; hold remains | **PASSED** |

---

## 5. Empty job storm analysis

**CONFIRMED in code before this session’s throttle** (not measured in production after Patch 1, which is undeployed).

Evidence:

1. Cooldown expiry → `reason: "probe"`, `blocked: false`.  
2. Worker can SUCCEEDED without login (`autoTrackingSync` false; or cached token + zero barcodes).  
3. SUCCEEDED does not update verify/refresh timestamps.  
4. Next cron still `blocked: false` / `probe`.

**After throttle: NOT REPRODUCED locally** (two consecutive `enqueueDueTrackingSyncJobs` with a recent no-work SUCCEEDED did not call `createBackgroundJob`). Next probe only after the same strike delay.

Production occurrence: **UNVERIFIED** (Patch 1 not deployed).

---

## 6. Concurrent scheduler results

Isolated PGlite (not production cron):

| Test | Created | After cancel |
| --- | --- | --- |
| 2 concurrent inserts | 2 QUEUED | 1 QUEUED (prior test) |
| 5 concurrent inserts | 5 QUEUED | **1 QUEUED, 4 CANCELLED** |

Claimed/completed RUNNING jobs: **not simulated** in PGlite cancel tests. Cancel filter is QUEUED/PENDING only — RUNNING continuation **CONFIRMED** excluded in code.

Remaining race: two workers may **claim** duplicates before cancel (**UNVERIFIED** production). Not unbounded by cron rate after throttle. Atomic uniqueness still needs a **partial unique index** (not implemented).

---

## 7. Hold durability

| Topic | Finding |
| --- | --- |
| Restart | No in-memory hold map | **CONFIRMED** |
| Application job delete | `cleanup` queue type exists; processor is a **reserved stub** (no delete) | **CONFIRMED** no app purge |
| SQL/migrations purge | None found for `background_jobs` | **CONFIRMED** in repo |
| External/ops cleanup | **UNVERIFIED** |
| Missing history | Idle (hold disappears) | **PASSED** / documented P2 |
| >10 auth fails | Strike from newest 10; 24h cap | **PASSED** |

---

## 8. Booking regression

| Check | Evidence |
| --- | --- |
| Login 400 remains `HTTP_400` | `provider.session.test.ts` **PASSED** |
| Booking lock | `booking-lock.test.ts` **PASSED**; lock helper unused by hold |
| Retry 4xx/429/5xx | `retry.test.ts` **PASSED** |
| Payload / barcode / labels / Shopify | No source changes in those modules this session | **CONFIRMED** diff scope |

Tracking hold does not set `india_post_connections.status` to DISCONNECTED.

---

## 9. Multi-tenant isolation

| Check | Result |
| --- | --- |
| Org A hold / Org B enqueue | **PASSED** |
| Org B SUCCEEDED does not clear Org A | **PASSED** |
| Cancel 5 duplicates on A leaves B QUEUED | **PASSED** PGlite |
| Public routes / authz | Not re-tested this session | **UNVERIFIED** (no Patch 1 change to public track) |
| Logs | Org id, codes, cooldown; no tokens | **CONFIRMED** |

No confirmed cross-tenant exposure. Not a P0 from this review.

---

## 10. Performance

**No synthetic 100/500/1000-org load run** (would be invented if numbered). Qualitative:

- Per candidate org: open-job limit 1; FAILED limit 10; if auth fail, one more `gt created_at` limit 1; optional cancel select limit 10.  
- Index: `jobs_org_status_idx (organization_id, status)`.  
- Extra query **only** when a confirmed auth FAILED row exists.  
- No long transactions; cancel is per-row UPDATE.  
- Enqueue still loops orgs (pre-existing N+1). Patch 2 not in scope.

---

## 11. Code changes (this verification)

| File | Change |
| --- | --- |
| `modules/india-post/tracking-auth-hold.ts` | Newest **auth** fail (ignore later 500); `lastProbeAt` throttle; `probe-throttle` reason |
| `modules/india-post/tracking-auth-hold.test.ts` | No-work storm, 500-after-auth, verify supersedes throttle |
| `modules/india-post/tracking-auth-hold.pg.test.ts` | 5-way duplicate collapse |
| `modules/india-post/tracking-sync.test.ts` | Mock `.gt` |

No migrations.

---

## 12. Test execution

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

**9 files, 79 tests, passed. Exit 0.**

`npx tsc --noEmit` → **0**  
ESLint on hold/sync/processor/test files → **0**

---

## 13. Failed tests

**None** in the run above.

---

## 14. Unverified items

- Hosted staging Tests A–I  
- Live CEPT login/bulk behavior  
- Production claim-vs-cancel race  
- Operator SQL job deletes  
- 100–1000 org scheduler latency  
- Public tracking authorization (unchanged)

---

## 15. Remaining risks

| Sev | Risk |
| --- | --- |
| P1 mitigated | Empty probe storm — throttled locally; confirm on staging |
| P2 | Duplicate RUNNING before CANCELLED |
| P2 | Hold depends on FAILED row retention |
| P2 | Extra DB reads for held orgs |
| P2 | After throttle window, one probe per delay even with no due AWBs (bounded, not Patch 2) |

No P0 found.

---

## 16. Rollback plan

Revert Patch 1 files (`login-auth.ts`, `tracking-auth-hold.ts`, `tracking-sync.ts`, `provider.ts` login tag, `processor.ts` catch, tests). No DB rollback. CANCELLED duplicates remain harmless. Original fail-storm returns for bad-credential orgs.

---

## 17. Production release checklist

1. Isolated staging project **≠** `hgacoeoovjxkzfbesmvl`.  
2. Staging env must not use production CEPT or Shopify writes.  
3. Deploy Patch 1 to staging only after explicit authorization.  
4. Run hosted Tests A–G (auth fail, cooldown via injected clock, no-work throttle, verify recovery, overlapping cron, mocked booking, three orgs).  
5. Confirm FAILED/hour for the bad-credential org collapses; neighbors stay fresh.  
6. Confirm booking error rate unchanged.  
7. Confirm `DUPLICATE_TRACKING_SYNC` cancellations stay small.  
8. Rollback plan reviewed.  
9. **Then** separately authorize production.

---

## 18. Final verdict

**READY FOR HOSTED STAGING**

Not `HOSTED STAGING VERIFIED — READY FOR RELEASE REVIEW` (Gate 11 open).  
Not `BLOCKED — CORRECTIONS REQUIRED` for local Patch 1.  
Not production-ready from mocks alone.

---

## Release gates

| Gate | Status |
| --- | --- |
| 1 Classification | **PASS** local |
| 2 Cooldown | **PASS** local |
| 3 No-work does not clear hold | **PASS** local |
| 4 No uncontrolled probe storm | **PASS** local after throttle |
| 5 Concurrent residual accepted | **PASS** with documented race |
| 6 Other orgs | **PASS** local |
| 7 Booking regression | **PASS** local |
| 8 No credential logs | **PASS** review |
| 9 Durability | **PASS** local; ops purge UNVERIFIED |
| 10 No migration | **PASS** |
| 11 Hosted staging | **FAIL / PENDING AUTHORIZATION** |
| 12 Rollback documented | **PASS** |

**Production deployment is not recommended** until Gate 11 completes.

---

## Post-release monitoring (do not deploy now)

Compare to RCA 24h baseline (28,702 jobs / 1,424 FAILED / 1,405 login auth):

- `tracking-sync` created/hour/org  
- `last_error_code` histogram (`PERMANENT_AUTH_ERROR`, `HTTP_400`)  
- `probe-throttle` / `auth-hold` log counts  
- `DUPLICATE_TRACKING_SYNC` cancels  
- Pollable `last_tracked_at` lag  
- Booking job fail rate  

Do not claim production targets until those metrics exist post-deploy.
