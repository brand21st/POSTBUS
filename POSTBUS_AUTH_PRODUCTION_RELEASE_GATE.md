# POSTBUS AUTH PRODUCTION RELEASE GATE

**Date:** 2026-10-14  
**Phase:** 2.7  
**Verdict:** **YELLOW**

Production (`https://www.postbus.in`, Supabase `hgacoeoovjxkzfbesmvl`) is **unchanged**. **No Coolify production deploy.**

---

## Gate summary

| Gate | Status |
|---|---|
| Auth code reviewed (2.6) | PASS (unit) |
| Isolated hosted Auth | **Missing** |
| HTTPS staging host | **Missing** |
| Playwright / Chrome matrix | **NOT EXECUTED** |
| Live token refresh / multi-tab | **NOT EXECUTED** |
| Live Domain cookie migration | **NOT EXECUTED** |
| API coverage (code) | PASS — `POSTBUS_AUTH_API_COVERAGE_REPORT.md` |
| Tenant isolation (unit) | PASS |
| Isolated `tsc` / `next build` (2.6) | PASS at `ab8690e` |
| Full lint / full test | FAIL unrelated (2.6 baseline) |
| Production Auth settings | Untouched (required) |

GREEN is **not** allowed: mandatory browser and refresh verification did not run.

---

## Release candidate (plan only)

| Item | Value |
|---|---|
| Branch | `fix/auth-session-stability` |
| Auth code SHA | `ab8690e8a3f753b828910df91b70506b6106d00b` |
| Docs HEAD at audit | `cd697ba3528f8c07281d4db836c49a430eef166a` |
| Artifact | Next standalone build of **only** those commits — **not** the dirty working tree |
| Forbidden | JWT lifetime, reuse interval, rotation, secret rotation, mass logout |

---

## Production environment checks (do not execute)

1. Confirm Coolify app UUID matches intended **production** app only when deploying production (current file `.coolify-deploy-uuid.txt` = `0efdidjjgztsyqrymxdgyyut` — treat as prod).
2. Confirm `NEXT_PUBLIC_SUPABASE_URL` remains production **only** on that app.
3. Staging, if later approved, must set `POSTBUS_ENV=staging` so `assertStagingAuthIsolation` refuses `hgacoeoovjxkzfbesmvl`.

---

## Deployment steps (do not execute)

1. Explicit written approval after staging browser QA **or** documented residual YELLOW risk acceptance.
2. Cherry-pick/merge **auth commits only**.
3. Build with production env present (prerender `/` needs public Supabase URL).
4. Deploy Coolify production app.
5. Do not change hosted GoTrue JWT/reuse/rotation.

## Smoke tests (after a future authorized deploy)

Login, dashboard navigation, orders, one refresh, confirm no mass `/login` spike. Watch GoTrue `/token` **ratios** vs Phase 1 (591 400 / 91 200 / 566 `already_used` / 74 429 / 7 logout per ~74k `/user`).

## Cookie impact

Host-only `www.postbus.in`; expire `Domain=.postbus.in` auth chunks. Some merchants **one re-login**. Isolated-profile only for Domain tests.

## Rollback

Redeploy previous app SHA. Keep Domain expiry headers if Domain cookies were issued. Do not globally revoke sessions.

## Monitoring

`auth.session_classified` (no tokens). Normalize by `/user` and active users.

## Merchant communication

Optional: “If you are asked to sign in once after this update, that is expected while old cookies are cleared.”

---

## Required production approvals

1. **This phase:** approval to **provision** isolated Auth (new Supabase project, staging Coolify app, DNS) — see staging QA cost table.  
2. **Later:** approval to **deploy** `ab8690e` to production Coolify after GREEN or accepted YELLOW.

Until (1) completes, browser gates stay NOT EXECUTED.
