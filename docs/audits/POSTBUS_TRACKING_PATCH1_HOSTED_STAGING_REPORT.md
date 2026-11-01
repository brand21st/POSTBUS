# POSTBUS TRACKING PATCH 1 — HOSTED STAGING REPORT

Date: 17 Oct 2026  
Stage executed: **A only** (discovery, safety audit, local revalidation, setup plan).  
Stage B (hosted deploy/writes): **not started**.

---

## 1. Executive summary

Patch 1 is present on the current branch (login classification, org-scoped hold, cooldown, probe throttle, duplicate QUEUED cancel). Local revalidation: **84 tests passed** (Patch 1 suite + staging isolation).

**No hosted staging project was identified as approved.** `.env.staging.local` is **absent**. `.env.local` remains production-pointed and was **not** used. Production `hgacoeoovjxkzfbesmvl` was **not** written.

**Verdict: A — READY FOR HOSTED STAGING (Awaiting explicit authorization)**

---

## 2. Environment identity

| Item | Status |
| --- | --- |
| Production Supabase ref | `hgacoeoovjxkzfbesmvl` — **forbidden** (`lib/env/staging-isolation.ts` `PRODUCTION_SUPABASE_REF`) |
| `.env.local` | Production host — **must not** drive staging |
| `.env.staging.example` | Isolated template (port 3001, `JOB_RUNNER=database`, `CEPT_STUB_URL=http://127.0.0.1:4099`) |
| `.env.staging.local` | **Missing** — `npm run dev:staging` fail-closed |
| Hosted staging project ID | **None authorized** |
| Local isolated Postgres plan | `127.0.0.1:55432` / `postbus_staging` via `scripts/staging/` — **not started this session** |
| Runtime | Vitest + PGlite mocks |

---

## 3. Production isolation verification

| Check | Result |
| --- | --- |
| Staging runtime refuses production URL | **PASS** `assertStagingRuntimeEnv` / `assertStagingAuthIsolation` |
| Staging refuses live Razorpay `rzp_live_` | **PASS** |
| Staging refuses payouts / tax invoice flags | **PASS** |
| Local PG provision refuses production host/CEPT | **PASS** `scripts/staging/assert-not-production.mjs` |
| This session production SQL/cron/CEPT/Shopify | **NONE** |
| Coolify production app | **not restarted / not deployed** |

A staging app using a production service-role key is forbidden by identity guards if the URL/host contains the production ref.

---

## 4. Staging architecture (proposed, not provisioned)

```
Staging Next.js (PORT 3001, POSTBUS_ENV=staging)
        |
        v
Isolated DB (new Supabase project XOR local 127.0.0.1:55432 postbus_staging)
        |
        v
Synthetic orgs A–E
        |
        v
CEPT stub 127.0.0.1:4099  (must be extended for /access/login + /tracking/bulk)
        |
        v
JOB_RUNNER=database + CRON_SECRET (staging-only) + manual POST /api/cron/jobs
```

Disable: Shopify keys, Razorpay, VaChat/WhatsApp, affiliate payouts, tax invoices, India Post webhooks (`INDIA_POST_WEBHOOK_ALLOWED_CIDRS` empty), bulk booking.

**Gap:** `scripts/staging/cept-stub.mjs` today implements `/book` and GET `/track?mode=`. The app login/track path is `POST .../access/login` and `POST .../tracking/bulk` (`modules/india-post/provider.ts`). Stage B **must** extend the stub or abort CEPT calls. Localhost is an allowed India Post host (`modules/india-post/environment.ts`).

---

## 5. Deployment details

| Action | Status |
| --- | --- |
| Hosted Coolify/Vercel staging app | **Not deployed** |
| Isolated Supabase project create | **Not performed** |
| `npm run staging:up` | **Not run** |
| `npm run dev:staging` | **Blocked** (no `.env.staging.local`) |
| Patch 1 migrations | **None required** |

### Setup actions requiring explicit user authorization

1. Name a **non-production** Supabase project ref (not `hgacoeoovjxkzfbesmvl`) **or** approve local `staging:up`.  
2. Create gitignored `.env.staging.local` from `.env.staging.example` with that identity.  
3. Apply **existing** repo migrations to that DB only (not Patch 1-specific).  
4. Extend CEPT stub for login/bulk tracking modes listed in Section 9 of the prompt.  
5. Seed synthetic orgs (no production dump).  
6. Authorize Stage B: deploy + controlled cron against **that** target only.

---

## 6. Authentication hold tests

Local: **PASS** (`login-auth.test.ts`, `tracking-auth-hold.test.ts`, `provider.session.test.ts`).  
Hosted: **UNVERIFIED**.

Code: `modules/india-post/login-auth.ts`, `provider.ts` `login()` (~66–90), `workers/processor.ts` `tagTrackingLoginAuthFailure` (~771–783), `tracking-sync.ts` enqueue (~96–137).

---

## 7. Cooldown tests

Local: **PASS** (15m/1h/4h/12h/24h via injected `now`).  
Hosted: **UNVERIFIED**.

Code: `TRACKING_AUTH_HOLD_DELAYS_MS` in `tracking-auth-hold.ts`.

---

## 8. Empty recovery-probe tests

Local: **PASS** after probe-throttle (`lastProbeAt` + same delay; 2 consecutive cron mocks did not enqueue).  
Hosted 10-cycle cron: **UNVERIFIED**.

Code: `decideTrackingAuthHold` `probe-throttle` (~107–114), `loadLatestTrackingSyncAfter` (~125+).

---

## 9. Concurrent scheduler tests

Local PGlite: 2 inserts → 2 QUEUED; 5 inserts → 1 QUEUED + 4 CANCELLED. **PASS**.  
RUNNING-before-cancel: **UNVERIFIED** on hosted. Residual race remains (no unique index). Not treated as unbounded amplification locally.

---

## 10. Credential recovery tests

Local: **PASS** (`last_verified_at` / `last_refreshed_at` after failure; no-work does not clear; stale timestamps keep hold).  
Hosted connect/verify: **UNVERIFIED**.

---

## 11. Booking regression tests

Local: login 400 stays `HTTP_400`; booking lock tests **PASS**. Payload/lock TTL not changed.  
Hosted mocked booking: **UNVERIFIED**.

---

## 12. Shopify regression tests

Patch 1 does not touch Shopify fulfillment modules. External writes **not executed**. Hosted Shopify: **UNVERIFIED** (should stay disabled).

---

## 13. Multi-tenant security

Local Org A/B isolation **PASS**. RLS on hosted staging: **UNVERIFIED**. No P0 from Patch 1 code review (queries filter `organization_id`).

---

## 14. Database integrity

No Patch 1 schema change. Hold uses `background_jobs` + existing connection timestamps. Hosted schema apply: **not run**.

---

## 15. Performance results

No 100/500/1000-org benchmark this session (**not fabricated**). Extra query only when an auth FAILED row exists (limit 10 + optional limit 1). Index: `jobs_org_status_idx`.

---

## 16. Actual test results

```
npx vitest run modules/india-post/login-auth.test.ts \
  modules/india-post/tracking-auth-hold.test.ts \
  modules/india-post/tracking-auth-hold.pg.test.ts \
  modules/india-post/tracking-sync.test.ts \
  modules/india-post/provider.session.test.ts \
  modules/india-post/session.test.ts \
  lib/jobs/retry.test.ts \
  modules/india-post/apply-tracking.test.ts \
  modules/india-post/booking-lock.test.ts \
  lib/env/staging-isolation.test.ts
```

**10 files, 84 tests, passed. Exit 0.**

---

## 17. Failed tests

**None** in that run.

---

## 18. Unverified scenarios

All hosted Tests A–I. Live CEPT. Live Shopify. Production cron. Operator job-purge. Claim-before-cancel on a real drain. CEPT stub login/bulk compatibility until extended.

---

## 19. Remaining risks

| Sev | Item |
| --- | --- |
| P1 if Stage B skips stub | Accidental CEPT UAT/prod if URLs mis-set |
| P2 | Duplicate RUNNING before cancel |
| P2 | Hold depends on FAILED row retention |
| P2 | Existing stub ≠ app login/bulk paths |

---

## 20. Rollback plan

Revert Patch 1 application files (`login-auth.ts`, `tracking-auth-hold.ts`, `tracking-sync.ts`, `provider.ts` login throw, `processor.ts` catch). No schema rollback. Staging DB can be discarded if isolated. Production unchanged this session.

---

## 21. Release gate matrix

| Gate | Status |
| --- | --- |
| 1 Classification | **PASS** local |
| 2 Cooldown | **PASS** local |
| 3 No-work does not clear hold | **PASS** local |
| 4 No probe storm | **PASS** local |
| 5 Concurrent acceptable | **PASS** local (residual race documented) |
| 6 Credential recovery | **PASS** local |
| 7 Other merchants | **PASS** local |
| 8 Booking | **PASS** local |
| 9 Shopify | **UNVERIFIED** hosted; code untouched |
| 10 Multi-tenant | **PASS** local; hosted RLS **UNVERIFIED** |
| 11 Durability | **PASS** local; ops purge **UNVERIFIED** |
| 12 No Patch 1 migration | **PASS** |
| 13 Hosted staging | **UNVERIFIED** / **BLOCKED pending authorization** |
| 14 Rollback documented | **PASS** |
| 15 Production untouched | **PASS** |

---

## 22. Final verdict

**A. READY FOR HOSTED STAGING (Awaiting explicit authorization)**

Not B (hosted not run). Not C (no local blocker). Not D for local evidence; hosted remains insufficient until Stage B.

---

## 23. Recommended next step

User must explicitly authorize **one** of:

- Isolated Supabase project ref `________` (not production), plus Stage B deploy/test scope; **or**
- Local `npm run staging:up` + `staging:stub` + `.env.staging.local` on 127.0.0.1 only.

Then: extend CEPT stub for login/bulk, seed synthetic orgs, run controlled cron. **Do not** use `.env.local`. **Do not** deploy production.
