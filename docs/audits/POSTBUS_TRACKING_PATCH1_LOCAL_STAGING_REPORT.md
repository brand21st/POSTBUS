# POSTBUS TRACKING PATCH 1 — LOCAL STAGING REPORT

Date: 17 Oct 2026  
Run id: `LOCAL-PATCH1-20261017`  
Scope: isolated local verification only. Hosted staging and production were not authorized.

---

## 1. Executive Summary

Patch 1 source is present: login classification, org-scoped authentication hold, bounded cooldown, no-work probe throttle, duplicate QUEUED/PENDING cancel, and tracking-processor tagging.

The proposed cluster `127.0.0.1:55432/postbus_staging` is **not listening**. `.staging/pgdata` exists with default `#port = 5432` in `postgresql.conf`. That cluster was **not started** and received **no writes**. Isolated writes used in-process **PGlite** plus a loopback CEPT stub.

End-to-end Patch 1 behavior was proven against synthetic organizations ORG_A–ORG_E. Automated suite: **12 files, 101 tests, exit 0**. Typecheck exit 0. ESLint on changed files exit 0.

**Verdict: A — LOCAL STAGING VERIFIED — READY FOR HOSTED STAGING SETUP**

This does **not** authorize hosted staging, production deploy, or live India Post/Shopify.

---

## 2. Local Environment Identity

| Item | Value |
| --- | --- |
| Isolation loader | `scripts/staging/verify-local-isolation.mjs` (`npm run staging:isolate`) |
| `.env.local` | Present on disk, **not loaded** by the isolation script |
| `.env.staging.local` | Created locally (gitignored). Loopback Supabase URL `http://127.0.0.1:54321`. Loopback CEPT `http://127.0.0.1:4099/beextcustomer` |
| Proposed Postgres | `127.0.0.1:55432` / `postbus_staging` |
| Port 55432 | **not-listening** |
| Docker | **unavailable** |
| Write target used | In-process PGlite (`memory`) |
| Next `dev:staging` | Not started (not required for this verification) |

---

## 3. Database Isolation Evidence

| Step | Result |
| --- | --- |
| 1 Port ownership | `netstat` shows no `LISTENING` on TCP 55432 |
| 2 Container/process | Docker unavailable. No Postgres process bound to 55432 |
| 3 Tunnel/proxy | No listener ⇒ no tunnel on the proposed port |
| 4–5 Identity SQL | **Not executed** (no listener). `.staging/pgdata` still comments default port 5432 — **unsafe to start** without colliding with a default cluster |
| 6 Production project | Isolation guard rejects `hgacoeoovjxkzfbesmvl`. Staging file uses `127.0.0.1:54321` |
| 7 Production credentials | Staging file uses labeled local placeholders, not production keys |
| 8 Real merchant data | PGlite schema created empty; only synthetic `LOCAL-PATCH1-20261017` rows |
| 9 App vs job runner | Same PGlite client in tests; `JOB_RUNNER=database` |
| 10 Sanitized result | See section 4 |

**Stop condition for 55432 writes: honored.**

---

## 4. Effective Environment Configuration (sanitized)

From `npm run staging:isolate` (secrets not printed):

```
loadedDotEnvLocal: false
dotEnvLocalExistsOnDisk: true
stagingGuard: ok host=127.0.0.1:54321
NEXT_PUBLIC_APP_URL: http://127.0.0.1:3001
NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
STAGING_DATABASE_URL: pglite://memory/postbus_staging
INDIA_POST_UAT_BASE_URL: http://127.0.0.1:4099/beextcustomer
INDIA_POST_PROD_BASE_URL: http://127.0.0.1:4099/beextcustomer
CEPT_STUB_URL: http://127.0.0.1:4099
JOB_RUNNER: database
SHOPIFY_MOCK_MODE: true
RAZORPAY_DISABLED: true
POSTBUS_ENV: staging
writesAuthorized: pglite-only
```

`assertStagingRuntimeEnv` now fails closed on live India Post hosts and, when `POSTBUS_ENV=staging`, requires a loopback `INDIA_POST_UAT_BASE_URL`.

---

## 5. Mock CEPT API Implementation

Provider session URLs: `{root}/v1{path}` with root `.../beextcustomer`.

Stub routes (TypeScript handler + `scripts/staging/cept-stub.mjs`):

- `POST /beextcustomer/v1/access/login`
- `POST /v1/access/login`
- `POST /access/login`
- `POST /beextcustomer/v1/tracking/bulk` (and `/v1/tracking/bulk`, `/tracking/bulk`)
- Existing `POST /book` and `GET /track` preserved

Login cases: 200 + `LOCAL_TEST_TOKEN`; HTTP 400 authentication failed; HTTP 400 validation; 401; 429; 500; timeout/hang; delayed success.

Bulk cases: success, empty, delivered, in-transit, unknown, partial, 400/401/403/404/429/500, timeout.

Provider tests stub `fetch` through `handleCeptLocalStub` so requests never egress.

---

## 6. Synthetic Test Organizations

| Org | Purpose |
| --- | --- |
| ORG_A | Invalid login / hold / probe / recovery |
| ORG_B | Valid credentials, tracking continues |
| ORG_C | No eligible shipments |
| ORG_D | Cached/valid timestamps |
| ORG_E | Concurrent scheduler / RUNNING open-job |

No Shopify store ids. Fake barcodes `TESTAWB001IN` / `TESTAWB002IN`. Run id `LOCAL-PATCH1-20261017`.

---

## 7. Background Scheduler Test Setup

Real functions exercised against PGlite:

- `enqueueDueTrackingSyncJobs`
- `enqueueOrgTrackingSyncIfIdle`
- `evaluateTrackingAuthHold`
- `cancelNewerDuplicateQueuedTrackingSync`
- `createBackgroundJob` (database runner path)
- `tagTrackingLoginAuthFailure` / `createIndiaPostLoginError`
- `IndiaPostProvider.login` against the local stub handler

`app/api/cron/jobs/route.ts` and `workers/processor.ts` were **not** started as OS processes. Worker persistence of FAILED auth jobs was simulated with the same classifier the processor uses. Full HTTP drain against PGlite remains a hosted-staging item.

---

## 8. Authentication Failure Results

ORG_A: enqueue → stub-equivalent HTTP 400 “India Post authentication failed.” → FAILED job with confirmed login classification → hold `auth-hold` → next enqueue skipped.

Tracking events for ORG_A remained (count = 1). No deletion.

---

## 9. Cooldown Results

Injected strike mapping (no wall-clock wait):

| Strikes | Cooldown |
| --- | --- |
| 1 | 15 minutes |
| 2 | 1 hour |
| 3 | 4 hours |
| 4 | 12 hours |
| 5+ | 24 hours |

Hold blocks enqueue before expiry. After 20-minute synthetic age (beyond 15m), first enqueue is a **probe**.

---

## 10. Empty Recovery-Probe Results

Jobs before: 1 FAILED.  
Probe enqueue: 1 (then SUCCEEDED, no-work).  
Jobs after 10 further scheduler cycles: **2** (no additional jobs).  
Hold remains blocked (`probe-throttle`).  
No-work SUCCEEDED does not clear hold.  
`last_verified_at` still required for recovery.

---

## 11. Credential Recovery Results

Stale `last_verified_at` (older than the failure): hold remains.  
Fresh `last_verified_at`: enqueue resumes.  
Historical FAILED rows remain.

---

## 12. Concurrent Scheduler Results

- RUNNING open-job: enqueue skipped (`open-job`); RUNNING not cancelled.
- 2 / 3 / 5 concurrent `enqueueOrgTrackingSyncIfIdle` plus cancel: **1 QUEUED remains**.
- Five-way collapse: **4 CANCELLED** (revalidated; same as prior local evidence).
- Unique constraint still absent. Claim-before-cancel race remains a residual risk if workers claim during the window.

---

## 13. Multi-Tenant Isolation Results

With ORG_A held, `enqueueDueTrackingSyncJobs` enqueued ORG_B (`QUEUED = 1`) and did not enqueue ORG_A. ORG_C did not block B. Tracking events join-checked: **0** cross-organization rows.

Service-role/PGlite access is **not** RLS proof. Anon/authenticated RLS was not executed (no isolated auth database).

---

## 14. Booking Regression Results

- Login validation HTTP 400 remains `HTTP_400`, not confirmed auth failure.
- `classifyProviderError` still non-retryable for HTTP 400.
- `booking-lock.test.ts` passed (existing in-process lock).
- Hold does not call into booking lock; booking is not gated by tracking hold in Patch 1.
- No live booking, labels, or fulfillment.

---

## 15. Job Retention Findings

- Hold history query: `FAILED` `tracking-sync` only, limit **10**.
- 12 consecutive auth failures: strike count ≤ 10.
- Unrelated `shipment-booking` FAILED does not contaminate tracking hold.
- Missing history: empty org → idle, no throw.
- **Limitation:** hold strength depends on retained FAILED tracking-sync rows. If those rows are purged inside the cooldown window, hold can weaken. Documented residual risk. No production retention change in this patch.

---

## 16. Performance Measurements

Actual PGlite timings (`enqueueDueTrackingSyncJobs`; enqueue cap 50, settings page `limit * 2 = 100`):

| Synthetic orgs | Scheduler ms | Considered | Enqueued |
| --- | --- | --- | --- |
| 100 | 83 | 100 | 50 |
| 500 | 77 | 100 | 50 |
| 1000 | 68 | 100 | 50 |

The 500/1000 runs do not scan every org because Patch 1 did not change the enqueue limit. That is Patch 2 scheduler work and was **not** implemented.

---

## 17. Actual Test Commands

```
node scripts/staging/verify-local-isolation.mjs
# exit 0

npx vitest run modules/india-post/login-auth.test.ts \
  modules/india-post/tracking-auth-hold.test.ts \
  modules/india-post/tracking-auth-hold.pg.test.ts \
  modules/india-post/tracking-sync.test.ts \
  modules/india-post/provider.session.test.ts \
  modules/india-post/session.test.ts \
  lib/jobs/retry.test.ts \
  modules/india-post/apply-tracking.test.ts \
  modules/india-post/booking-lock.test.ts \
  lib/env/staging-isolation.test.ts \
  modules/india-post/cept-local-stub.test.ts \
  modules/india-post/patch1-local-staging.pg.test.ts
# 12 files, 101 tests, exit 0

npx tsc --noEmit
# exit 0

npx eslint modules/india-post/login-auth.ts modules/india-post/tracking-auth-hold.ts \
  modules/india-post/tracking-sync.ts modules/india-post/provider.ts \
  modules/india-post/login-auth.test.ts modules/india-post/tracking-auth-hold.test.ts \
  modules/india-post/tracking-auth-hold.pg.test.ts workers/processor.ts \
  lib/env/staging-isolation.ts lib/env/staging-isolation.test.ts \
  modules/india-post/cept-local-stub.ts modules/india-post/cept-local-stub.test.ts \
  modules/india-post/patch1-local-staging.pg.test.ts scripts/staging/cept-stub.mjs
# exit 0
```

Also: `npm run test:patch1-local`, `npm run staging:isolate`.

---

## 18. Passed Tests

101 tests across 12 files (previous Patch 1 set 84 plus isolation, CEPT stub, and local staging E2E).

---

## 19. Failed Tests

None in the executed commands above.

---

## 20. Code Changes

Local-only / staging / tests (no Patch 2/3/4, no production schema migration):

- `modules/india-post/cept-local-stub.ts` (new)
- `modules/india-post/cept-local-stub.test.ts` (new)
- `modules/india-post/patch1-local-staging.pg.test.ts` (new)
- `scripts/staging/cept-stub.mjs` (login + bulk routes)
- `scripts/staging/verify-local-isolation.mjs` (new)
- `lib/env/staging-isolation.ts` (fail-closed live CEPT / staging loopback)
- `lib/env/staging-isolation.test.ts`
- `.env.staging.example` (loopback CEPT + mock flags)
- `.env.staging.local` (gitignored local file)
- `package.json` (`staging:isolate`, `test:patch1-local`)
- This report

Patch 1 application files (`login-auth.ts`, `tracking-auth-hold.ts`, `tracking-sync.ts`, `provider.ts` login, `processor.ts`) were **verified present** and not rewritten for this staging pass.

---

## 21. Remaining Risks

1. Concurrent insert then worker **claim-before-cancel** can still yield more than one RUNNING job.
2. Hold depends on retained FAILED `tracking-sync` rows.
3. Proposed `55432` cluster identity is still unverified; do not `staging:up` until port/config match `postbus_staging` only.
4. `lib/env.ts` still defaults empty India Post URLs to live CEPT hosts. Staging must keep explicit loopback URLs.
5. Full `cron/jobs` + `processor.ts` OS-process drain was not run against PGlite.
6. RLS not proven under anon/authenticated roles.
7. Scheduler still considers at most ~100 automation rows per tick (pre-existing; Patch 2).

---

## 22. Hosted Staging Requirements

Still required before production:

- Isolated hosted DB (not `hgacoeoovjxkzfbesmvl`)
- Hosted CEPT mock or approved UAT-only credentials
- Real cron + worker drain
- RLS checks with non-service-role clients
- Separate written authorization

---

## 23. Production Safety Confirmation

- No production Supabase writes
- No production cron
- No live India Post booking/tracking
- No Shopify fulfillment
- No Razorpay / WhatsApp / production email
- No production migrations
- No hosted staging deploy
- `.env.local` not loaded into the isolation/test path used here

---

## 24. Final Verdict

**A. LOCAL STAGING VERIFIED — READY FOR HOSTED STAGING SETUP**

Stop. Wait for separate hosted staging authorization.
