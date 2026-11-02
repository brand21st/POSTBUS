# POSTBUS — PHASE 2 AUTHENTICATION & SESSION STABILITY FIX

**Date:** 2026-10-14  
**Branch:** `fix/auth-session-stability`  
**Base commit SHA:** `f60a94ab5cd38d7c3c19d30552ccffce306e0561`  
**Working tree:** implementation is **uncommitted** on this branch (parent SHA above). Unrelated dirty files from `india-post-true-bulk-candidate` were not reset.  
**Production:** not deployed. Hosted Supabase Auth settings were not changed.

**Final verdict:** **YELLOW** — code and unit tests are in place; Chrome/Incognito/multi-tab/staging GoTrue verification was **not executed**.

---

# 1. Executive Summary

PostBus was sending merchants to `/login` when Supabase `getUser()` returned no user, including during refresh races (`refresh_token_already_used`) and rate limits. Cookies were also inconsistent: email callback used `Domain=.postbus.in` while other clients used host-only cookies.

This change:

1. Classifies Auth errors so **transient** failures return **503 `AUTH_UNAVAILABLE`** and **do not redirect** to login.
2. Redirects to login only for **confirmed missing/invalid** sessions (`AUTH_REQUIRED` / missing cookies / `refresh_token_not_found`).
3. Uses **host-only** cookies on `www.postbus.in` everywhere, and **expires leftover `.postbus.in` auth chunks** without overwriting the host-only session cookie.
4. **Skips proxy `getUser()`** on `/api/*` and public pages; keeps it on dashboard/admin/onboarding/auth HTML so SSR can still refresh cookies.
5. Does **not** call `signOut()` on those failures.

JWT lifetime, refresh rotation, and reuse interval were **not** changed.

---

# 2. Root Cause

Confirmed during implementation (same as Phase 1):

| Finding | Status |
|---|---|
| `getUser()` error ignored → treated as logged out | **Confirmed** in `lib/supabase/proxy.ts`, `request-auth.ts` |
| Dashboard 401 → `/login` | **Confirmed** in `components/dashboard/shell.tsx` |
| Profile DB error mapped to `AUTH_REQUIRED` | **Confirmed** in `lib/api/context.ts` |
| Callback-only `Domain=.postbus.in` | **Confirmed** in `app/auth/callback/route.ts` |
| Proxy + API both called `getUser()` | **Confirmed**; API path now skips proxy `getUser()` |
| Concurrent `/token` races in production logs | **Not re-measured** this phase (historical Phase 1 evidence) |

---

# 3. Files Modified

**Source**

- `lib/supabase/auth-cookies.ts` (new)
- `lib/supabase/client.ts`
- `lib/supabase/server.ts`
- `lib/supabase/proxy.ts`
- `lib/supabase/request-auth.ts`
- `lib/auth/session/classify.ts` (new)
- `lib/api/errors.ts`
- `lib/api/context.ts`
- `lib/api/v1/session.ts`
- `lib/api/admin-context.ts`
- `lib/hooks/use-api.ts`
- `lib/hooks/use-me.ts`
- `lib/dashboard/shell-gate.ts`
- `components/dashboard/shell.tsx`
- `components/admin/shell.tsx`
- `app/auth/callback/route.ts`

**Tests**

- `lib/auth/session/classify.test.ts` (new)
- `lib/supabase/auth-cookies.test.ts` (new)
- `lib/supabase/proxy.session.test.ts` (new)
- `lib/hooks/use-api.auth.test.ts` (new)
- `lib/api/context.test.ts`
- `lib/dashboard/shell-gate.test.ts`
- `app/auth/callback/route.test.ts`

**Docs**

- `POSTBUS_AUTH_SESSION_PHASE2_FIX_REPORT.md` (this file)

---

# 4. Token Refresh Fix

**Before:** Every matched request (including `/api/v1/*`) ran proxy `getUser()`. Route handlers ran `getUser()` again. Browser auto-refresh also ran. Expired JWTs caused parallel `POST /token` and `refresh_token_already_used`.

**After:**

- Proxy `getUser()` only on `/dashboard`, `/admin`, `/onboarding`, `/login`, `/register`, `/forgot-password`, `/reset-password`.
- `/api/*` and marketing/public HTML skip proxy `getUser()`. APIs still verify with `getUser()` once per request via `getRequestAuthUser` (React `cache`).
- Browser client remains `@supabase/ssr` **singleton**.
- No custom mutex / BroadcastChannel.
- `refresh_token_already_used` classified as **AUTH_TRANSIENT_FAILURE** (not logout).
- Authorization still uses `getUser()`, never `getSession()`.

Hosted reuse interval was **not** increased (requires separate production Auth approval).

---

# 5. Cookie Fix

**Before:** Callback set `Domain=.postbus.in`. Browser/proxy/server used default host-only cookies. Mixed chunks could decode as absent.

**After:** Shared `supabaseAuthCookieOptions()` — Path `/`, SameSite Lax, Secure on HTTPS, **no Domain** (host-only `www.postbus.in`; apex still 308s to www).

**Migration:** `appendLegacyDomainExpiryHeaders` / browser `document.cookie` expire `sb-*-auth-token` chunks at `Domain=.postbus.in` as **extra** `Set-Cookie` headers so Next’s name-keyed cookie jar does not overwrite the host-only session cookie.

**Risk:** Some merchants with mixed cookies may need **one re-login**. Code rollback does not restore already-expired Domain cookies; rollback should **keep** Domain expiry headers if Domain cookies were ever issued.

HttpOnly was not changed.

---

# 6. Automatic Logout Fix

**Before:** Null `user` or HTTP 401 on `/me` → login. `signOut` was not called, but the UX was logout.

**After:** `classifyAuthSession()`:

| Class | Redirect to login? |
|---|---|
| AUTH_VALID | No |
| AUTH_SESSION_MISSING / AUTH_SESSION_INVALID | Yes |
| AUTH_RATE_LIMITED / AUTH_TRANSIENT_FAILURE | No |

Explicit logout remains topbar / admin account menu `signOut()`.

Dashboard banner: “Connection issue. Retrying your session without signing you out…”

---

# 7. Proxy Fix

`updateSession`:

- Skip GoTrue on API and public routes.
- On HTML auth gates: `getUser()`, classify, copy `Set-Cookie` onto redirects.
- Login redirect only for missing/invalid session.
- Transient: continue request, cookies preserved, no signed-in data from proxy.
- Platform admin → `/admin` only when `AUTH_VALID`.
- Always append Domain-cookie expiry on those HTML responses.

---

# 8. Dashboard Fix

- Redirect only if `isConfirmedSessionLoss` (401 + `AUTH_REQUIRED`) and not loading/transient (`shouldRedirectToLoginFromMe`).
- `useMe` retries 503/429 twice; does not retry confirmed 401 `AUTH_REQUIRED`.
- Admin shell matches.
- No new `onAuthStateChange` listeners.

---

# 9. API Fix

- `getRequestAuthUser` returns `{ user, error, classification, hasAuthCookie }`.
- Transient → `AUTH_UNAVAILABLE` **503**.
- Confirmed unsigned → `AUTH_REQUIRED` **401**.
- Profile query error → `PROFILE_UNAVAILABLE` **503**, not 401.
- Tenant/RBAC still 403 `TENANT_ACCESS_DENIED` / `FORBIDDEN`.
- Super Admin uses the same classifier (`requirePlatformAdmin`).
- No tokens in `logInfo("auth.session_classified")` (code, status, path, classification only).

---

# 10. Multi-Tab Behavior

**Expected:** SDK cookie + rotation; losing refresh classified as transient so one tab’s `already_used` does not force login. Winning refresh still Set-Cookies. Explicit `signOut` still revokes.

**Verified:** unit tests for classification and proxy non-redirect. **Browser multi-tab: Not Executed.**

---

# 11. Security Verification

- Server `getUser()` still required for tenant APIs and admin.
- Unverified requests do not receive protected payloads (503/401).
- Org access still membership-checked.
- No global user cache (still per-request `cache()`).
- Session revocation (`refresh_token_not_found`) still login-redirects.
- Tenant isolation tests in `lib/api/context.test.ts` still pass (wrong org → 403).

---

# 12. Automated Test Results

```
npx vitest run lib/auth/session/classify.test.ts lib/supabase/auth-cookies.test.ts lib/supabase/proxy.session.test.ts lib/dashboard/shell-gate.test.ts lib/api/context.test.ts lib/hooks/use-api.auth.test.ts app/auth/callback/route.test.ts proxy.test.ts
→ 8 files, 33 tests passed

npm test
→ Test Files  285 passed | 1 skipped
→ Tests       1763 passed | 5 skipped

npx eslint <auth files>
→ 1 error in components/dashboard/shell.tsx:66 setHydrated (pre-existing; not introduced by this fix)

npm run typecheck / npm run build
→ Turbopack compile succeeded
→ tsc failed on pre-existing files (not this change):
   components/dashboard/product-ai-copy.tsx
   lib/dashboard/india-post-routing.ts
   modules/india-post/bulk-booking.ts
   modules/ndr-rto/service.ts
```

---

# 13. Browser Test Results

| Test | Result |
|---|---|
| Chrome normal / Incognito / Edge / Firefox | **Not Executed** (`next dev` was not running) |
| Page refresh / restart / sleep | **Not Executed** |
| Multiple tabs / token expiry | **Not Executed** |
| Legacy Domain vs host-only cookies | **Not Executed** (covered by unit tests only) |

---

# 14. Staging Verification

`.env.staging` exists (`STAGING_NAME=postbus-staging-local`) and is CEPT/DB local staging, **not** a separate hosted GoTrue project. No isolated staging URL was used.

**Staging:** **Not Available / Not Executed** for this auth fix.

---

# 15. Remaining Risks

1. Concurrent `/token` can still happen across tabs + HTML proxy + browser auto-refresh until hosted **reuse interval** is raised (not done).
2. Mixed Domain/host-only cookies may require **one re-login**.
3. Transient 503 can leave dashboard up without `/me` until retry succeeds.
4. Production `/token` ratios not re-measured.
5. `next build` TypeScript still fails on **unrelated** dirty-tree files.
6. Cookie expire headers fire on dashboard HTML even when no legacy Domain cookies exist (harmless).

---

# 16. Production Deployment Plan

**Do not deploy from this report automatically.**

A. Merge **only** the files in §3 (this branch also sits on a dirty bulk/India Post tree).  
B. Record deploy SHA **after** a dedicated commit of those files. Current HEAD without that commit: `f60a94ab5cd38d7c3c19d30552ccffce306e0561`.  
C. Quality: `npm test` (passed). Fix or isolate pre-existing tsc errors before production build pipeline.  
D. Staging: run Chrome matrix on a **non-production** Supabase project.  
E. Cookie impact: host-only www + expire `.postbus.in` auth chunks. Some users one re-login.  
F. Sessions: do **not** globally invalidate.  
G. Rollback: revert the app commit. **Keep Domain expiry** on rollback if Domain cookies were ever set, or mixed chunks return. Do not mass-logout.  
H. Monitor GoTrue 24h: `/token` 200 vs 400 vs `refresh_token_already_used` vs 429 vs `/logout`, **normalized by `/user` volume**. Never log JWTs/cookies.  
I. Expected: fewer login redirects during refresh races; true logout still works.  
J. Limitation: no hosted reuse-interval change.  
K. Approvals: production release + optional Auth reuse-interval change (separate).  
L. Artifact must match the tested commit SHA.

---

# 17. Final Verdict

**YELLOW**

Implementation of the planned cookie, classifier, proxy, dashboard, and API changes is complete and covered by unit tests. Required Chrome/staging validation has **not** been performed, so GREEN is not allowed.

---

# Acceptance checklist

- [x] Concurrent refresh reduced (proxy skip on API/public)
- [x] Cookie configuration consistent (host-only)
- [x] Legacy Domain transition evaluated (expire headers)
- [x] Temporary failures do not force login (code + unit tests)
- [x] Confirmed invalid session still requires login
- [x] `signOut` unchanged for explicit logout
- [x] Dashboard init does not redirect on transient
- [x] Protected APIs still `getUser()` + RBAC
- [ ] Multi-tab verified in a browser
- [ ] Browser refresh / restart verified
- [ ] Chrome normal / Incognito verified
- [x] Cross-tenant denial unit-tested
- [x] Auth unit tests + full `npm test` passed
- [ ] Clean production `tsc`/`next build` (pre-existing failures elsewhere)
- [ ] Staging GoTrue verification
- [x] Rollback documented
- [x] No production changes made
