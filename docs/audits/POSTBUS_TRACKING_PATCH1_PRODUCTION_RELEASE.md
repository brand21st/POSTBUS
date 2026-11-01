# POSTBUS TRACKING PATCH 1 — PRODUCTION RELEASE

Date: 17 Oct 2026  
Stage: **pre-deployment audit only**. Production was **not** deployed.  
Staging: **skipped by user instruction** (accepted process risk, not proof of production compatibility).

Required approval phrase (not received): `APPROVE POSTBUS PATCH1 PRODUCTION DEPLOY`

---

## 1. Pre-deployment audit

Patch 1 is present in the **working tree**, not as a production-based git commit.

| Check | Result |
| --- | --- |
| Login auth classification | **CONFIRMED** `login-auth.ts` |
| Cooldown 15m→24h | **CONFIRMED** `TRACKING_AUTH_HOLD_DELAYS_MS` |
| Recovery-probe throttle | **CONFIRMED** `lastProbeAt` / `probe-throttle` |
| No-work SUCCEEDED cannot clear hold | **CONFIRMED** only `last_verified_at` / `last_refreshed_at` |
| Verify timestamps clear hold | **CONFIRMED** |
| Duplicate QUEUED/PENDING cancel | **CONFIRMED** (not atomic) |
| Org-scoped hold/cancel | **CONFIRMED** in code + PGlite |
| Booking retry codes unchanged | **CONFIRMED** login 400 stays `HTTP_400` until tracking worker tags |
| Shopify fulfillment | **UNCHANGED** (not in Patch 1 files) |
| Schema migration | **NONE** for Patch 1 |
| Hosted RLS | **UNVERIFIED** (PGlite is not RLS) |
| Live CEPT / production SQL this session | **NONE** (Coolify GET identity only) |

**Working tree is not Patch 1-only.** Uncommitted changes also include billing, affiliates, staging env guards, pricing, migrations `20261017*`, and more. Deploying the current branch or dirty tree would ship unrelated production risk.

---

## 2. Application version

| Item | Value |
| --- | --- |
| Production app | Coolify `mw9larpomkyonxzy1rk3h6jm` |
| Production status | `running:healthy` (Coolify API GET, 17 Oct 2026) |
| Production git branch | `release/auth-session-on-prod` |
| **Current production SHA** | `f7c77efde2818198bc4f55fa1a82574d7952057b` |
| Auto-deploy | **false** |
| Local `HEAD` | `9cee1c5c34a6c4ea5766561b3c1ddd0c27e2aca1` (same message as prod, **diverged history**: 59 / 38 commits either side of merge-base `f7c537c`) |
| **Proposed Patch 1 SHA** | **NONE — not committed** |
| Public site | `https://www.postbus.in` |
| Coolify reported FQDN | `mw9larpomkyonxzy1rk3h6jm.89.116.34.166.sslip.io` |
| Database | Supabase `hgacoeoovjxkzfbesmvl` (must remain; no new DB) |
| Job runner | `JOB_RUNNER=database` (Dockerfile copies `scripts/drain-jobs.mjs`) |
| Cron | Three Coolify tasks `* * * * *` on the **same** web container (`infra/HOSTINGER.md`) |
| Worker concurrency | Booking lane default 4; other drain concurrency 2–4 per HOSTINGER runbook. **Do not change.** |
| Health | `GET /api/health` — `jobRunner`, `jobs`, `indiaPost` |
| Logs | Coolify application logs + `india_post.tracking.auth_hold` / `sync_fail` / `sync_ok` |

---

## 3. Files changed (Patch 1 only — intended deploy set)

Do **not** include the rest of the dirty tree.

| Path | Role |
| --- | --- |
| `modules/india-post/login-auth.ts` | Classification |
| `modules/india-post/tracking-auth-hold.ts` | Hold / cooldown / probe throttle |
| `modules/india-post/tracking-sync.ts` | Enqueue skip + duplicate cancel |
| `modules/india-post/provider.ts` | `createIndiaPostLoginError` on `login()` |
| `workers/processor.ts` | `tagTrackingLoginAuthFailure` on tracking catch |
| Matching `*.test.ts` / `*.pg.test.ts` | Local tests only |

**Exclude from this release:** `lib/env.ts` staging CEPT guards, affiliate/billing, `supabase/migrations/20261017*`, Coolify/staging scripts, Patch 2–4.

---

## 4. Test results (executed this preflight)

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
  modules/india-post/cept-local-stub.test.ts \
  modules/india-post/patch1-local-staging.pg.test.ts
```

**11 files, 96 tests, exit 0.** Mocks / PGlite only. No live India Post. No production jobs.

```
npx tsc --noEmit
```

**Exit 0.**

```
npx eslint modules/india-post/login-auth.ts modules/india-post/tracking-auth-hold.ts \
  modules/india-post/tracking-sync.ts modules/india-post/provider.ts workers/processor.ts \
  modules/india-post/login-auth.test.ts modules/india-post/tracking-auth-hold.test.ts \
  modules/india-post/tracking-auth-hold.pg.test.ts
```

**Exit 0.**

---

## 5. Production target

| Field | Target |
| --- | --- |
| Platform | Coolify on Hostinger VPS `89.116.34.166:8000` |
| Application UUID | `mw9larpomkyonxzy1rk3h6jm` |
| Project UUID | `1tko9msc25imaecnzsmntip2` |
| Environment UUID | `phidg7utdwrrrebgpq2mm9am` |
| Database | **existing** production Supabase `hgacoeoovjxkzfbesmvl` |
| Process | Manual Coolify deploy, auto-deploy **off**, **no** `supabase db push`, **no** cron frequency change |

---

## 6. Deployment authorization

**Status: NOT GRANTED.**

Skip-staging is **not** `APPROVE POSTBUS PATCH1 PRODUCTION DEPLOY`.

Do not deploy until:

1. User sends that exact phrase **and**
2. A **Patch 1-only commit** exists with parent **`f7c77ef`** (or Coolify is pointed at that isolated SHA) **and**
3. That SHA is named in the approval.

---

## 7. Deployment status

| Action | Status |
| --- | --- |
| Production image | Unchanged this session |
| Database | Unchanged |
| Cron | Unchanged |
| Credentials | Unchanged |
| Post-deploy observations | **N/A** (not deployed) |

---

## 8. Database changes

**None required. None performed.** Rollback of the app does not require SQL.

---

## 9. Authentication cooldown results

**Pre-deployment (local):** 15m / 1h / 4h / 12h / 24h **PASSED**.

**Post-deployment:** **not observed.**

---

## 10. Failed job comparison

**Baseline (RCA, 24h ending ~17 Oct 2026 14:53 UTC):** 28,702 tracking-sync created; 1,424 FAILED; 1,405 confirmed auth failures (one org).

**Post-deployment:** **not observed.** Expect FAILED auth jobs to continue at **probe cadence**, not ~1,400/day. Do not treat remaining FAILED rows as a Patch 1 defect.

---

## 11. Tracking freshness

**RCA:** pollable AWBs were fresh within 15 minutes.

**Post-deployment:** **not observed.** Watch `last_tracked_at` on non-held orgs. Held orgs will be **intentionally stale** until credentials work or a probe runs.

---

## 12. Booking health

**Pre-deployment:** booking lock tests PASSED; login 400 remains `HTTP_400` for retry classification.

**Post-deployment:** **not observed.** Watch `shipment-booking` FAILED rate.

---

## 13. Shopify compatibility

Patch 1 does not modify fulfillment. **Post-deployment:** **not observed.** Watch `shopify-fulfillment` jobs.

---

## 14. Remaining risks

1. **Skip-staging** — no hosted RLS, no real worker drain, no production-like cron overlap.  
2. **Claim-before-cancel race** — not eliminated; extra RUNNING job possible; bounded, not a unique index.  
3. **Hold depends on FAILED job retention** — no app purge found; ops DELETE of FAILED tracking-sync would drop the hold.  
4. **False-positive hold** — only if login HTTP 400/401 matches the phrase allowlist. Unrelated 400 should not hold.  
5. **Enqueue limit 50** — pre-existing; not Patch 2.  
6. **No Patch 1 feature flag in code** — rollback is Coolify previous deployment (`f7c77ef`). Optional later env kill-switch was **not** added (would be extra untested surface on this dirty tree).  
7. **Diverged git** — cannot deploy `fix/auth-session-stability` HEAD as “Patch 1”.  
8. **Working-tree contamination** — affiliate/billing/migrations must stay out.

---

## 15. Rollback readiness

**App rollback (no DB change):**

1. Coolify → application `mw9larpomkyonxzy1rk3h6jm` → Deployments → redeploy **`f7c77efde2818198bc4f55fa1a82574d7952057b`** / previous healthy image.  
2. Confirm auto-deploy remains **off**.  
3. Confirm `GET /api/health` `jobRunner=database`.  
4. Do **not** restore a database backup for this patch.  
5. Do **not** delete `background_jobs` or tracking events.  
6. CANCELLED duplicates (`DUPLICATE_TRACKING_SYNC`) are harmless leftovers.

**Database backups:** dashboard PITR/backup for `hgacoeoovjxkzfbesmvl` is **operator-confirmed, not verified in this session**. Not required for Patch 1 rollback.

---

## 16. Final verdict

**PREFLIGHT COMPLETE — DO NOT DEPLOY.**

Local Patch 1 behavior is test-backed. Production identity is verified (`f7c77ef`, Coolify healthy, auto-deploy off). Release is **blocked** until a Patch 1-only SHA on top of production exists and the user explicitly approves that SHA.

**Recommended next step (still not a deploy):**

1. Branch from `f7c77ef`.  
2. Copy only the Patch 1 files listed in §3.  
3. Commit. Name that SHA.  
4. User: `APPROVE POSTBUS PATCH1 PRODUCTION DEPLOY` including that SHA.  
5. Coolify manual deploy of **that** commit only.

Patches 2, 3, 4: **not in this release.**

---

## Monitoring checklist (after a future authorized deploy)

Read-only. Do not replay jobs. Do not call CEPT by hand.

- `india_post.tracking.auth_hold` log rate  
- tracking-sync created / FAILED / CANCELLED (`DUPLICATE_TRACKING_SYNC`) / SUCCEEDED per hour  
- Distinct orgs with `PERMANENT_AUTH_ERROR` / HTTP 400 auth phrase  
- Probe vs storm: jobs per held org per hour (expect ~0 during cooldown, 1 after)  
- Booking FAILED  
- Shopify fulfillment FAILED  
- Overdue jobs / `GET /api/health` `jobs`  
- Supabase CPU/IO (extra 1–2 bounded job reads per enqueue candidate)

---

## Deployment gate (presented; waiting)

- **Target:** Coolify `mw9larpomkyonxzy1rk3h6jm` / `https://www.postbus.in` / Supabase `hgacoeoovjxkzfbesmvl`  
- **Current SHA:** `f7c77efde2818198bc4f55fa1a82574d7952057b`  
- **New SHA:** **not created**  
- **Expected ops change:** bad-credential orgs stop flooding `tracking-sync`; others unchanged  
- **Rollback:** redeploy `f7c77ef`  

Reply with `APPROVE POSTBUS PATCH1 PRODUCTION DEPLOY` **and the isolated commit SHA** when ready. Until then, production stays on `f7c77ef`.
