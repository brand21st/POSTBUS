# POSTBUS AUTH SESSION FINAL RELEASE GATE

**Date:** 2026-10-14  
**Phase:** 2.5 pre-production verification  
**Production:** https://www.postbus.in — **not deployed**  
**Hosted Supabase Auth / JWT / reuse interval / rotation:** **not changed**  
**Coolify:** **not used**  
**Production sessions / secrets:** **not invalidated or rotated**

---

## Executive summary

Authentication Phase 2 is **implemented and committed** on `fix/auth-session-stability` at SHA `42383c4c174fcc92b67e83c2a9e2eb0f9b9c7470` (this report is an additional documentation commit on the same branch). Isolated worktree quality gates show **TypeScript clean** and **`next build` successful** when `NEXT_PUBLIC_SUPABASE_*` is present. Full-repo `eslint` and `npm test` still fail for **pre-existing, non-auth** reasons. Chrome / Incognito / multi-tab / restart / live cookie migration were **not executed** (no isolated GoTrue; production browser testing is forbidden).

**Verdict: YELLOW** — implementation complete; mandatory browser and live token-refresh validation pending. GREEN is not allowed.

---

## 1. Git branch and commit SHA

| Item | Value |
|---|---|
| Branch | `fix/auth-session-stability` |
| Base commit | `f60a94ab5cd38d7c3c19d30552ccffce306e0561` |
| Auth implementation SHA | `42383c4c174fcc92b67e83c2a9e2eb0f9b9c7470` |
| Auth commit message | Keep merchant sessions through token refresh races instead of bouncing to login. |
| Isolation | git worktree `D:\POST BUS APP\.worktrees\auth-session-gate` at detached `42383c4` |
| Push | **not performed** |
| Production deploy | **not performed** |

`git diff --stat f60a94ab...42383c4`: 25 files, +1475 / −41.

### Source-control safety

- Unrelated dirty files (storefront, NDR/RTO, Shopify, inventory, India Post bulk, billing, etc.) remain **uncommitted**. They were **not reset**.
- Untracked files (`.cursor/`, `.worktrees/`, QA markdown, xlsx fixtures) were **not staged**.
- Only the Phase 2 authentication set was committed in `42383c4`. This report is staged separately after review.

---

## 2. Files changed (auth implementation)

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

- `lib/auth/session/classify.test.ts`
- `lib/supabase/auth-cookies.test.ts`
- `lib/supabase/proxy.session.test.ts`
- `lib/hooks/use-api.auth.test.ts`
- `lib/api/context.test.ts`
- `lib/dashboard/shell-gate.test.ts`
- `app/auth/callback/route.test.ts`

**Prior docs (in `42383c4`)**

- `POSTBUS_AUTH_SESSION_DEEP_AUDIT_REPORT.md`
- `POSTBUS_AUTH_SESSION_PHASE2_FIX_REPORT.md`

---

## 3. Clean build result

Environment: isolated worktree at `42383c4`, `npm ci` (junction to parent `node_modules` **rejected by Turbopack**; real install used).

| Command | Result | Evidence |
|---|---|---|
| `npm run typecheck` | **PASS** | `tsc --noEmit` exit 0 |
| `npm run lint` | **FAIL** | `✖ 66 problems (31 errors, 35 warnings)` |
| `npm test` | **FAIL** | `5 failed \| 1590 passed \| 1 skipped` (1596) |
| `npm run build` (no env) | **FAIL** | Prerender `/` throws `Supabase public credentials are not configured` at `lib/supabase/server.ts:9` via `components/landing/pricing-preview.tsx:7` — missing `.env.local`, not an auth regression |
| `npm run build` (`.env.local` copied, not committed) | **PASS** | Next.js 16.3.8 compiled, TypeScript finished, 91 static pages generated, Proxy present |

**Do not label the dirty main tree as a successful production build.** The isolated worktree **did** complete `next build` with credentials present.

### Lint failures (unrelated except one pre-existing hydrate)

Repo-wide ESLint is red on this SHA. Auth-touched file:

- `components/dashboard/shell.tsx:66` — `setHydrated(true)` in `useEffect` (react-hooks set-state-in-effect). Pre-existing hydrate pattern; not introduced as new auth logic.

Other errors include pre-existing set-state-in-effect on login/register forms, unused vars, prefer-const in orders/razorpay tests — **not in the auth commit set**.

### Full test failures (unrelated)

| File | Line | Cause |
|---|---|---|
| `modules/india-post/excel-ingest.test.ts` | 8 | `ENOENT` `bulkdomesticone_28042026.xlsx` (untracked fixture; not in `42383c4`) |
| `modules/invoices/pdf.test.ts` | 29 | timeout 5000ms |
| `modules/labels/receipt.test.ts` | 28 | timeout 20000ms |
| `modules/labels/unicode/unicode-paint.test.ts` | 68, 86 | timeout 5000ms (`@napi-rs/canvas`) |

No auth test file failed in the full suite.

---

## 4. Unit test results (authentication)

Isolated worktree:

```
npx vitest run lib/auth/session/classify.test.ts lib/supabase/auth-cookies.test.ts lib/supabase/proxy.session.test.ts lib/hooks/use-api.auth.test.ts lib/api/context.test.ts lib/dashboard/shell-gate.test.ts app/auth/callback/route.test.ts
→ Test Files  7 passed (7)
→ Tests       32 passed (32)
```

Coverage mapped to gates:

| Gate | Test evidence |
|---|---|
| 429 does not redirect | `classify.test.ts` `AUTH_RATE_LIMITED`; `shouldRedirectToLogin` false |
| 503 / `refresh_token_already_used` does not redirect | classify + `proxy.session.test.ts` dashboard 200, no Location |
| Missing session requires login | proxy dashboard → 307 `/login?next=` |
| API proxy skip | `getUser` **not** called on `/api/v1/me` |
| Host-only cookies | `auth-cookies.test.ts` `domain` undefined, SameSite Lax, Secure |
| Legacy Domain expire without jar overwrite | extra `Set-Cookie` `Domain=.postbus.in; Max-Age=0`; proxy keeps refreshed host-only value |
| Chunk names | expire list includes `sb-*-auth-token.0` … `.5` |
| 401 `AUTH_REQUIRED` → login | `use-api.auth.test.ts` + `shell-gate.test.ts` |
| 503 `AUTH_UNAVAILABLE` not logout | `use-api.auth.test.ts` |
| Profile DB error ≠ 401 | `context.test.ts` `PROFILE_UNAVAILABLE` |
| Tenant isolation | `context.test.ts` missing membership → `TENANT_ACCESS_DENIED` |
| RBAC | `VIEWER` + `orders.write` → `FORBIDDEN` |
| Transient keeps shell | `shell-gate.test.ts` |

---

## 5. Browser test results

**NOT EXECUTED.**

| ID | Scenario | Result |
|---|---|---|
| A | Chrome normal | NOT EXECUTED |
| B | Chrome Incognito | NOT EXECUTED |
| C | Multiple tabs | NOT EXECUTED |
| D | Browser refresh | NOT EXECUTED |
| E | Browser restart | NOT EXECUTED |
| F | Existing legacy cookies | NOT EXECUTED (unit only) |
| G | Fresh browser profile | NOT EXECUTED |
| H | Session expiration and refresh | NOT EXECUTED |

Reason: production (`https://www.postbus.in`) testing is forbidden. Local `.env.local` points at production Supabase. No isolated hosted GoTrue project was used. Results were **not invented**.

---

## 6. Cookie migration verification

**Code review: PASS. Live browser: NOT EXECUTED.**

| Requirement | Evidence |
|---|---|
| Host-only on www | `supabaseAuthCookieOptions()` omits `domain` |
| No new `Domain=.postbus.in` session cookies | Callback `delete cookieOptions.domain`; client/server/proxy share host-only options |
| SameSite / Secure | `sameSite: "lax"`; `secure: true` on HTTPS / server / proxy |
| Legacy Domain expired correctly | `appendLegacyDomainExpiryHeaders` / `expireLegacyDomainCookiesInBrowser` set `Max-Age=0` **with** `Domain=.postbus.in` |
| Chunked names | `authCookieNames` = storage key + `.0`–`.5` |
| New session cookies not deleted by expiry | Expiry appended as **extra** `Set-Cookie` headers so Next’s **name-keyed** jar does not replace the host-only cookie of the same name |
| Identical names, different Domain | Treated as two cookies; expiry targets Domain-scoped only |
| Do not clear all cookies | Only `sb-*-auth-token` names; no `document.cookie` wipe |

HttpOnly remains **false** (Supabase SSR chunked cookie default). Not changed.

**Residual live risk:** a merchant with mixed Domain/host-only chunks may need **one re-login**. Rollback of app code does not restore already-expired Domain cookies.

---

## 7. Token refresh verification

**Code + unit tests: PASS. Live matrix: NOT EXECUTED.**

| Scenario | Code expectation | Executed? |
|---|---|---|
| Normal login | Callback exchange without Domain; host-only Set-Cookie | Unit (callback route test) |
| Token refresh | Proxy `getUser` on HTML auth gates; browser autoRefresh | Unit (proxy keeps Set-Cookie) |
| Concurrent API | Proxy **skips** `/api/*` `getUser`; handlers still `getUser` once via `cache()` | Unit (API skip) |
| Dashboard navigation | Transient → 200 HTML, no login redirect | Unit |
| Multiple tabs | SDK cookie + classify `already_used` as transient | NOT EXECUTED in browser |
| Reload / restart | Host-only cookies persist | NOT EXECUTED |
| Temporary network / 503 | `AUTH_TRANSIENT_FAILURE` / `AUTH_UNAVAILABLE`; no login | Unit |
| HTTP 429 | `AUTH_RATE_LIMITED`; `isTransientApiAuthError`; no login | Unit |
| Explicit logout | Unchanged `signOut()` in account menus | Code review |
| Revoked session | `refresh_token_not_found` → `AUTH_SESSION_INVALID` → login; APIs `AUTH_REQUIRED` 401 | Unit |

Transient errors must not grant protected payloads: `requireTenant` / `requirePlatformAdmin` throw 503 or 401 **before** org queries return data. Confirmed.

---

## 8. API authorization coverage

Proxy change **does not** authenticate APIs. APIs still verify with `supabase.auth.getUser()` via `getRequestAuthUser` (not `getSession()` — none in `lib/supabase`).

| Surface | Auth boundary |
|---|---|
| `app/api/v1/[...slug]` → `handleV1` | After public/webhook/print-agent exceptions: `handleSessionRoutes` then `requireTenant(permissionForTenantRoute(...))` |
| `GET /api/v1/me`, `POST /api/v1/organizations` | `getRequestAuthUser` + classifier |
| `app/api/v1/tracking-pages/**` | `requireTenant` / `requireTenant("tracking.pages")` |
| `app/api/admin/[...slug]` | `requirePlatformAdmin()` then `handleAdminRoutes` |
| Public store / track / order-links / webhooks | Intentionally unauthenticated or signature-based |

**Classifier mapping**

| Class | HTTP | Client logout? |
|---|---|---|
| Valid user | 200 | No |
| Transient / 429 | 503 `AUTH_UNAVAILABLE` or 429 `RATE_LIMITED` | **No** (`isTransientApiAuthError`) |
| Profile query failure | 503 `PROFILE_UNAVAILABLE` | **No** |
| No user / invalid session | 401 `AUTH_REQUIRED` | **Yes** (`isConfirmedSessionLoss`) |
| Wrong org / no membership | 403 `TENANT_ACCESS_DENIED` | **No** |
| Missing permission | 403 `FORBIDDEN` | **No** |
| Not Super Admin | 403 `FORBIDDEN` | Admin shell shows “Not found”, **does not** `router.replace('/login')` |

Admin 403 path: `components/admin/shell.tsx` status 403 branch (no login redirect).

---

## 9. Tenant isolation verification

`requireTenant` still:

1. Authenticates with `getUser()`.
2. Loads `profiles.active_organization_id` for **that user id**.
3. Requires `organization_members` row for `(organization_id, user_id)`.
4. Applies RBAC `hasPermission`.

Unit test: user with `active_organization_id` but **no membership** → `TENANT_ACCESS_DENIED`. VIEWER cannot `orders.write` → `FORBIDDEN`.

Super Admin remains `requirePlatformAdmin` (`platform_admins` row or configured admin email). Transient Auth does not skip that check.

---

## 10. Refresh token race analysis

**Concurrent refresh remains possible.** This release **reduces** duplicate `/token` from the Next proxy; it does **not** eliminate all races.

| Actor | Lock | Still refreshes? |
|---|---|---|
| Browser `@supabase/ssr` singleton | Auth JS Web Locks (`navigator.locks`) when available | Yes (autoRefresh) |
| Proxy `getUser` | No lock shared with browser | Yes, **only** `/dashboard`, `/admin`, `/onboarding`, auth HTML |
| API `getRequestAuthUser` | React `cache` per request; no lock vs browser | Yes, on protected APIs |

**Reduced:** API + public HTML no longer call proxy `getUser`, so a dashboard fetch no longer double-refreshes in middleware **and** the route.

**Remaining:** HTML navigation `getUser` + browser autoRefresh + second tab API `getUser` can still rotate the same refresh token. `refresh_token_already_used` is now **transient** (retry, no login). Hosted **reuse interval** and **rotation** were **not** changed (forbidden). If production `/token` 400 vs 200 stays high after deploy, raise reuse interval as a **separate** hosted Auth change with its own approval.

JWT expiration was **not** modified.

---

## 11. Remaining risks

1. Browser / multi-tab / restart / Incognito / legacy cookie recovery **unverified live**.
2. Concurrent `/token` still possible; hosted reuse interval unchanged.
3. Mixed Domain cookies may force **one re-login**.
4. Transient 503 can leave dashboard mounted without `/me` until retry (banner/retry path).
5. Repo-wide `npm run lint` remains red (pre-existing). Production pipeline should lint the auth set or accept known hydrate rule.
6. Full `npm test` red on PDF/canvas/xlsx fixtures in this worktree (xlsx not in commit).
7. Production `/token` ratios not re-measured (Phase 1 historical: 591 `/token` 400 vs 91 200).
8. Deploying this branch **without** isolating commits would ship unrelated dirty work — **do not**.

---

## 12. Production deployment plan

**Do not deploy from this report.**

1. Approval from product/ops after optional browser matrix on a **non-production** GoTrue project.
2. Ship **only** SHA `42383c4c174fcc92b67e83c2a9e2eb0f9b9c7470` (plus this report commit). Cherry-pick or merge **without** dirty-tree files.
3. Coolify/production build must have `NEXT_PUBLIC_SUPABASE_URL` and anon key (prerender of `/` requires them).
4. Do **not** change JWT, rotation, reuse interval, or secrets at deploy time.
5. Do **not** globally sign out users.
6. Canary: watch GoTrue `/token` 200/400, `refresh_token_already_used`, 429, `/logout`, login-page bounce rate, normalized by `/user` volume. Never log JWTs or cookie values.
7. Expect some one-time re-login from Domain-cookie expiry.

---

## 13. Rollback plan

1. Redeploy previous production app SHA (`f60a94ab...` or last known-good Coolify image).
2. **Keep** Domain expiry headers if Domain cookies were issued in the wild; otherwise mixed Domain/host-only chunks return.
3. Do not mass-invalidate refresh tokens.
4. Do not revert hosted Auth settings (none were changed).
5. If merchants are stuck: they sign in once; do not wipe all browser storage as a first step.

---

## 14. Monitoring plan (24h post-deploy, when authorized)

| Signal | Direction of success |
|---|---|
| GoTrue `POST /token` 400 / `refresh_token_already_used` | Down vs Phase 1 |
| GoTrue 429 | Down or stable; must not correlate with login redirects |
| App `auth.session_classified` `AUTH_TRANSIENT_FAILURE` / `AUTH_RATE_LIMITED` | May appear; should **not** pair with `/login` spikes |
| `AUTH_SESSION_INVALID` / `AUTH_REQUIRED` | True logout / expired only |
| `/logout` count | Should not rise from this fix |
| Support “kicked to login while working” | Down |

Log fields already limited: classification, error code, status, path.

---

## 15. Final verdict

**YELLOW**

| Gate | Status |
|---|---|
| Auth implementation committed, unrelated dirty tree preserved | PASS |
| Isolated `typecheck` | PASS |
| Isolated `next build` with env | PASS |
| Isolated `lint` (full repo) | FAIL (pre-existing) |
| Isolated `npm test` (full repo) | FAIL (non-auth) |
| Auth unit tests | PASS (32/32) |
| Security: `getUser`, tenant, Super Admin, 401/403/429/503 | PASS (code + unit) |
| Cookie migration | PASS (code + unit); live NOT EXECUTED |
| Token refresh live / browser matrix | NOT EXECUTED |
| Production deploy | NOT DONE |

GREEN requires completed browser testing and no incomplete mandatory validation.

---

## POSTBUS AUTH SESSION FINAL RELEASE GATE

**Git SHA:** `42383c4c174fcc92b67e83c2a9e2eb0f9b9c7470` (`fix/auth-session-stability`)  
**Build:** PASS in isolated worktree with `.env.local`; FAIL without credentials (prerender `/`)  
**Tests:** Auth 32/32 PASS; full suite 5 FAIL (xlsx/PDF/canvas, not auth)  
**Browser:** NOT EXECUTED  
**Cookie Migration:** Code PASS; live NOT EXECUTED  
**Token Refresh:** Unit PASS; live NOT EXECUTED  
**Tenant Security:** PASS (`getUser` + membership + RBAC + Super Admin; 403 ≠ logout)  
**Remaining Risks:** Live cookie/tab races; hosted reuse interval unchanged; dirty tree must not ship  
**Production Readiness:** **YELLOW — AWAITING PRODUCTION DEPLOYMENT APPROVAL**

AWAITING PRODUCTION DEPLOYMENT APPROVAL.
