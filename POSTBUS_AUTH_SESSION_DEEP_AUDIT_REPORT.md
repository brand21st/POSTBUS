# POSTBUS — PRODUCTION AUTHENTICATION & SESSION PERSISTENCE
# DEEP ROOT-CAUSE AUDIT (PHASE 1, READ-ONLY)

**Date:** 2026-10-14  
**Auditor role:** principal / auth architecture / browser security / reliability  
**Production site:** https://www.postbus.in  
**Scope:** repository inspection (main app tree, not `.worktrees`), read-only production HTTP headers, read-only Supabase Auth logs (last ~24 hours)  
**Code changes:** none  
**Database writes:** none  
**Auth config / secrets / cookies / sessions:** not modified  
**Deployments:** none  

**Final verdict:** **RED** — confirmed session-breaking refresh-token races in production, plus code that treats a missing `getUser()` result as a hard logout.

---

# 1. Executive Summary

PostBus keeps the merchant signed in with **Supabase Auth cookies**, not LocalStorage. Every dashboard or admin navigation asks Supabase “who is this user?” If that check fails, the app **sends the merchant to `/login`**. That looks like an automatic logout even when nobody clicked Sign out.

Production Auth logs for the last day show this is not rare:

| GoTrue path | Outcome (approx. 24h) | Meaning |
|---|---|---|
| `GET /user` | ~74,657 × HTTP 200 | Access-token validation is extremely frequent |
| `POST /token` | **91 × 200** vs **591 × 400** | Refresh succeeds far less often than it fails |
| `POST /token` 400 | **566 × `refresh_token_already_used`** | Concurrent refresh / rotation collision |
| `POST /token` | **74 × 429** | GoTrue rate-limited refresh |
| `POST /token` 400 | **20 × `refresh_token_not_found`** | Refresh token gone or never stored |
| `POST /logout` | **7 × 204** | Explicit sign-out is rare |

So: users are **not** being signed out by the Sign out button. Sessions die when **several refresh attempts run at once** (multiple tabs, proxy + API + browser, or a refresh storm after the 1-hour access token expires). Supabase then treats reused refresh tokens as possible abuse. After that, `getUser()` sees no user, and PostBus redirects to login.

Incognito looking “better” is a **clue**, not a fix: a private window usually has **one tab, no leftover cookies, and no Chrome extensions**. That reduces concurrent refresh and cookie-chunk conflicts. It does not prove cookies or LocalStorage are the only cause.

This is **frontend and backend together**: browser cookie clients plus Next.js proxy/`getUser()` plus hosted GoTrue token rotation.

---

# 2. Current Authentication Architecture

## Stack (verified)

| Layer | Actual implementation |
|---|---|
| Frontend / backend | Next.js App Router (standalone), React client dashboard |
| Auth provider | **Supabase Auth (GoTrue)** via `@supabase/ssr` `^0.12.7` and `@supabase/supabase-js` `^2.116.0` |
| Session store | **Cookies** (`createBrowserClient` always manages session via cookies; LocalStorage is not the session store) |
| Edge/session gate | `proxy.ts` → `updateSession()` in `lib/supabase/proxy.ts` (Next.js 16 proxy, not a `middleware.ts` file) |
| API auth | Cookie session → `createServerSupabase()` → `getUser()` |
| Tenant | `profiles.active_organization_id` + `organization_members` |
| Super Admin | `platform_admins` and/or `PLATFORM_ADMIN_EMAIL` |

## Architecture map (actual)

```
LOGIN (email/password or WhatsApp OTP)
  ↓
AUTH PROVIDER (Supabase GoTrue)
  ↓
SESSION CREATION
  - Password: browser createBrowserClient().auth.signInWithPassword
  - OTP: server mintMagicLinkSession → verifyOtp (sets cookies on the response)
  - Email links: GET /auth/callback exchangeCodeForSession / verifyOtp
  ↓
TOKEN STORAGE
  - Chunked cookies (base64url), default maxAge 400 days, SameSite=Lax, httpOnly=false
  - Callback on postbus.in ALSO sets Domain=.postbus.in (other clients do not)
  ↓
AUTH STATE RESTORATION
  - Server: cookies → createServerClient → getUser()
  - Browser: singleton createBrowserClient, persistSession=true, autoRefreshToken=true
  - No application onAuthStateChange listener
  ↓
TOKEN REFRESH
  - Access JWT ~3600s (local supabase/config.toml; hosted project follows dashboard JWT expiry)
  - Refresh token rotation ON, reuse interval 10s (local config)
  - Refresh from: browser autoRefresh, AND every server getUser() when JWT is expired
  ↓
PROTECTED ROUTES
  - proxy: no user → redirect /login?next=…
  - DashboardShell: GET /api/v1/me 401 → router.replace(/login)
  - AdminShell: GET /api/admin/overview 401 → /login
  ↓
API REQUESTS
  - fetch(..., credentials: "same-origin") — no Axios, no global 401 interceptor
  - requireTenant() for tenant APIs
  ↓
SESSION EXPIRATION / LOGOUT
  - Intentional: topbar / admin signOut()
  - Automatic: getUser() null or /me 401
```

## Exact files

| Concern | File | Notes |
|---|---|---|
| Browser client | `lib/supabase/client.ts` 4–10 | `createBrowserClient(url, anonKey)` only. **No `cookieOptions`.** |
| Server client | `lib/supabase/server.ts` 6–32 | Cookie `getAll`/`setAll`; `setAll` swallows errors in Server Components |
| Proxy / “middleware” | `proxy.ts` 24–50, `lib/supabase/proxy.ts` 17–75 | `getUser()` then redirect |
| Request user cache | `lib/supabase/request-auth.ts` 4–10 | Per-request React `cache` |
| Tenant context | `lib/api/context.ts` 17–81 | `!user` and **profile query errors** → `AUTH_REQUIRED` (401) |
| `/api/v1/me` | `lib/api/v1/session.ts` 18–58 | `!user` → 401; then `ensureActiveWorkspace` |
| Login | `app/(auth)/login/login-form.tsx` 52–105 | Password sign-in; saved **email only** in LocalStorage |
| Email callback | `app/auth/callback/route.ts` 50–80 | Sets cookies; **Domain `.postbus.in` on production** |
| OTP mint | `lib/auth/session/mint.ts` 5–24 | Magic-link hash + `verifyOtp` |
| Dashboard 401 UX | `components/dashboard/shell.tsx` 75–84 | Redirect to login |
| Admin 401 UX | `components/admin/shell.tsx` 21–24 | Redirect to login |
| Explicit logout | `components/dashboard/topbar.tsx` 110–118, `components/admin/account-menu.tsx` 25–33 | `signOut()` then navigate |
| Fetch wrapper | `lib/hooks/use-api.ts` 24–65 | No sign-out on error |
| React Query | `components/providers.tsx` 8–20 | `retry: 1`, `refetchOnWindowFocus: false` (default) |
| Admin gate in proxy | `lib/admin/access.ts` | Platform admins hitting `/dashboard` are redirected to `/admin` |

There is **no** `onAuthStateChange` in application code. Logout UX is **redirect-based**, not an auth-context “logged out” event.

---

# 3. Complete Session Lifecycle

## Login

1. **Email/password:** `createClient()` → `signInWithPassword` (`login-form.tsx` 91–95). Cookies written by `@supabase/ssr` via `document.cookie`. Then `getUser()`, optional admin probe, `router.replace` + `router.refresh`.
2. **WhatsApp OTP:** `/api/auth/otp/request` then `/api/auth/otp/verify`. Server mints a session with `verifyOtp` so cookies land on the HTTP response.
3. **Email confirmation / recovery:** `/auth/callback` exchanges `code` or `token_hash`.

“Save password” only stores **email** in `localStorage` key `postbus.login.saved-email`. It does **not** store the session.

## Persistence

Default cookie options from `@supabase/ssr` (`node_modules/@supabase/ssr/dist/module/utils/constants.js`):

- `path: "/"`
- `sameSite: "lax"`
- `httpOnly: false`
- `maxAge: 400 days`
- **no `Domain`** unless the app sets `cookieOptions.domain`

Browser client uses a **module singleton** (`createBrowserClient.js` 7–14, 56–58) in the browser, so many `createClient()` calls share one GoTrue client **in that tab**. Each **server** request creates a **new** `createServerClient`.

## Refresh

- Access token lifetime: **3600 seconds** in `supabase/config.toml` 164–165 (`jwt_expiry`). Hosted JWT expiry is configured in the Supabase project dashboard (not changed in this audit).
- Rotation: `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10` (`config.toml` 171–174).
- Browser: `autoRefreshToken` defaults to true in the browser.
- Server: `getUser()` validates with GoTrue (`GET /user`). If the access JWT is expired, the SDK refreshes (`POST /token`) then fetches the user.

`getUser()` **error is ignored** everywhere it is used in the gate:

```44:59:lib/supabase/proxy.ts
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // ...
  if (!user && (isDashboard || isAdmin || isOnboarding) && !isTrackingHost) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
```

Network failure, rate limit, malformed cookies, and true expiry all look the same: **`user === null` → login**.

## Logout

1. **Explicit:** `supabase.auth.signOut()` then `/login`.
2. **Effective (automatic):** proxy 307 to `/login?next=…` or client `router.replace('/login?next=…')`.
3. **India Post “Logout”** on the integration page is **CEPT session**, not PostBus Auth (`app/dashboard/integrations/india-post/page.tsx`).

Production: **7** GoTrue `/logout` vs **hundreds** of failed `/token` calls. Automatic “logout” is overwhelmingly **refresh failure + redirect**, not `signOut()`.

---

# 4. All Logout Triggers

| ID | File / function | Trigger | Intentional? | Automatic? | Transient failure can fire it? | Other tabs | Permanently clears auth? |
|---|---|---|---|---|---|---|---|
| L1 | `topbar.tsx` `signOut` 110–118 | User clicks Sign out | Yes | No | No | Yes, if `signOut` revokes refresh token | Yes (best-effort) |
| L2 | `account-menu.tsx` `logOut` 25–33 | Admin Sign out | Yes | No | No | Yes | Yes |
| L3 | `lib/supabase/proxy.ts` 55–59 | `getUser()` returned no user on `/dashboard`, `/admin`, `/onboarding` | Gate, but **over-broad** | **Yes** | **Yes** (error ignored) | Redirect in that tab; cookies may still exist | Redirect only; cookies not always cleared |
| L4 | `shell.tsx` 75–84 | `useMe()` `/api/v1/me` status **401** | Treated as logout | **Yes** | **Yes** | That tab | Redirect; cookies may remain |
| L5 | `admin/shell.tsx` 21–24 | `/api/admin/overview` 401 | Treated as logout | **Yes** | **Yes** | That tab | Redirect |
| L6 | `lib/api/v1/session.ts` 21 | `GET me` when `!user` | API 401 | Indirect | **Yes** | Via L4 | No |
| L7 | `lib/api/context.ts` 20–32 | `!user` **or profile query error** → `AUTH_REQUIRED` 401 | Wrong for profile DB errors | Indirect | **Yes** (DB blip → 401) | Only if `/me` used this path (`/me` does **not**; other APIs do) | No |
| L8 | `app/auth/callback/route.ts` 38–47, 76–77 | Bad/missing OAuth/OTP params | Failed login, not mid-session | On callback | N/A | No | No |
| L9 | `proxy.ts` 62–72 | Platform admin on `/dashboard` | Redirect to `/admin`, **not** login | Yes | Admin lookup failure → stays on dashboard | No | No |
| L10 | India Post logout mutation | CEPT cookies on connection row | Intentional for India Post | User click | N/A | No | PostBus session unchanged |

**Not found:** `localStorage.clear`, session `removeSession` helpers, Axios interceptors calling `signOut`, `onAuthStateChange` → `SIGNED_OUT` handlers, service workers.

**Pattern of concern (confirmed in code):** temporary failures are classified as **permanent unauthenticated**.

`use-api.ts` does **not** call `signOut` on 401/403/500. Ordinary API 500/429/timeout do **not** globally log the user out. **`/me` 401 and proxy `!user` do.**

---

# 5. Normal vs Incognito Investigation

| Hypothesis | Evidence class | Assessment |
|---|---|---|
| **A/B/C. Stale or mixed cookies** | LIKELY | Callback sets `Domain=.postbus.in`; browser + proxy clients do not. `@supabase/ssr` itself documents host-only vs Domain mix: parsers may combine **chunks from different generations** and treat the session as absent (`cookies.js` 35–37, 277–280). Incognito has no leftover host-only or Domain cookies. |
| **D. Multiple storage keys** | POSSIBLE | Chunked `sb-<ref>-auth-token` / `.0` / `.1`. Corrupted mix → decode as absent. |
| **E. Auth migration** | LIKELY | Same Domain vs host-only split. |
| **F. Browser extensions** | LIKELY, UNVERIFIED in a browser | Extensions are **off by default in Incognito**. Privacy/adblock can block `*.supabase.co` or cookie writes. CSP **allows** `https://hgacoeoovjxkzfbesmvl.supabase.co` — the app is not blocking GoTrue. |
| **G. Service workers** | CONFIRMED absent | No SW registration in repo. |
| **H/I/Q. Cached JS / deploy skew** | POSSIBLE | Login HTML: `Cache-Control: s-maxage=31536000`, `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`. Cloudflare `cf-cache-status: DYNAMIC`. Dashboard unauthenticated: **307** to `/login?next=/dashboard` (not a cached 200). Not proven as the logout bug. |
| **J/K/L/M. Cookie Domain / SameSite / Secure / expiry** | LIKELY for Domain; SameSite Lax + Secure on HTTPS are appropriate | Apex `postbus.in` **308** to `www.postbus.in` (good). Callback Domain `.postbus.in` vs host-only `www` is **inconsistent**. Cookie maxAge 400d is not short-expiry logout. |
| **N. Storage restrictions** | UNVERIFIED | |
| **O/R/S/T. Multi-tab / BroadcastChannel / duplicate listeners** | LIKELY | No app BroadcastChannel. GoTrue + **many server `getUser()`** per page = concurrent `/token`. No extra `onAuthStateChange` listeners in app code. Browser client is a singleton **per tab**, not across tabs. |
| **P. Stale app state** | POSSIBLE | React Query `["me"]` 401 triggers redirect even if cookies still exist. |
| **U/V. Chrome profile / privacy** | POSSIBLE | Fits Incognito clue; not reproduced here. |

**Do not tell merchants to “use Incognito” or “clear cookies” as the fix.** Those only remove the colliding state; they do not fix concurrent refresh or Domain mismatch.

---

# 6. Token Refresh Findings

## Scenarios

| Scenario | Current implementation | Expected | Failure path | Unexpected logout? |
|---|---|---|---|---|
| **A. Access token expires while using dashboard** | `getUser()` / autoRefresh → `POST /token` | Silent refresh | Concurrent `/token` → `refresh_token_already_used` | **Yes — CONFIRMED in prod logs** |
| **B. Refresh fails temporarily** | `user` null, no retry classification | Retry, keep cookies | Proxy/shell → `/login` | **Yes — CONFIRMED in code** |
| **C. Two tabs refresh at once** | Independent clients; rotation + 10s reuse | One wins, reuse window covers the other | 566 `refresh_token_already_used` in 24h | **Yes — LIKELY primary** |
| **D. API HTTP 401** | `/me` 401 → login; other APIs toast/error | Only true auth loss | Profile DB error on tenant APIs is 401 (`context.ts` 30–32) but does **not** drive `/me` | Partial: **`/me` 401 yes**; generic 401 no global interceptor |
| **E. Network drop during refresh** | `getUser` error ignored | Stay signed in, retry | Treated as logged out | **Yes — CONFIRMED in code**, not reproduced live |
| **F. Dashboard open for hours** | JWT 1h + auto refresh | Stay in | Refresh storms in business hours (see hourly table) | **Yes — LIKELY** |
| **G. Tab inactive 30m–2h** | Browser may pause timers; resume then refresh | Refresh on resume | Burst of `/token` | **LIKELY** |
| **H. Sleep/wake** | Same as G plus clock | Refresh | Same | **LIKELY**, UNVERIFIED |
| **I. Clock skew** | JWT `exp` | Small skew OK | Large skew → expired JWT → refresh | POSSIBLE |
| **J. Rotation vs stale cookies** | Chunked cookies + Domain mix | One cookie generation | Invalid JSON chunks → session absent (`cookies.js`) | **LIKELY** |

## Production `/token` breakdown (~24h, Auth logs)

- `refresh_token_already_used` **566** (HTTP 400) — includes GoTrue “Possible abuse attempt” wording (rotation reuse detector).
- Success **91** (HTTP 200).
- `over_request_rate_limit` **74**.
- `refresh_token_not_found` **20**.
- `invalid_credentials` **4** (login, not mid-session).

**Hourly bursts (UTC):** 2026-10-13 09:00 — 217×400 / 66×429 / 6×200; 11:00 — 179×400 / 10×200; 2026-10-14 05:00 — 140×400 / 7×429 / 12×200. Those windows align with **many concurrent `GET /user` (~4k–5k/hour)** amplifying refresh.

**Refresh is not functioning correctly under load.** Isolated single-tab refresh can still work (91 successes). Concurrent refresh is broken relative to rotation settings.

**Do not “fix” this by making JWTs never expire.**

---

# 7. Browser Storage Findings

- Session: **cookies**, not LocalStorage (except saved login email and unrelated UI keys).
- Default cookies are **not HttpOnly** (SSR library default). XSS could read them; that is a **security** finding (P3/P2), not the reported logout.
- Callback (`app/auth/callback/route.ts` 58–64) sets `secure` on HTTPS and **`domain: ".postbus.in"`**. `createBrowserClient` / `updateSession` **never** pass `cookieOptions.domain`.
- `@supabase/ssr` chunk decoder **drops** the session if chunks are mixed (warns in console; app does not surface this).
- Apex → www 308 keeps the canonical host as `www.postbus.in`. Host-only cookies on `www` are enough **if all writers agree**.
- Production login is prerendered/cached at Next (`s-maxage=31536000`). Unauthenticated `/dashboard` is **not** served as a cached authenticated page (307).

---

# 8. Route Guard Findings

Sequence **is possible** in this codebase:

```
User authenticated
  → Dashboard HTML served (proxy getUser succeeded earlier)
  → Access JWT expires / refresh races
  → GET /api/v1/me → getUser() null → 401
  → DashboardShell useEffect (shell.tsx 75–84)
  → router.replace(/login?next=…)
```

Or on the **next full navigation**:

```
proxy getUser() null → 307 Location: /login?next=/dashboard
```

Observed unauthenticated production: `/dashboard` → **307** `/login?next=%2Fdashboard` (2026-10-14).

There is **no loading wait** in the proxy: null user is immediate redirect. Client shell **does** wait for `me.isLoading`, then treats 401 as logout. `shouldMountDashboardChildren` unmounts children on 401 (`lib/dashboard/shell-gate.ts`).

Platform admin on `/dashboard` is redirected to `/admin` (not login). Merchants are not affected by that branch unless they are in `platform_admins`.

---

# 9. API Error Handling Findings

- No Axios. `api()` in `use-api.ts` throws `ApiError` with HTTP status. **No global signOut.**
- React Query default `retry: 1` (retries a 401 once — can hide a single blip, not a dead refresh token).
- `useMe` has **no** custom `retry` / `retryOnMount` / status filter (`lib/hooks/use-me.ts` 7–11).
- **500 / timeout / 429** on orders, labels, etc. do **not** redirect to login.
- **`AUTH_REQUIRED` is HTTP 401** (`lib/api/errors.ts` 18–19).
- **`TENANT_ACCESS_DENIED` is 403** — AdminShell shows “Not found” for 403, does not login-redirect. Dashboard shell does **not** treat 403 as logout.
- **Misclassification (CONFIRMED code):** `lib/api/context.ts` 30–32 maps **profile load failure** to `AUTH_REQUIRED` (401). That is a **server/DB failure**, not session expiry. It does not currently drive `/me` (session route uses a separate profile select without that throw), but it **can** 401 other dashboard APIs during a database incident.
- Rate limit: in-process memory, 60 req/min per IP+path (`lib/security/rate-limit.ts`). Returns 429, not 401. Multi-instance Coolify does not share this bucket (reliability issue, not logout).

---

# 10. Multi-Tab Findings

- No application-level tab sync (no `storage` event handler, no BroadcastChannel).
- Each tab has its own browser singleton **and** every tab’s navigations hit **server `getUser()`** (proxy + RSC + `/api/v1/*`).
- Refresh token **rotation** + **10s reuse** + concurrent `/token` is the classic multi-tab logout: tab B’s refresh invalidates tab A’s token; GoTrue logs `refresh_token_already_used` / “Possible abuse attempt”.
- Explicit `signOut` **should** still revoke the session for all tabs (GoTrue logout). That path is rare (7/day).
- Closing one tab does not sign out others unless the refresh token was already destroyed by a race.

---

# 11. Reproduction Results

Browser matrix was **not** executed against a merchant session (Phase 1: no production session mutation, no forced logout, no cookie changes).

| Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| 01–05 Chrome/Edge/Firefox/Safari session hold | Stay signed in | Not run | **Not Executed** | — |
| 06 Refresh while authenticated | Stay signed in | Not run | **Not Executed** | — |
| 07 Multiple tabs | Stay signed in | Not run in browser | **Not Executed** (logs support failure) | Auth `/token` races |
| 08 Access token expiry | Silent refresh | Not run | **Not Executed** | JWT 3600s in config |
| 09 Refresh rotation | Reuse window covers peers | Logs: 566 already_used vs 91 ok | **Fail (production logs)** | Auth logs 24h |
| 10 Temp network drop | Stay signed in | Not run | **Not Executed** | Code treats null user as logout |
| 11 API 401 `/me` | Only if session truly dead | Code redirects always | **Fail (code)** | `shell.tsx` 75–84 |
| 12 API 500 | Stay signed in | Code: no global logout | **Pass (code review)** | `use-api.ts` |
| 13–16 Idle / sleep / restart | Stay signed in if refresh token valid | Not run | **Not Executed** | — |
| 17 Old profile cookies | May fail | Not run | **Not Executed** | Domain mismatch in code |
| 18 Fresh profile | More stable | Matches Incognito anecdote | **UNVERIFIED** | — |
| 19 Deploy skew | Should not logout | Not run | **Not Executed** | Login ISR cache only |
| 20 Concurrent API | Should not logout | `/user` volume high | **Fail (logs, amplification)** | ~74k `/user`/day |
| 21 Explicit logout | Session gone | 7 GoTrue logouts | **Not Executed E2E** | Logs show path exists |
| 22 Invalid refresh | Must login | `refresh_token_not_found` × 20 | **Pass as security** / **Fail as UX if caused by races** | Logs |
| 23 Multi-org | Isolation held | Code: org from profile + membership | **Pass (code)** | `context.ts` |
| 24 Concurrent refresh across tabs | One refresh | 566 already_used | **Fail (production logs)** | Auth logs |
| Prod unauthenticated `/dashboard` | Redirect login | 307 `/login?next=/dashboard` | **Pass** | curl 2026-10-14 |
| Prod apex host | Canonical www | 308 `https://www.postbus.in/login` | **Pass** | curl 2026-10-14 |

---

# 12. Root Cause Analysis

## Most likely root cause (combined)

**P0/P1 — Concurrent refresh-token rotation under a high `getUser()` rate, then a hard login redirect when `user` is null.**

1. Every HTML and API request through `proxy.ts` calls `supabase.auth.getUser()` (`lib/supabase/proxy.ts` 44–46).
2. Dashboard usage adds **more** `getUser()` in RSC/API (`request-auth.ts`, `session.ts`, `admin-context.ts`).
3. Browser auto-refresh also calls `/token`.
4. Access tokens expire after ~1 hour. Many in-flight refreshes hit GoTrue together.
5. Hosted Auth returns **`refresh_token_already_used`** (and sometimes **429**).
6. Application code **does not distinguish** “refresh lost” from “GoTrue busy” from “no cookie”.
7. Proxy and `DashboardShell` send the merchant to **`/login`**.

**Cookie Domain mismatch** (`/auth/callback` vs all other clients) is a **second, independent** way to make the session cookie unreadable (especially in a long-lived Chrome profile). That fits Incognito vs normal **without** being the only cause.

## Findings

### AUTH-01 — Concurrent refresh destroys sessions  
**Severity:** P0  
**Title:** Production refresh fails far more often than it succeeds  
**Files:** `lib/supabase/proxy.ts`, `lib/supabase/server.ts`, `lib/supabase/client.ts`, hosted GoTrue rotation  
**Observed:** 591 `/token` 400 vs 91 200; 566 `refresh_token_already_used`; 74 `/token` 429  
**Expected:** Silent rotation within reuse window  
**Root cause:** Many `getUser()` + browser refresh + rotation with a 10s reuse window; GoTrue abuse detector  
**Evidence:** CONFIRMED (Auth logs + code)  
**Reproduction:** Production logs; browser E2E Not Executed  
**Confidence:** High  
**Impact:** Any active merchant near JWT expiry, worse with multiple tabs  
**Fix:** See §13 (serialize refresh, stop over-calling `getUser`, classify errors, optionally raise reuse interval **after** reducing concurrency)  
**Regression risk:** Medium if reuse interval is raised without reducing concurrent callers (masks races)

### AUTH-02 — Null `getUser()` treated as logout  
**Severity:** P1  
**Title:** Proxy and dashboard 401 redirect ignore `error`  
**Files:** `lib/supabase/proxy.ts` 44–59; `components/dashboard/shell.tsx` 75–84; `components/admin/shell.tsx` 21–24; `lib/api/v1/session.ts` 18–21  
**Observed:** Login redirect without `signOut`  
**Expected:** Retry refreshable errors; redirect only on invalid/revoked refresh  
**Root cause:** Destructure `{ data: { user } }` only  
**Evidence:** CONFIRMED (code)  
**Reproduction:** Not Executed in browser  
**Confidence:** High  
**Impact:** Transient Auth/network issues look like logout  
**Fix:** Branch on `error` (invalid_token / refresh_token_not_found vs fetch failure / 429)  
**Regression risk:** Low if revoked sessions still redirect

### AUTH-03 — Cookie Domain set only on auth callback  
**Severity:** P1  
**Title:** `.postbus.in` Domain on callback only  
**Files:** `app/auth/callback/route.ts` 58–64 vs `lib/supabase/client.ts`, `lib/supabase/proxy.ts`, `lib/supabase/server.ts`  
**Observed:** Mixed host-only and Domain cookies; SSR warns on mixed chunks  
**Expected:** Identical `cookieOptions` on every client  
**Root cause:** Callback special-case for confirmation links  
**Evidence:** CONFIRMED (code); production cookie contents **not** inspected (would require a live session)  
**Reproduction:** UNVERIFIED in browser  
**Confidence:** Medium-high for Incognito vs profile  
**Impact:** Users who used email links **and** password login in the same Chrome profile  
**Fix:** One cookie policy: **prefer host-only `www.postbus.in`** (apex already 308s) **or** set `domain: ".postbus.in"` on **all** clients and clear both scopes on write (library already supports host-only clear when Domain is set)  
**Regression risk:** Medium (must invalidate or dual-clear old cookies)

### AUTH-04 — Profile errors mapped to 401  
**Severity:** P2  
**Title:** `requireTenant` uses `AUTH_REQUIRED` for profile query failure  
**Files:** `lib/api/context.ts` 30–32  
**Expected:** 500/503, not 401  
**Evidence:** CONFIRMED (code)  
**Impact:** Tenant APIs during DB errors; not the `/me` path today  
**Fix:** Use a non-auth error code  
**Regression risk:** Low

### AUTH-05 — `getUser()` amplification  
**Severity:** P2  
**Title:** Tens of thousands of `/user` calls per day  
**Files:** `proxy.ts` matcher includes almost all routes including `/api/*`  
**Evidence:** CONFIRMED (74k `/user` 200 in 24h)  
**Fix:** Do not call `getUser()` twice per request (proxy + handler) without need; skip refresh on static/public paths already partially excluded; consider JWT claims check when the access token is still valid  
**Regression risk:** Medium (must not skip verification on protected SSR)

### AUTH-06 — HttpOnly false  
**Severity:** P2 (security) / P3 (logout)  
**Title:** Session cookies readable by JS  
**Evidence:** CONFIRMED (SSR defaults)  
**Fix:** `cookies: { encode: "tokens-only" }` + server-set HttpOnly cookies (SSR option) in a later hardening phase  
**Regression risk:** Medium

### AUTH-07 — Extensions / Incognito  
**Severity:** P3  
**Title:** Anecdote fits extension + stale cookie profile  
**Evidence:** POSSIBLE / UNVERIFIED  
**Fix:** Do not rely on Incognito; fix AUTH-01–03 first

**Not confirmed:** service workers, global 500→logout, unlimited JWT, tenant leak on refresh, cached authenticated dashboard HTML.

**Tenant isolation:** Session is **user**-scoped. Org comes from `profiles.active_organization_id` and membership checks in `requireTenant`. Refresh does not switch users. Stale React Query could show **the same user’s** previous org until refetch — not another merchant. Super Admin remains server-gated (`requirePlatformAdmin`).

---

# 13. Recommended Fix

**Preserve Supabase Auth.** Do not replace the provider. Do not lengthen JWT to hide a broken refresh.

## Phase 2 (minimal, production-safe) — awaiting approval

1. **Shared cookie options** used by `createBrowserClient`, `createServerClient` (server + proxy), and `/auth/callback`.  
   - Recommended: **no Domain** (host-only `www.postbus.in`) because `proxy.ts` already 308s `postbus.in` → `www`.  
   - Remove the callback-only `domain: ".postbus.in"` **or** set the same Domain everywhere and rely on SSR host-only + Domain clears.  
   Files: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/proxy.ts`, `app/auth/callback/route.ts`.

2. **Classify `getUser()` errors** in `updateSession`, `getRequestAuthUser`, and `/me`.  
   - Redirect to login only for definitive session death (`session_not_found`, `refresh_token_not_found`, invalid refresh after retry).  
   - On 429 / network / 5xx: **do not** redirect; return last cookies; retry once.  
   Files: `lib/supabase/proxy.ts`, `lib/supabase/request-auth.ts`, `lib/api/v1/session.ts`.

3. **Dashboard/Admin shells:** redirect to login only when `/me` (or admin overview) returns 401 **and** error code is `AUTH_REQUIRED` from a verified missing user — not after a single fetch blip. Add a short retry. Do **not** call `signOut()` on those failures (that would make races worse).  
   Files: `components/dashboard/shell.tsx`, `components/admin/shell.tsx`, `lib/hooks/use-me.ts`.

4. **Cut concurrent refresh:**  
   - Avoid a second GoTrue round-trip on the same request when the proxy just refreshed (document limitation: proxy and route are separate `getUser()` today).  
   - Keep the browser singleton (already present).  
   - Do not add more `createBrowserClient` instances with `isSingleton: false`.

5. **Hosted GoTrue (dashboard, not app code) after (4):** consider raising refresh token **reuse interval** (e.g. 30–60s) so multi-tab retries succeed. **Do not** disable rotation. **Do not** do this in Phase 1.

6. **`requireTenant`:** profile failures → non-401 (`lib/api/context.ts`).

7. **Observability:** log Auth error **codes** (not tokens) when redirecting to login.

**Out of scope for first patch:** replacing cookies with LocalStorage; disabling expiry; HttpOnly migration (follow-up).

---

# 14. Production Risk Assessment

| Change | Merchant impact | Risk |
|---|---|---|
| Unify cookie Domain | Users with **both** host-only and `.postbus.in` cookies may need **one** re-login after deploy | Medium; mitigate with dual-scope cookie clear on write (SSR already does this when Domain is set) |
| Softer `getUser` errors | Fewer false logouts; revoked sessions must still redirect | Low–medium; test explicit logout and “refresh_token_not_found” |
| Fewer `/user` calls | Lower GoTrue load, fewer 429s | Low if JWT still verified when expired |
| Reuse interval increase | Helps tabs; slightly wider replay window (10s → 60s) | Low for this threat model; keep rotation |
| No JWT lifetime increase | Security unchanged | — |

Existing merchants keep the same identities, orgs, and RBAC. No client-side auth bypass.

---

# 15. Regression Test Plan

After Phase 2 (not run now):

1. Password login on `www.postbus.in`, refresh, navigate, 1h+ hold.  
2. Email confirmation / magic link (callback cookies).  
3. Two tabs, wait past JWT expiry, both stay signed in.  
4. Explicit Sign out — all tabs require login.  
5. Airplane mode 30s during dashboard — no login redirect; recover on reconnect.  
6. `/api/v1/orders` 500 mock — stay signed in.  
7. Super Admin cannot open another org’s tenant APIs.  
8. Merchant VIEWER still 403 on writes.  
9. Chrome normal + Incognito + Edge + Firefox.  
10. Watch GoTrue: `/token` 200 should **exceed** 400; `refresh_token_already_used` should collapse.

---

# 16. Rollback Plan

- Revert the cookie-options / `getUser` classification PR and redeploy standalone.  
- Do **not** rotate JWT secret unless compromise is suspected (would log **everyone** out).  
- If Domain cookies were written, rollback must keep **clearing both** host-only and `.postbus.in` or users can stick on mixed chunks.  
- Hosted reuse-interval change (if applied) revert in Supabase Auth settings independently of the app.

---

# 17. Final Verdict

**RED**

Confirmed: production Auth is rejecting the majority of refresh attempts (`refresh_token_already_used` / 429), while the app maps “no user from `getUser()`” to the sign-in page. Explicit logout is rare. This is a **session reliability** failure with a secure posture (sessions die rather than leak), not a successful bypass.

GREEN is inappropriate: the bug is evidenced in production logs and code even without a timed Chrome reproduction.

---

## Phase 1 close-out answers

1. **Most likely root cause:** Concurrent refresh-token rotation (many `getUser()` + multi-tab auto-refresh) invalidating the session, then proxy/shell redirect to `/login`. Cookie Domain mismatch is a strong second factor for normal Chrome vs Incognito.  
2. **Confirmed issues:** AUTH-01 (logs), AUTH-02/04/05/06 (code), AUTH-03 (code; live cookie mix not dumped).  
3. **Key lines:** `lib/supabase/proxy.ts` 44–59; `components/dashboard/shell.tsx` 75–84; `lib/api/v1/session.ts` 18–21; `lib/api/context.ts` 20–32; `app/auth/callback/route.ts` 58–64; `lib/supabase/client.ts` 4–10; `supabase/config.toml` 164–174.  
4. **Normal vs Incognito:** Incognito avoids stale mixed cookies and most extensions; it also tends to be a single tab — fewer `/token` races.  
5. **All users?** Anyone whose JWT refresh races; bursts during busy hours. Not proven for every account every day.  
6. **Frontend, backend, or both?** **Both** (Next proxy/clients + GoTrue).  
7. **Token refresh correct?** **No** under concurrency. Isolated refresh can succeed.  
8. **Automatic logout incorrect?** **Yes** when triggered by refresh 400/429/network rather than `signOut` or a truly revoked token.  
9. **Exact recommended fix:** Unified cookies + error classification + less `getUser()` fan-out; optional reuse-interval increase after that.  
10. **Regression risk:** **Medium** for cookie Domain unification; **low–medium** for error classification if revoked sessions still redirect.  
11. **Remaining evidence:** Timed Chrome DevTools on a **test** account (Network: `/token`, Application: `sb-` cookies Domain/host-only); confirm hosted JWT expiry and reuse interval in Supabase dashboard; Sentry/Coolify 307 `/login` rates (no token bodies).

PHASE 1 AUDIT COMPLETE.  
NO PRODUCTION CHANGES MADE.  
AWAITING APPROVAL FOR PHASE 2 IMPLEMENTATION.
