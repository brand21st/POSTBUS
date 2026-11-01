# PostBus Current Architecture

**Status:** READ-ONLY audit  
**Date:** 2026-10-20  
**Scope:** Main tree `d:\POST BUS APP` (ignored `.worktrees`, `.next`, `node_modules`)  
**Production safety:** No code, schema, env, deploy, India Post, Shopify, or payment mutations were executed.

Evidence tags used throughout this set:

| Tag | Meaning |
|-----|---------|
| **VERIFIED** | Confirmed in source |
| **PARTIALLY VERIFIED** | Path exists; runtime/prod behaviour not observed |
| **ASSUMPTION** | Inference, not proven |
| **UNKNOWN** | Not found or not measurable |
| **REQUIRES EXTERNAL VALIDATION** | Needs Partner Dashboard, CEPT PDF, or production metrics |

---

## 1. What PostBus is today

PostBus is a **multi-tenant India Post shipping SaaS** hosted at https://www.postbus.in. It is a **Next.js App Router** application with:

- Merchant dashboard (`/dashboard/*`)
- Super Admin (`/admin/*`)
- Partner/affiliate portal (`/partner/*`)
- Marketing site (`app/(marketing)`)
- Public tracking and order-link surfaces
- Optional merchant storefront (`app/(storefront)`)
- Catch-all tenant API (`/api/v1/*`) plus Merchant Public API (`/api/merchant/v1/*`)

**VERIFIED:** It is **not** a Shopify embedded Partner app. Shopify today is a **BYO custom-app connector** (merchant pastes Client ID/secret, OAuth stores an encrypted Admin token). See `POSTBUS_SHOPIFY_INTEGRATION_AUDIT.md`.

---

## 2. Framework and versions (**VERIFIED**)

| Component | Version / evidence |
|-----------|-------------------|
| Package name | `postbus` `0.1.0` (`package.json`) |
| Next.js | **16.3.8** (`package.json` `"next": "16.3.8"`) |
| React | **19.2.8** |
| TypeScript | `^5`, `strict: true` (`tsconfig.json`) |
| Router | **App Router only** (`app/**/page.tsx`, `app/api/**/route.ts`). No `pages/` router found in main tree. |
| Styling | Tailwind CSS 4 |
| Data fetching UI | TanStack Query 5, TanStack Table 9 |
| Validation | Zod 4 |
| Auth/DB client | `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.116.0 |
| Jobs | `background_jobs` DB drain **or** BullMQ + Redis (`JOB_RUNNER`) |
| Observability | Sentry (`@sentry/nextjs`), PostHog client token env |
| Shopify packages | **None** — no `@shopify/app-bridge`, `@shopify/shopify-api`, `@shopify/polaris` in `package.json` |

Next config (`next.config.ts`): `output: "standalone"`, Sentry wrapper, security headers from `lib/security/headers.ts`, unicode label canvas aliases.

**AGENTS.md / CLAUDE.md** warn that this Next.js version may differ from training data. Audit did not rely on generating Next.js APIs.

---

## 3. Process architecture

```
Browser (merchant / admin / partner / public)
        |
        | HTTPS
        v
Next.js 16 App Router  (proxy.ts session + CSP)
        |
        +-- /dashboard  (Supabase cookie session)
        +-- /admin      (platform_admins)
        +-- /partner    (affiliate)
        +-- /api/v1/*   requireTenant (Supabase user → org membership)
        +-- /api/merchant/v1/*  API key (service-role queries, org filter)
        +-- /api/admin/*        requirePlatformAdmin
        +-- /api/cron/*         CRON_SECRET
        +-- webhooks            HMAC / provider signatures
        |
        v
Supabase Postgres + RLS
        |
        +-- background_jobs claimed by POST /api/cron/jobs
        |         and/or BullMQ workers (`npm run workers`)
        |
        +-- India Post CEPT (UAT test.cept.gov.in / PROD app.indiapost.gov.in)
        +-- Shopify Admin REST 2025-01 + GraphQL 2026-04 (per-org token)
        +-- Razorpay (platform billing only)
        +-- Wati / Vachat / OpenRouter (optional)
```

**VERIFIED:** Request proxy is `proxy.ts` (Next.js 16 proxy, not classic `middleware.ts`). Session refresh: `lib/supabase/proxy.ts`. Dashboard/admin/onboarding gated by cookies.

---

## 4. Module map (source of truth: `modules/` + `app/` + `lib/api/`)

For every discovered module: purpose, location, Shopify reuse. Detail lives in sibling docs.

| Module | Location | Purpose | Shopify reuse |
|--------|----------|---------|---------------|
| Orders | `modules/orders/` | Manual/API/WhatsApp create, list, address/weight, bulk fulfill | **Reuse services** |
| Shipments | `modules/shipments/` | `createShipmentsForOrders`, retry, presets | **Reuse as-is** |
| Shopify connector | `modules/shopify/` | OAuth, REST/GraphQL, webhooks, fulfillment write-back | **Adapt** (not embedded) |
| India Post | `modules/india-post/` | Session, book, tariff, track, bulk, locks | **Reuse; never from Shopify UI** |
| Labels | `modules/labels/` | Official CEPT PDF, custom slips, unicode, multi-up | **Reuse PDFs** |
| Invoices | `modules/invoices/` | GST shipping invoices | **Reuse** |
| Print | `modules/print/`, `print-agent/`, `print-agent-desktop/` | Pairing, WebUSB, USB agent | **Reuse agent; not in iframe USB** |
| Tracking pages | `modules/tracking-pages/` | Canonical `/track?tracking=` | Customer-facing **outside** Admin |
| NDR/RTO | `modules/ndr-rto/` | Exception buckets | **Reuse** |
| Automation | `modules/automation/` | Org toggles | **Reuse + UI** |
| Billing | `modules/billing/`, `modules/razorpay/` | Plans, quota, Razorpay | **Do not use for App Store charges** |
| Addons | `modules/addons/` | Paid add-ons / entitlements | Optional |
| Merchant API | `modules/merchant-api/` | External API keys | Not the embedded UI path |
| Outbound webhooks | `modules/webhooks/` | Signed merchant events, SSRF guard | Optional |
| Support | `modules/support/` | Tickets + WhatsApp | Optional embedded |
| AI credits | `modules/ai-credits/` | Wallet RPCs | Optional / likely **F** |
| AI image / cover | `modules/ai-image/` | Studio jobs | **F** |
| AI accountant | `modules/ai-accountant/` | GST/COD books | **F** |
| Inventory / storefront | `modules/storefront/`, inventory APIs | PostBus catalog | **F** for Shopify merchants |
| Affiliates | `modules/affiliates/` | Partner portal | **F** |
| Wati / Vachat | `modules/wati/`, `modules/vachat/` | WhatsApp notify / support | Optional |
| Jobs | `lib/jobs/`, `workers/` | Drain, retry, processor | **Reuse** |
| RBAC | `lib/permissions/rbac.ts` | OWNER…VIEWER | Adapt vs Shopify staff |
| Security | `lib/security/*` | CSP, crypto, rate limit, origin | Must change CSP for embed |
| Admin | `lib/api/admin/` | Platform ops | **Never in merchant app** |

---

## 5. Authentication and authorization (**VERIFIED**)

| Layer | Implementation |
|-------|----------------|
| Identity | Supabase Auth (email/password register + WhatsApp OTP: `app/api/auth/otp/*`) |
| Session | Supabase SSR cookies; `getRequestAuthUser()` |
| Tenant | `requireTenant()` in `lib/api/context.ts` — `profiles.active_organization_id` + `organization_members` |
| Roles | OWNER, ADMIN, MANAGER, OPERATOR, VIEWER (`types/domain.ts`, `lib/permissions/rbac.ts`) |
| API permissions | `lib/api/v1-permissions.ts` |
| Platform admin | `requirePlatformAdmin()` + `platform_admins` |
| Merchant API | API keys + scopes; **service-role** DB client with `organization_id` filters |
| Shopify embedded session | **Absent** |

Headless Shopify install (org with no Supabase user) **does not exist**. RLS is built around `auth.uid()`.

---

## 6. API architecture (**VERIFIED**)

Catch-all: `app/api/v1/[...slug]/route.ts` → `handleV1` (`lib/api/v1/handle.ts`).

Dispatch: inbound webhooks → print-agent device auth → public print pairing → public plans → session (`GET me`, `POST organizations`) → `requireTenant` → tariff, billing, addons, AI accountant, workspace, support, UI layouts, presets, print, labels, invoices, inventory, commerce, integrations, tutorials.

Rate limit: in-memory 60/min (180 for some webhook/print paths). **PARTIALLY VERIFIED:** ineffective across multiple Node instances.

Full inventory: `POSTBUS_API_INVENTORY.md`.

---

## 7. Database (**VERIFIED** from migrations)

PostgreSQL via Supabase. Tenant root: `organizations`. Child tables carry `organization_id`. RLS helpers `is_org_member()` / `has_org_role()`.

Shopify: `shopify_connections` unique **one shop per org** and **one org per shop_domain** (`20260925140000_shopify_one_shop_per_org.sql`). `shopify_stores` exists but credentials live on `shopify_connections`.

India Post: `india_post_connections` unique per org; `india_post_contracts`; `barcode_ranges`; RPC `allocate_barcode_serial` **service_role only**.

Billing: `plans`, `subscriptions`, `payments`, `billing_usage`, `consume_order_quota`.

See `POSTBUS_DATABASE_ARCHITECTURE.md`.

---

## 8. Background jobs and cron (**VERIFIED**)

Job types: `types/domain.ts` `JOB_TYPES` (shopify-sync, shipment-booking, label-generation, tracking-sync, shopify-fulfillment, …).

Processor: `workers/processor.ts`. Retry: `lib/jobs/retry.ts` (max 5, delays 1m/5m/15m/30m).

Cron:

- `POST /api/cron/jobs` — drain + enqueue tracking-sync
- `POST /api/cron/billing` — subscription/addon/affiliate sweeps

Ops: `infra/HOSTINGER.md` documents three Coolify minute-crons by `JOB_TYPES` lane. **REQUIRES EXTERNAL VALIDATION** that production Coolify matches the doc.

---

## 9. Integrations snapshot

| Integration | Maturity | Notes |
|-------------|----------|-------|
| India Post CEPT | Production-oriented, heavily tested | Login/refresh, book, label, track; inbound webhooks **quarantined** |
| Shopify Admin | Production BYO connector | Sync + fulfillment; not App Store embedded |
| Razorpay | Platform SaaS billing | Not merchant customer payments |
| Wati / Vachat | Implemented | Optional notifications / support |
| WooCommerce | Enum only | **No importer** |
| Merchant Public API | Implemented, flag-gated | Separate from dashboard session |

---

## 10. File generation / labels / tracking / AI / notifications / billing / Super Admin

Covered in dedicated docs. One-line facts:

- Labels: CEPT official A6 + merchant A4/A5/A6/4×6; Noto unicode fonts; print agent for USB.
- Tracking: polling (`tracking-sync`, default 15 min) + quarantined CEPT webhooks; canonical URL `https://www.postbus.in/track?tracking={AWB}`.
- AI: credit wallet RPCs; image/cover studios; accountant addon.
- Billing: Razorpay subscriptions + order quota.
- Super Admin: 19 pages under `app/(admin)/admin`.

---

## 11. Production readiness of the **current** system

| Area | Assessment |
|------|------------|
| Standalone SaaS shipping | **PARTIALLY VERIFIED** production-ready: live domain, jobs, CEPT isolation, tests exist. SLOs **NOT MEASURED**. |
| Shopify embedded / App Store | **Not implemented**. CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY` block iframe. |
| India Post Approach PDF | **PENDING** — cited 30.07.2026 in `modules/india-post/spec.ts`; PDF not in repo. |

---

## 12. Implications for the Shopify app

Reuse the **business layer** (`modules/shipments`, `modules/india-post`, labels, tracking, jobs, quota). Build a **new iframe App Home** (Polaris web components + App Bridge ID tokens) that calls a **Shopify-authenticated BFF** wrapping the same services. Keep `/dashboard` operational.

Recommended architecture: **Option C** (same Next.js deployment, `app/(shopify)/` surface) with Option A layering (separate UI, shared services). Evidence and comparison: `POSTBUS_SHOPIFY_NATIVE_APP_ARCHITECTURE.md`.
