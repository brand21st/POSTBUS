# PostBus Shopify Native App Architecture

**Date:** 2026-10-20  
**Decision:** Recommend **Option C** (extend this Next.js repo with a separate embedded surface) implementing **Option A layering** (Polaris UI ≠ dashboard UI; shared `modules/*`).

---

## 1. Option comparison

| | A Separate frontend + shared backend | B Monorepo two apps | C Route group in current Next.js |
|--|--------------------------------------|---------------------|----------------------------------|
| Complexity | New deploy + CORS/auth | Tooling split | Lowest: same Coolify app, new `app/(shopify)` |
| Security | Clear origin; must still share secrets store | Good isolation | Must **split CSP** `/shopify/*` vs `/dashboard` |
| Maintainability | Two UI stacks anyway | Extra package graph | One TS/path alias `@/` |
| Deploy isolation | Best | Good | Same process — blast radius shared |
| Performance | Extra hop if BFF remote | Similar | Same origin fetch |
| Code reuse | Services via HTTP | Packages | Direct `modules/` import **best** |
| Testing | Contract tests critical | Same | Can unit-test services once |
| Migration risk | Dual deploy | Medium | **Lowest** if CSP/auth bugs contained |
| Long-term | If Shopify UI and SaaS diverge violently, extract later | Premature | Extract App Home if needed |

**Do not rewrite the backend.** No new CEPT client.

**Dedicated BFF (`/api/shopify/*`)** is still recommended **inside** this repo so cookie `requireTenant` is never mixed with ID tokens.

---

## 2. Target topology

```
SHOPIFY ADMIN
    └── iframe App Home  (Polaris web components + App Bridge)
            │ ID token
            v
        POSTBUS /shopify/* UI  +  /api/shopify/* BFF
            │ requireShopifyTenant → TenantContext
            v
        POSTBUS BUSINESS SERVICES  (existing modules)
            ├── India Post CEPT
            ├── Shopify Admin GraphQL (offline token)
            └── Postgres (tenant-scoped access)
```

App Home model (**VERIFIED** Shopify toolkit): iframe you host, `@shopify/polaris-types` `s-*` components, `@shopify/app-bridge-react` `useAppBridge`. Do **not** import `@shopify/polaris` React v12 as if it were current App Home.

Optional later: Admin action/block/print extensions (API 2026-07). Not required for MVP workspace.

---

## 3. Auth

1. Merchant installs Partner app (managed installation / TOML scopes).  
2. App Bridge issues **ID token** (session token).  
3. BFF verifies JWT, token-exchanges **expiring offline** token, upserts installation.  
4. Resolve org: existing `shopify_connections.shop_domain` **or** provision new org (**not** email match).  
5. Subsequent UI calls: `Authorization: Bearer <id_token>`; BFF loads org from `dest`.  
6. Background jobs use stored **offline** token, not the ID token.  
7. Claim dashboard access later: OWNER email login **after** shop proof — explicit link UI.

Online tokens: optional overlay for “who clicked Book”; do not map Staff → OWNER.

Uninstall: registered webhook revokes tokens, stops jobs, does not delete historical shipments (**PROPOSAL:** retain data, mark installation `DISCONNECTED`).

---

## 4. API gateway / BFF

**Yes — a thin Shopify BFF.** Reasons: ID token verification, 401 retry header, no CEPT credentials in browser, entitlement checks, audit `actor=shopify_staff`.

It should call existing functions (`createShipmentsForOrders`, `listOrders`, …), not SQL.

---

## 5. UX shell (Polaris)

Use App Home patterns: Homepage, Index table, Details, Settings, Setup guide.

App Bridge: Navigation, Toast, Modal, Loading, Save Bar, Print (`print()`), ID Token, User.

**External browser / non-iframe (do not promise otherwise):**

| Flow | Why |
|------|-----|
| Shopify App Pricing / charge confirmation | Hosted by Shopify |
| Print Agent download / USB | OS + local app |
| Customer tracking page | Public site |
| India Post CEPT portal | Merchant contract admin, not PostBus |
| Optional Razorpay for **SaaS dashboard** | Not App Store path |

---

## 6. Printing architecture (Shopify)

**Recommended primary:** server-generated PDF → download → `window.print()` / App Bridge Print for **page** content. Bulk: existing `labels/bulk-download` ZIP/PDF.

**Admin print action** (optional): Print menu on Shopify order with `s-admin-print-action src=<https pdf>`.

**Local print agent:** keep; document as optional. Pairing may require opening `www.postbus.in` or a deep link — **outside** Admin iframe.

**WebUSB:** partial today; unsupported printers defer to agent. Do **not** claim arbitrary USB control from Shopify Mobile.

---

## 7. Billing architecture

App Store listing: **Shopify App Pricing** (default for new public apps, 2026 docs). Configure plans in Partner Dashboard. Do **not** charge merchants via Razorpay **for the listed app**.

Internal: `BillingProvider` abstraction (**PROPOSAL**) — `SHOPIFY` | `RAZORPAY` → same `subscriptions` + `consume_order_quota` + `assertPlanFeature`.

Double billing: one **entitlement** row per org; installing Shopify while having Razorpay requires explicit **link or pause** rules (see PRD).

---

## 8. Keep SaaS dashboard running

`/dashboard` unchanged except: do not break `shopify_connections` BYO path; CSP exceptions **only** on `/shopify` prefixes; jobs remain shared.

---

## 9. Multi-store

MVP: keep **one shop per org** (matches unique indexes). Document multi-store as a later migration that drops `shopify_connections_one_per_org`.
