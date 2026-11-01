# POSTBUS HOSTED STAGING — SETUP PLAN (STAGE A)

Date: 17 Oct 2026  
Stage executed: **A only**. No hosted project created. No Coolify deploy. No production changes.

Patch 1 local evidence (prior session): 101 tests / 12 files, `tsc` 0, ESLint 0. PGlite only.

---

## 1. Executive Summary

PostBus production runs on **Coolify** (Hostinger VPS) with **Supabase** project `hgacoeoovjxkzfbesmvl`. There is **no approved hosted staging project**. `auth-staging.postbus.in` was planned in prior auth work and **not created**.

Stage A recommends:

| Layer | Production (forbidden) | Proposed staging (not provisioned) |
| --- | --- | --- |
| App | Coolify `mw9larpomkyonxzy1rk3h6jm` | **New** Coolify application |
| Database | `hgacoeoovjxkzfbesmvl` | **New** Supabase project |
| URL | `https://www.postbus.in` | Dedicated host, not www |
| CEPT | `app.indiapost.gov.in` / `test.cept.gov.in` | Private mock service |
| Cron | live `CRON_SECRET` + three drain lanes | Separate secret; **disabled** until Stage B tests |

Fail-closed CEPT defaults for `POSTBUS_ENV=staging` are now in source: empty URLs no longer fall back to live CEPT.

**Stage A verdict: READY FOR STAGING PROVISIONING APPROVAL**

---

## 2. Current Environment Discovery

| Item | Evidence |
| --- | --- |
| Production site | `https://www.postbus.in` |
| Production Supabase | `hgacoeoovjxkzfbesmvl` (`infra/HOSTINGER.md`, `PRODUCTION_SUPABASE_REF`) |
| Production Coolify | Dashboard `http://89.116.34.166:8000`, app UUID `mw9larpomkyonxzy1rk3h6jm`, project `1tko9msc25imaecnzsmntip2` |
| Image | repo `Dockerfile` (Next standalone, `scripts/drain-jobs.mjs`) |
| Jobs | `JOB_RUNNER=database`, `POST /api/cron/jobs`, `claim_background_jobs` service_role only |
| GitHub Actions | **None** in this repo |
| Coolify auto-deploy | Historically **off**; webhook still treated as high caution — **do not push** as Stage A |
| Current git branch | `fix/auth-session-stability` (not a staging deploy) |
| `.env.local` | Exists; production-pointed; **must not** load for staging |
| Local mock | `scripts/staging/cept-stub.mjs` login + bulk (Patch 1 local work) |

---

## 3. Existing Staging Availability

| Capability | Status |
| --- | --- |
| Separate Supabase staging project | **Not found / not approved** |
| Staging Next.js Coolify app | **Not found** |
| Staging domain | `auth-staging.postbus.in` **not created** (prior QA) |
| Local `.env.staging.local` | Present, gitignored, loopback-only (PGlite/CEPT stub) |
| Local Postgres 55432 | **Not listening**; unsafe to start without identity proof |
| CEPT stub (local) | Implemented; loopback bind |
| Hosted CEPT mock | **Not deployed** |
| Staging cron | **Not configured** |

Do not reuse the production Coolify app or production Supabase as “staging.”

---

## 4. Recommended Staging Architecture

```
Git branch (not production watched branch)
        |
        v
New Coolify application (auto-deploy OFF)
        |
        +-- Next.js staging (POSTBUS_ENV=staging)
        +-- CEPT mock service (private network)
                |
                v
New Supabase project (not hgacoeoovjxkzfbesmvl)
        |
        +-- schema from existing supabase/migrations
        +-- synthetic orgs A–E only
        +-- background_jobs / claim_background_jobs
```

Local PGlite remains the developer loop. Hosted staging is the Patch 1 **RLS + real worker** loop.

---

## 5. Supabase Staging Requirements

Create a **new** Supabase project (name suggestion: `postbus-hosted-staging`).

Must differ from `hgacoeoovjxkzfbesmvl`.

Require: separate URL, anon key, service role, JWT, Auth site URL, storage, backups, logs.

Set `POSTBUS_STAGING_PROJECT_REF=<that ref>` so the runtime allowlist matches `NEXT_PUBLIC_SUPABASE_URL`.

Apply **existing** `supabase/migrations` in order. Patch 1 needs **no new migration**.

Do **not** copy production data, Auth users, Shopify tokens, or storage objects.

---

## 6. Deployment Platform Findings

Platform is **Coolify on Hostinger VPS**, not Vercel.

Dockerfile build args default `NEXT_PUBLIC_APP_URL=https://www.postbus.in`. Stage B **must** override:

- `NEXT_PUBLIC_APP_URL` = staging URL  
- `NEXT_PUBLIC_SUPABASE_URL` / anon key = staging project  

`COOLIFY_APPLICATION_UUID` for staging **must not** be `mw9larpomkyonxzy1rk3h6jm` (`PRODUCTION_COOLIFY_APPLICATION_UUID`).

Pushing this branch is **not** authorized in Stage A. Production Coolify has historically watched other branches with auto-deploy off; still treat any push as a production risk until the watched branch is confirmed in the dashboard at Stage B.

---

## 7. Environment Variable Inventory

Names from `lib/env.ts` / `.env.example` (not invented aliases):

| Purpose | Variables |
| --- | --- |
| App | `NEXT_PUBLIC_APP_URL`, `POSTBUS_ENV=staging`, `NODE_ENV=production` |
| Allowlist | `POSTBUS_STAGING_PROJECT_REF` |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Jobs | `JOB_RUNNER=database`, `CRON_SECRET` (staging-only), `JOB_RUNNER_URL` |
| India Post | `INDIA_POST_UAT_BASE_URL`, `INDIA_POST_PROD_BASE_URL` (both mock), `INDIA_POST_STAGING_ALLOWED_HOSTS`, `INDIA_POST_BULK_ENABLED=false`, `INDIA_POST_WEBHOOK_ALLOWED_CIDRS=` (empty) |
| Shopify | **omit** `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` (guard refuses them when `POSTBUS_ENV=staging`) |
| Razorpay | omit keys; `POSTBUS_BILLING_TAX_INVOICE_ENABLED=false` |
| WhatsApp | omit `VACHAT_API_KEY`; `AUTH_WHATSAPP_OTP_ENABLED=false` |
| Coolify | staging UUID only; do not point domain-sync at production app |

`SHOPIFY_MOCK_MODE` / `RAZORPAY_DISABLED` / `WHATSAPP_DISABLED` are **labels only** unless keys are empty and no production rows are seeded. The app checks real keys (`isShopifyAppConfigured`, VaChat config, Razorpay).

---

## 8. Production Isolation Risks

1. `.env.local` production Supabase — staging loaders must not inherit it.  
2. Dockerfile public URL default is production.  
3. Live CEPT defaults in `lib/env.ts` when **not** staging — now skipped for `POSTBUS_ENV=staging`.  
4. Coolify webhook / wrong-branch push.  
5. `claim_background_jobs` is service_role: staging service role must never be production.  
6. `platform_settings` / org Shopify/VaChat rows if anyone dumps production. **Forbidden.**  
7. Network egress on the VPS is **not** proven isolated; application guards are the primary control.

---

## 9. India Post Fallback Risk

**Was:** empty `INDIA_POST_*_BASE_URL` → `test.cept.gov.in` / `app.indiapost.gov.in`.

**Now (staging runtime only):**

- Missing/empty URLs throw.  
- Live CEPT hostnames throw.  
- Host must be loopback or `INDIA_POST_STAGING_ALLOWED_HOSTS`.  
- Both UAT and PRODUCTION base URLs must be the mock (connection `environment` still selects which variable, but both point at mock).  
- Non-staging production Coolify behavior **unchanged**.

---

## 10. CEPT Mock Deployment Plan

Reuse `scripts/staging/cept-stub.mjs` (login + bulk + book).

Hosted:

- Separate Coolify service / container.  
- Bind **private** network hostname; do not publish 4099 to the internet.  
- Set staging `INDIA_POST_*` to `http://<internal-host>:4099/beextcustomer`.  
- Add that hostname to `INDIA_POST_STAGING_ALLOWED_HOSTS`.  
- `127.0.0.1` inside the Next container is **not** the stub unless they share a network namespace.

Residual: stub has no request auth. Isolation depends on private networking. Public exposure = risk.

---

## 11. Background Worker Setup

Same architecture as production: web container + `node scripts/drain-jobs.mjs` → `POST /api/cron/jobs`.

Staging:

- `JOB_RUNNER=database`  
- `JOB_RUNNER_URL=http://127.0.0.1:$PORT` (in-container)  
- Staging `CRON_SECRET`  
- Staging service role → staging DB only  
- Initial Patch 1 lane: `JOB_TYPES=tracking-sync` only  
- Do not enable `shipment-booking`, `shopify-fulfillment`, `vachat-notify`, `wati-notify` until those mocks exist  

Do not rewrite the runner. Do not implement Patch 2.

---

## 12. Cron Configuration Plan

1. Create staging scheduled tasks **disabled**.  
2. After Stage B isolation proof, invoke **once**:  
   `JOB_TYPES=tracking-sync node scripts/drain-jobs.mjs`  
3. Then optional `* * * * *` tracking-sync only.  
4. Never point Coolify cron at `https://www.postbus.in`.  

`authorizeCron` disables the endpoint if `CRON_SECRET` is empty — keep it set on staging but **pause the scheduler**.

---

## 13. Synthetic Data Plan (Stage B only)

Run id e.g. `HOSTED-PATCH1-<date>`.

ORG_A–E as in local staging. Synthetic users USER_A / USER_B for RLS.

No real phones, addresses, CEPT passwords, Shopify tokens.

---

## 14. RLS Testing Plan (hosted only)

PGlite did **not** prove RLS.

Policies exist (`supabase/migrations/20260919090300_rls_storage_triggers.sql`): `organizations`, `shipments`, `tracking_events`, `india_post_connections`, `background_jobs`, `automation_settings` use org membership (`is_org_member`).

Stage B:

1. Seed USER_A ∈ ORG_A, USER_B ∈ ORG_B.  
2. Authenticated Supabase client (anon key + user JWT), **not** service role.  
3. Assert USER_A cannot read/update ORG_B jobs, shipments, connections.  
4. Assert USER_B cannot clear ORG_A hold via merchant APIs.  
5. Service role must still filter `organization_id` in Patch 1 queries (code review already org-scoped).  
6. Public tracking pages must not leak auth-hold internals.

Any cross-tenant leak is a **production release blocker**.

---

## 15. Expected Infrastructure Cost

Estimates only; no spend in Stage A.

| Item | Likely cost |
| --- | --- |
| New Supabase project | $0 on free tier, or ~$25/mo Pro if required for compute |
| New Coolify app on existing VPS | $0 incremental (same `89.116.34.166`) |
| Staging hostname on existing Cloudflare zone | $0 if zone owned |
| CEPT mock container | $0 on same VPS |
| India Post / Shopify / Razorpay | $0 (mocked/omitted) |

---

## 16. Required Setup Steps (after approval)

1. User names **exact** Supabase project ref and Coolify application UUID.  
2. Run `npm run staging:hosted-gate` against a gitignored env file that contains those identities.  
3. Create Supabase project; confirm ref ≠ `hgacoeoovjxkzfbesmvl`.  
4. Apply existing migrations to that project only.  
5. Deploy CEPT mock privately; set allowlist.  
6. Create Coolify app from `Dockerfile` with staging build args; auto-deploy **off**.  
7. Set staging env (section 7). Restart staging only.  
8. Seed synthetic orgs/users.  
9. Manual tracking-sync drain; then Patch 1 E2E + RLS.  
10. Write `POSTBUS_TRACKING_PATCH1_HOSTED_STAGING_EXECUTION_REPORT.md`.

---

## 17. Actions Requiring Authorization (Stage B)

Explicit approval must name:

- Staging **Supabase project ref**  
- Staging **database** (that project’s Postgres)  
- Staging **Coolify application UUID** (≠ `mw9larpomkyonxzy1rk3h6jm`)  
- Staging **public URL** (≠ `www.postbus.in`)  
- Operations: create project, migrate, deploy staging app, deploy mock, seed synthetic data, run controlled cron, RLS tests  

Not included: production deploy, production env, production DNS cutover, Patches 2–4, production migrations.

---

## 18. Rollback Strategy

- Disable staging Coolify scheduled tasks.  
- Stop/restart previous staging image (Coolify deployment history).  
- Keep `CRON_SECRET` rotated if leaked.  
- Stop CEPT mock container.  
- Staging DB: retain or reset **staging only**; never restore a production backup into staging.  
- Production Coolify app and production Supabase: **untouched**.

---

## 19. Security Checklist

- [x] Production Supabase denylist in code  
- [x] Production Coolify UUID denylist in hosted gate  
- [x] Staging CEPT no live fallback  
- [x] Staging refuses Shopify/VaChat keys when `POSTBUS_ENV=staging`  
- [ ] Hosted project ref named by user  
- [ ] Private mock network  
- [ ] RLS authenticated tests  
- [ ] Cron paused until isolation proof  
- [ ] No production dump  

---

## 20. Final Stage A Verdict

**READY FOR STAGING PROVISIONING APPROVAL**

Stop. Name the staging Supabase ref, Coolify UUID, URL, and operations before Stage B.
