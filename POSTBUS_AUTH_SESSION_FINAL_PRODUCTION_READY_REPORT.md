# POSTBUS AUTH SESSION FINAL PRODUCTION READY REPORT

**Date:** 2026-10-14  
**Phase:** 2.6 final hardening  
**Production:** https://www.postbus.in — **not deployed**  
**Hosted Supabase Auth / JWT / reuse / rotation / secrets:** **not changed**

---

## 1. Executive summary

Phase 2 already classified transient GoTrue errors and stopped treating them as logout, used host-only cookies, and skipped proxy `getUser()` on `/api/*`.

Phase 2.6 confirmed remaining defects and applied **small** corrections:

1. **HTML proxy** still called `getUser()` on every dashboard navigation while the access JWT was valid, racing the browser auto-refresh (`@supabase/auth-js` is **lockless by default**; `navigatorLock` is deprecated and **has no effect** on this SDK).
2. **Legacy Domain cookie expiry** ran on every `createClient()` call (hooks, login, notifications), causing repeated `document.cookie` writes in normal Chrome.
3. Dashboard **onboarding redirect** could fire on `/me` 5xx because `me.error` was not treated as a session-gate failure.
4. Transient `/me` with no cached user still **mounted protected page trees**.

Browser / multi-tab / Domain-cookie live tests remain **NOT EXECUTED** (no isolated GoTrue; production testing forbidden). **Verdict: YELLOW.**

---

## 2. Root cause verification

| Cause | Status |
|---|---|
| Concurrent `/token` (`refresh_token_already_used`) | **Confirmed** (Phase 1 logs + SDK lockless + proxy/API/browser) |
| Duplicate `getUser()` (proxy + API) | **Confirmed**; API skip in Phase 2; HTML skip when JWT valid in 2.6 |
| Transient errors treated as logout | **Confirmed**; Phase 2 classifier; 2.6 also maps 5xx `/me` for the session gate |
| Mixed `Domain=.postbus.in` vs host-only | **Confirmed**; host-only + Domain expiry |
| Dashboard premature `/login` | **Confirmed**; login only on `AUTH_REQUIRED` |
| Chrome worse than Incognito | **Partially confirmed** (multi-tab + leftover Domain cookies + extra cookie writes); live Chrome **NOT EXECUTED** |

---

## 3. Remaining defects found (2.6)

| Defect | Severity | Action |
|---|---|---|
| Proxy `getUser` on every dashboard HTML request with a live JWT | P0 | Fixed: skip unless expired / unreadable / auth HTML |
| `expireLegacyDomainCookiesInBrowser` on every `createClient()` | P0 | Fixed: once per page |
| `/me` 5xx → onboarding | P0 | Fixed: `shouldRedirectToOnboardingFromMe` |
| Transient without `/me` still mounted children | P0 | Fixed: mount only if `hasMe` |
| Auth JS default lock is **null**; `navigatorLock` ignored | P0 (constraint) | Documented; no custom mutex; hosted reuse **not** changed |
| Live Chrome / Domain cookie / token expiry | P0 validation | **NOT EXECUTED** |

---

## 4. Final code fixes implemented

- Skip proxy `getUser` when dashboard/admin/onboarding cookies contain an access token with `exp` more than 60s in the future. **Not** used as API authorization.
- Missing cookies on those HTML routes redirect to login **without** calling GoTrue.
- Auth pages still call `getUser` so signed-in users bounce to `/dashboard`.
- Legacy Domain expiry once per document.
- Session gate: 429 / 500 / 502 / 503 / 504 are transient; Retry button; no onboarding on error.
- Hydration via `useSyncExternalStore` (removes `setHydrated` in effect).
- Alerts/WebUSB listeners only after `/me` succeeds.

**Not done:** custom mutex, `getSession()` for auth, JWT/reuse/rotation changes, Playwright, production deploy.

---

## 5. Git branch and SHA

Recorded at commit time on `fix/auth-session-stability`. Parent auth fix: `42383c4c174fcc92b67e83c2a9e2eb0f9b9c7470`. Gate report: `a76480edbd3299385bb1cfdd61ec3b92f5cef1bf`. Unrelated dirty files remain unstaged.

---

## 6. Authentication architecture

```
LOGIN (password / WhatsApp OTP / email callback)
        |
        v
GoTrue session → host-only chunked cookies (www.postbus.in)
        |
        +-- Browser createBrowserClient (SSR singleton, autoRefresh, lockless)
        |     expire Domain=.postbus.in auth chunks once
        |
        +-- proxy.ts
        |     apex postbus.in → 308 www.postbus.in
        |     /api, public HTML: no getUser
        |     dashboard HTML: getUser only if JWT expired/unreadable
        |     missing cookies: /login
        |
        +-- API getRequestAuthUser → getUser() → classify
        |     requireTenant / requirePlatformAdmin
        |
        v
Dashboard /me → bounded retry → login only on AUTH_REQUIRED 401
```

---

## 7. Token refresh behavior

Installed `@supabase/ssr@0.12.7` / `supabase-js@2.116.0`: in-instance refresh coalescing; **no** `navigator.locks` unless a custom lock is supplied, and **supplying `navigatorLock` has no effect**. Cross-tab races are left to GoTrue reuse (hosted, unchanged).

PostBus reduces races by:

- Not refreshing in the proxy for `/api/*` or public HTML.
- Not refreshing in the proxy for dashboard HTML while JWT is valid.
- Treating `refresh_token_already_used` and 429 as transient (no login, no protected payload).

APIs still `getUser()` when the JWT is expired (required for authorization). That can still race the browser near expiry.

---

## 8. Cookie migration behavior

Canonical host: **www.postbus.in**. New cookies: host-only, Path `/`, SameSite Lax, Secure on HTTPS. Callback strips `domain`. Legacy `Domain=.postbus.in` chunks expired via extra `Set-Cookie` / one-time `document.cookie`. Chunk indexes `.0`–`.5`.

**Live Domain-cookie browser verification: NOT EXECUTED** (localhost cannot exercise `.postbus.in`). One-time re-login remains possible.

---

## 9. Dashboard recovery behavior

Transient: banner + Retry; keep previous `/me` pages; do not mount new protected trees; do not login; do not onboarding. Confirmed 401 `AUTH_REQUIRED`: login. Admin 403: “Not found”, not login. Bounded retries (2) with exponential delay cap 4s.

---

## 10. API authentication coverage

See `POSTBUS_AUTH_API_COVERAGE_REPORT.md`. No route was proxy-only protected.

---

## 11. Tenant security verification

Code + unit tests **PASS**. Live Merchant A vs B **NOT EXECUTED**. Super Admin still `requirePlatformAdmin`. No global user cache (`React cache()` per request). Session recovery does not switch user ids (still `getUser()`).

---

## 12–14. Browser / multi-tab / token expiry matrix

| ID | Test | Result |
|---|---|---|
| A | Chrome normal | NOT EXECUTED |
| B | Isolated context (not real Incognito) | NOT EXECUTED |
| C | Multi-tab | NOT EXECUTED |
| D | Controlled JWT expiry | NOT EXECUTED (would require isolated Auth) |
| E | Temporary network | NOT EXECUTED (unit classifier only) |
| F | HTTP 429 | Unit PASS; browser NOT EXECUTED |
| G | HTTP 503 | Unit PASS; browser NOT EXECUTED |
| H | Invalid session | Unit PASS; browser NOT EXECUTED |
| I | Explicit logout | Code review; browser NOT EXECUTED |
| J | Browser restart | NOT EXECUTED |
| K | Legacy Domain cookies | Unit PASS; live hostname NOT EXECUTED |
| L | Super Admin | Unit/code PASS; browser NOT EXECUTED |
| M | Tenant isolation | Unit PASS; live NOT EXECUTED |

**Missing for execution:** non-production app URL, non-production Supabase Auth project, isolated test accounts, HTTPS hostname that can set `Domain=.postbus.in`. Local CEPT staging is **not** isolated GoTrue. Do not use production merchants.

---

## 15. Automated test results

Auth-focused vitest (Phase 2.6): **7 files, 39 passed**.

Full `npm test` / lint / typecheck / build: run in isolated worktree on the release commit (see section 16). Previous baseline: 1590 pass / 5 fail (xlsx/PDF/canvas, not auth); eslint 31 errors.

---

## 16. Build and lint results

Filled after isolated worktree run on the release SHA.

---

## 17. Performance observations

- Fewer GoTrue `getUser`/`/token` from HTML navigations while JWT valid.
- `/me` still once per dashboard load (React Query); retries bounded.
- Legacy Domain expiry no longer writes on every hook `createClient()`.
- No new polling. No unbounded refresh loop (`REFRESH_FAILURE_COOLDOWN_MS` in auth-js still applies in-browser).

Live request-storm measurement: **NOT EXECUTED**.

---

## 18. Remaining risks

1. Near-expiry HTML + browser + API `getUser` can still collide; recovery is transient 503, not login.
2. Multi-tab lockless Auth JS.
3. Mixed cookies may need one re-login.
4. Browser matrix not run.
5. Do not ship unrelated dirty-tree files with this branch.
6. Repo-wide lint/full tests historically red for non-auth reasons.

---

## 19. Deployment procedure

1. Explicit production approval.
2. Deploy **only** auth commits from this branch (cherry-pick if needed). Do not deploy the dirty working tree.
3. Coolify env must include public Supabase URL/anon key (prerender `/`).
4. Do not change JWT, rotation, reuse, or secrets.
5. Do not mass-logout.
6. Canary: GoTrue `/token` 200 vs 400 vs `already_used` vs 429 vs `/logout`, normalized by `/user` volume and active users.

---

## 20. Cookie-safe rollback

| Deployed | Host-only session cookies; extra Domain expiry headers |
|---|---|
| Legacy | `Domain=.postbus.in` auth chunks Max-Age=0 |
| Rollback app | Previous SHA; Domain cookies **already expired** are not restored |
| Mixed risk | Rolling back **without** keeping Domain expiry can reintroduce mixed chunks if anything still sets Domain (callback on old SHA did) |
| Compatibility | Prefer rollback that **keeps** Domain expiry headers if Domain cookies were ever issued |
| Merchants | Some may need **one** sign-in; do **not** clear all storage or invalidate all refresh tokens |

---

## 21. Production monitoring plan

Compare to Phase 1 (~24h): 591 `/token` 400, 91 `/token` 200, 566 `already_used`, 74 429, 7 `/logout`, ~74,657 `/user` 200.

Normalize by active users, `/user` volume, and window. Success = lower **ratio** of `/token` 400 and login-page bounces per `/user`, not raw counts. Never log tokens, cookies, passwords.

App log: `auth.session_classified` (classification, code, status, path only).

---

## 22. Final release verdict

**YELLOW**

GREEN blocked until isolated GoTrue + Chrome matrix (normal, restart, multi-tab, Domain cookies, live refresh) pass.

---

## Acceptance checklist

- [x] Current auth code reviewed
- [x] Remaining concurrency assessed
- [x] Confirmed remaining defects fixed (proxy JWT skip, cookie expire-once, 5xx onboarding)
- [x] Cookie strategy verified (unit)
- [ ] Legacy cookie migration live-tested
- [x] Automatic logout behavior (unit)
- [x] Dashboard recovery (unit)
- [x] API coverage verified (code)
- [x] Tenant isolation (unit)
- [x] Super Admin (code)
- [ ] Chrome normal / isolated context / multi-tab / restart
- [ ] Token expiration live
- [x] Relevant automated tests passed (39 auth)
- [ ] Isolated typecheck/build recorded in §16
- [x] Rollback / monitoring documented
- [x] No production changes
