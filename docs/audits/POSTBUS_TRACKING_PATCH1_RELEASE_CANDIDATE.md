# POSTBUS TRACKING PATCH 1 — RELEASE CANDIDATE

Date: 17 Oct 2026  
Worktree: `D:/POST BUS APP/.worktrees/postbus-tracking-patch1`  
Branch: `release/postbus-tracking-patch1`  
**Deployed: no. Pushed: no. Coolify: unchanged.**

---

## 1. Production baseline SHA

`f7c77efde2818198bc4f55fa1a82574d7952057b`

Coolify app `mw9larpomkyonxzy1rk3h6jm`, branch `release/auth-session-on-prod` (verified earlier this session).

---

## 2. New isolated release SHA

`d2beb8b420c70a9a68c22b60026b4128803e4a68`

Message: `fix(tracking): prevent auth failure job storm`

---

## 3. Git history verification

| Check | Result |
| --- | --- |
| Parent of candidate | `f7c77efde2818198bc4f55fa1a82574d7952057b` |
| Single parent | **yes** |
| Started from production tree | **yes** (`git worktree add -b ... f7c77ef`) |
| Merged divergent `fix/auth-session-stability` | **no** |
| Cherry-picked unrelated commits | **no** |
| Production history rewritten | **no** |
| Dirty main working tree | **untouched** |

---

## 4. Files changed

```
modules/india-post/login-auth.ts                 (new)
modules/india-post/login-auth.test.ts            (new)
modules/india-post/tracking-auth-hold.ts         (new)
modules/india-post/tracking-auth-hold.test.ts    (new)
modules/india-post/tracking-auth-hold.pg.test.ts (new)
modules/india-post/tracking-sync.ts
modules/india-post/tracking-sync.test.ts
modules/india-post/provider.ts
modules/india-post/provider.session.test.ts
workers/processor.ts
```

10 files, +1066 / −40.

---

## 5. Actual code diff summary

- **login-auth:** phrase allowlist; `createIndiaPostLoginError`; job-row classifier; tracking-only `PERMANENT_AUTH_ERROR` tag.
- **tracking-auth-hold:** last 10 FAILED `tracking-sync` rows; 15m→24h cooldown; probe throttle; recovery only via `last_verified_at` / `last_refreshed_at`.
- **tracking-sync:** hold before enqueue; org-scoped cancel of extra QUEUED/PENDING; select connection timestamps.
- **provider `login()`:** same HTTP codes as before; adds `indiaPostOperation: "login"`. Booking HTTP 400 remains `HTTP_400`.
- **processor `syncTracking` catch:** tag confirmed login auth failures only.

No booking payload, barcode, label, Shopify fulfillment, env, Dockerfile, or migration diffs.

---

## 6. Dependencies

Uses existing production columns `india_post_connections.last_verified_at` / `last_refreshed_at` and `background_jobs`. No new packages. No new schema.

---

## 7. Test commands and results

Run **inside the release worktree** (not the dirty development tree). Default `vitest.config.ts` excludes `**/.worktrees/**`, so tests used a **local uncommitted** `vitest.patch1.config.ts` (not in the commit).

```
npx vitest run --config vitest.patch1.config.ts \
  modules/india-post/login-auth.test.ts \
  modules/india-post/tracking-auth-hold.test.ts \
  modules/india-post/tracking-auth-hold.pg.test.ts \
  modules/india-post/tracking-sync.test.ts \
  modules/india-post/provider.session.test.ts \
  modules/india-post/session.test.ts \
  lib/jobs/retry.test.ts \
  modules/india-post/apply-tracking.test.ts \
  modules/india-post/booking-lock.test.ts
```

**9 files, 79 tests, exit 0.** Mocks / PGlite. No live CEPT. No production DB.

```
npx tsc --noEmit          # exit 0
npx eslint <Patch 1 files>  # exit 0
```

---

## 8. Build verification

```
NEXT_PUBLIC_APP_URL=https://www.postbus.in
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key
npx next build
```

**Exit 0.** Compiled with Next.js 16.3.8. No production secrets used.

---

## 9. Booking compatibility

Login HTTP 400 still `HTTP_400` (provider test). `classifyProviderError` / booking-lock tests passed. Booking request construction not modified.

---

## 10. Shopify compatibility

`shopifyFulfillment` in `processor.ts` unchanged except the tracking catch import/tag. No Shopify module diffs.

---

## 11. Database migration status

**None.** Rollback is application-only.

---

## 12. Security review

- No secrets in the commit.
- Hold queries are `organization_id` scoped.
- Service-role job runner behavior unchanged.
- RLS not re-proven (skip-staging risk).
- Logs add `errorCode` / `httpStatus` on tracking fail; still must not dump credentials (messages already existed).

---

## 13. Remaining risks

1. Skip-staging / no hosted RLS.  
2. Claim-before-cancel race (QUEUED cancel only; RUNNING not unique).  
3. Hold depends on retained FAILED `tracking-sync` rows.  
4. No runtime feature flag; rollback is Coolify redeploy of `f7c77ef`.  
5. Auto-deploy is off, but do not push this branch to a watched production ref without a named deploy.

---

## 14. Deployment target (when approved)

| Item | Value |
| --- | --- |
| Coolify UUID | `mw9larpomkyonxzy1rk3h6jm` |
| Site | `https://www.postbus.in` |
| Database | `hgacoeoovjxkzfbesmvl` (no migrate) |
| Git SHA to deploy | `d2beb8b420c70a9a68c22b60026b4128803e4a68` |
| Auto-deploy | keep **off**; manual deploy only |

---

## 15. Rollback procedure

Redeploy Coolify image / commit **`f7c77efde2818198bc4f55fa1a82574d7952057b`**.  
No database rollback. Do not delete jobs or tracking events.

---

## 16. Final release verdict

**READY FOR PRODUCTION DEPLOYMENT APPROVAL**

Stop. Do not push. Do not trigger Coolify until:

`APPROVE POSTBUS PATCH1 PRODUCTION DEPLOY`

naming SHA **`d2beb8b420c70a9a68c22b60026b4128803e4a68`**.
