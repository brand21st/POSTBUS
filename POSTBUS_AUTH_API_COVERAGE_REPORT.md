# POSTBUS AUTH API COVERAGE REPORT

**Date:** 2026-10-14  
**Branch:** `fix/auth-session-stability`  
**Scope:** `app/api/**` in the main application tree (not `.worktrees`)  
**Proxy change:** `/api/*` does **not** call `getUser()` in `lib/supabase/proxy.ts`. Authorization is the **route handler**, not the proxy.

**Finding:** No merchant or Super Admin endpoint relied exclusively on proxy `getUser()`. Skipping proxy refresh on APIs does **not** unprotect those routes.

Verification: code review of every `app/api/**/route.ts` plus `lib/api/v1/handle.ts`. Live HTTP against production was **not** executed.

---

## Classification legend

| Class | Meaning |
|---|---|
| A | Public / unauthenticated |
| B | Merchant cookie session (`getUser` + tenant) |
| C | Super Admin (`requirePlatformAdmin`) |
| D | Webhook signature / connection secret |
| E | Machine token (print agent, VaChat MCP) |
| F | Scheduled job (`CRON_SECRET`) |

---

## Routes

| Route path | Class | Authentication | Authorization / tenant | Result | Remaining risk |
|---|---|---|---|---|---|
| `/api/health` | A | None | Health payload only | PASS | None |
| `/api/sentry-example-api` | A | None | Intentionally throws | PASS | Dev/Sentry probe |
| `/api/v1/auth/register` | A | Rate-limited signup | Creates Auth user | PASS | Abuse: rate limit 8/min |
| `/api/v1/auth/pincode` | A | Rate-limited PIN lookup | Directory data | PASS | Rate limit 30/min |
| `/api/auth/otp/request` | A | Rate-limited WhatsApp OTP | Policy in OTP module | PASS | OTP abuse controls |
| `/api/auth/otp/verify` | A | OTP verification; sets session cookies | Same | PASS | Cookie host-only after Phase 2 |
| `/api/v1/public/store` | A | Workspace slug | Public catalog | PASS | Dirty-tree storefront changes exist outside this release |
| `/api/v1/public/store/products` | A | Workspace slug | Public | PASS | Same |
| `/api/v1/public/store/product` | A | Workspace slug | Public | PASS | Same |
| `/api/v1/public/store/quote` | A | Workspace slug | Public quote | PASS | Same |
| `/api/v1/public/store/events` | A | Workspace slug | Analytics events | PASS | Same |
| `/api/v1/public/track` | A | Tracking identifier | Public track | PASS | Enumeration of tracking ids |
| `/api/v1/public/tracking-page` | A | Published page | Public | PASS | — |
| `/api/v1/public/order-links/[token]` | A | Capability token | Token-scoped order | PASS | Token secrecy |
| `/api/v1/public/order-links/[token]/pincode` | A | Token | Token-scoped | PASS | — |
| `/api/v1/public/order-links/[token]/submit` | A | Token | Token-scoped submit | PASS | — |
| `/api/v1/public/order-links/whatsapp-order-form` | A | Public form token | Form-scoped | PASS | — |
| `/api/v1/public/order-links/whatsapp-order-form/pincode` | A | Public form | Form-scoped | PASS | — |
| `/api/v1/public/order-links/whatsapp-order-form/submit` | A | Public form | Form-scoped | PASS | — |
| `/api/v1/[...slug]` → `GET billing/plans` | A | None | Plan catalog | PASS | Handled **before** `requireTenant` |
| `/api/v1/[...slug]` → `GET me` / `POST organizations` | B | `getRequestAuthUser` → `getUser()` | Classifier; org create | PASS | Transient → 503 not 401 |
| `/api/v1/[...slug]` remaining merchant routes | B | `requireTenant(permissionForTenantRoute)` | Membership + RBAC + plan feature | PASS | Catch-all; unknown path 404 after auth |
| `/api/v1/tracking-pages` | B | `requireTenant` | `tracking.pages` on writes | PASS | Dedicated routes, not only catch-all |
| `/api/v1/tracking-pages/banners` | B | `requireTenant("tracking.pages")` | Same | PASS | — |
| `/api/v1/tracking-pages/publish` | B | `requireTenant("tracking.pages")` | Same | PASS | — |
| `/api/v1/tracking-pages/unpublish` | B | `requireTenant("tracking.pages")` | Same | PASS | — |
| `/api/v1/tracking-pages/subdomain-availability` | B | `requireTenant()` | Membership | PASS | — |
| `/api/v1/tracking-pages/host-status` | B | `requireTenant()` | Membership | PASS | — |
| `/api/admin/[...slug]` | C | `requirePlatformAdmin()` | `platform_admins` / env email | PASS | 403 ≠ logout |
| `/api/webhooks/razorpay` | D | `x-razorpay-signature` | Billing webhook secret | PASS | Independent of session cookies |
| `/api/v1/[...slug]` India Post / Wati / Shopify / VaChat webhooks | D | HMAC / connection / inbox | `handleInboundWebhook` **before** `requireTenant` | PASS | Must not fall through to tenant |
| `/api/v1/[...slug]` `print-agent/*` | E | `authenticatePrintAgent` bearer | Agent org scope | PASS | Before `requireTenant` |
| `/api/v1/[...slug]` `vachat/mcp` | E | Bearer / `x-api-key` = platform API key | `authorizeVachatMcp` | PASS | Machine key, not merchant cookie |
| `/api/cron/jobs` | F | `authorizeCron` (`CRON_SECRET`) | Job drain | PASS | Disabled if secret unset |
| `/api/cron/billing` | F | `authorizeCron` | Billing sweep | PASS | Same |

---

## Proxy vs handler

| Question | Answer |
|---|---|
| Did any B/C route use proxy as the only auth? | **No.** |
| Do APIs still `getUser()`? | **Yes**, via `getRequestAuthUser` / `requireTenant` / `requirePlatformAdmin`. Never `getSession()` for authorization. |
| Transient Auth | 503 `AUTH_UNAVAILABLE` — fail closed, no payload. |
| Invalid / missing session | 401 `AUTH_REQUIRED`. |
| Wrong org / role | 403 `TENANT_ACCESS_DENIED` / `FORBIDDEN`. |

---

## Tenant isolation

`requireTenant` binds `profiles.active_organization_id` to `organization_members (organization_id, user_id)` then RBAC. Unit tests: missing membership → `TENANT_ACCESS_DENIED`; VIEWER + `orders.write` → `FORBIDDEN`. Cross-org live HTTP: **NOT EXECUTED**.

---

## Remaining API risks

1. Catch-all `/api/v1/[...slug]` authenticates first, then 404s unknown paths (session required to learn a path exists).
2. Public store/order-link/track surfaces are intentionally unauthenticated; they must stay token/slug scoped.
3. Unrelated dirty-tree storefront API edits are **not** in this auth release candidate.
