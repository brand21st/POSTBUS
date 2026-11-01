# PostBus API Inventory

**Status:** READ-ONLY  
**Date:** 2026-10-20  
**Dispatch:** `app/api/v1/[...slug]/route.ts` → `lib/api/v1/handle.ts`

Auth tags: **tenant** (Supabase session + org), **session** (user, org optional), **public**, **webhook**, **device**, **apikey**, **admin**, **cron**, **partner**.

Shopify classes: **REUSE DIRECTLY** / **ADAPT** / **WRAP** / **REFACTOR** / **REPLACE** / **DEPRECATE** / **UNKNOWN**.

Request/response schemas: Zod in `modules/*/schema.ts` and handler files. This inventory does not duplicate every Zod object; see those files. Rate limit: in-memory 60/min on `handleV1` unless noted. Idempotency: Shopify inbound keys; Merchant API has its own; booking uses shipment CAS — not HTTP Idempotency-Key on dashboard POSTs (**VERIFIED** gap).

Callers: dashboard React pages, workers, Shopify/Razorpay/CEPT/Wati, Merchant API consumers.

---

## 1. Architecture recommendation

Do **not** point the Shopify iframe at cookie `requireTenant` routes without a parallel auth.

```
Shopify Embedded UI (Polaris + App Bridge)
        │  Authorization: Bearer <ID token>
        v
Authenticated Shopify API layer  (NEW: requireShopifyTenant)
        │  same TenantContext shape
        v
Existing modules (orders, shipments, india-post, labels, tracking, automation)
        v
Postgres / CEPT / Shopify Admin API (offline token)
```

Options:

- **WRAP** existing `/api/v1/*` handlers after swapping auth (lowest duplication, CSRF/session mismatch risk).  
- **Dedicated `/api/shopify/*` BFF** that calls the same services (clearer CSP, no accidental cookie confusion). **Recommended.**

Versioning: keep `/api/v1` for SaaS; add `/api/shopify/v1` or session-token-aware wrapper. Do not version CEPT.

---

## 2. Special `/api/v1` (before tenant)

| Method | Path | Handler | Auth | Shopify |
|--------|------|---------|------|---------|
| POST | `/api/v1/webhooks/shopify` | `inbound-webhooks.ts` | webhook HMAC | **ADAPT** (GDPR, uninstall register, commit-on-success) |
| POST | `/api/v1/webhooks/india-post/:id/(booking\|events)` | inbound | webhook | REUSE (quarantined) |
| GET/POST | `/api/v1/webhooks/wati/:connectionId` | inbound | webhook | UNKNOWN |
| POST | `/api/v1/integrations/vachat/webhooks` | inbound | webhook | UNKNOWN |
| * | `/api/v1/vachat/mcp` | vachat mcp | MCP | DEPRECATE for Shopify UI |
| POST | `/api/v1/print-agent/heartbeat`, `jobs/claim` | `print.ts` | device | REUSE |
| GET/PATCH | `/api/v1/print-jobs/:id(/pdf)` | print | device | REUSE |
| POST | `/api/v1/print-devices/pair/*` | `print-devices.ts` | public | REUSE |
| POST | print-devices heartbeat/refresh/disconnect/jobs | print-devices | device | REUSE |
| GET | `/api/v1/billing/plans` | `billing.ts` | public | WRAP (App Store must not charge via Razorpay) |
| GET | `/api/v1/me` | `session.ts` | session | **REPLACE** (ID token shop/user) |
| POST | `/api/v1/organizations` | `session.ts` | session | ADAPT provisioning |

---

## 3. Commerce (`lib/api/v1/commerce.ts`) — primary reuse set

| Method | Path | Perm | Shopify |
|--------|------|------|---------|
| GET | `dashboard/kpis` `pipeline` `analytics` | orders.read | WRAP |
| GET | `orders` `orders/:id` `orders/export` | orders.read | **REUSE DIRECTLY** (auth wrap) |
| PATCH | `orders/:id/service` `weights` `address` `dimensions` | write/read as coded | REUSE / ADAPT address vs Shopify source |
| POST | `orders` | orders.write | WRAP (manual) |
| POST | `orders/bulk/status` | shipments.write | **REUSE DIRECTLY** |
| POST | `orders/:id/shopify-payment` | orders.write | ADAPT |
| POST | `bookings/validate` `queue` `excel` | shipments.write | **REUSE DIRECTLY** |
| GET | `bookings/summary` | shipments.read | REUSE |
| GET/POST | `ndr-rto*` | shipments.* | REUSE |
| GET/POST | `shipments` | shipments.* | **REUSE DIRECTLY** |
| GET | `shipments/:id` | read | REUSE |
| POST | `shipments/:id/retry` `india-post-label` | write | REUSE |
| PATCH | `shipments/:id` | as coded | REUSE |
| GET | `labels` `labels/:id/download` `latest` slips | labels.read | **REUSE DIRECTLY** |
| POST | `labels/bulk-download` `bulk-print` `labels/:id/india-post` | labels.* | REUSE |
| GET/POST | `manifests` | manifests.* | REUSE |
| GET | `tracking` | tracking.read | **REUSE DIRECTLY** |
| * | `orders/customer-links*` `whatsapp-*` `ai-credits*` | mixed | DEPRECATE / UNKNOWN for MVP |

Tariff (`tariff.ts`): `india-post/tariff-capabilities`, `tariff-quotes`, `orders/:id/tariff-quote` — REUSE if flag on.

---

## 4. Integrations (`lib/api/v1/integrations.ts`)

India Post GET/PUT/PATCH/DELETE, offices, verify, barcode-range, contracts, office, parcel-defaults, default-service — **REUSE DIRECTLY**.

Shopify GET/POST/connect/callback/sync — **ADAPT** (Partner app + managed install). Sync POST **REUSE**.

Wati/Vachat — UNKNOWN / F for MVP.

---

## 5. Workspace, billing, print, labels, invoices, inventory, support

| Area | File | Shopify |
|------|------|---------|
| automation, members, settings, audit, api-keys, merchant webhooks | `workspace.ts` | WRAP settings/automation; DEPRECATE api-keys in Shopify app |
| Razorpay subscribe/cancel/usage | `billing.ts` | **DEPRECATE for App Store charges**; REUSE quota reads |
| Addons / AI accountant | `addons.ts` `ai-accountant.ts` | UNKNOWN / F |
| Support | `support.ts` | WRAP optional |
| Table layouts | `ui.ts` | WRAP |
| Presets | `shipment-presets.ts` | REUSE |
| Print station / devices | `print.ts` `print-devices.ts` | REUSE (pairing may leave iframe) |
| Label templates | `label-template.ts` | REUSE |
| Invoices | `invoices.ts` | REUSE |
| Inventory / AI image / storefront | `inventory.ts` | DEPRECATE for Shopify merchants |
| Tutorials | `tutorials.ts` | WRAP |

---

## 6. Dedicated routes outside catch-all

| Path | Auth | Shopify |
|------|------|---------|
| `POST /api/v1/auth/register` | public | REPLACE |
| `GET /api/v1/auth/pincode` | public | REUSE |
| tracking-pages* | tenant | WRAP |
| `GET /api/v1/public/track` | public | REUSE (customers, not Admin) |
| public order-links / store | public | DEPRECATE vs Shopify checkout |
| print-agent updater | public | REUSE |
| `POST /api/auth/otp/*` | public | REPLACE for embedded |
| `POST /api/webhooks/razorpay` | webhook | REUSE SaaS only |
| `POST /api/cron/jobs` `billing` | cron | REUSE |
| `GET /api/health` | public | REUSE |
| `/api/admin/*` | admin | **DEPRECATE for merchant app** |
| `/api/partner/*` | partner | DEPRECATE |
| `/api/merchant/v1/*` | apikey | WRAP if Partners call PostBus from other systems; **not** the embedded UI |

Merchant API (`modules/merchant-api/handle.ts`): `/me`, `/orders`, `/orders/bulk`, `/orders/:id`, `PATCH`, `POST book`, `/shipments*`, `/webhook-subscriptions*`. Scopes in `scopes.ts`.

---

## 7. Error handling

`lib/api/errors.ts` `AppError` + `ERROR_CODES` (AUTH, FORBIDDEN, RATE_LIMITED, …). Shopify BFF should map 401 + `X-Shopify-Retry-Invalid-Session-Request` for stale ID tokens (Shopify docs **VERIFIED**).

---

## 8. What not to duplicate

Booking, tracking apply, fulfillment `fulfillShopifyShipment`, quota `consume_order_quota`, barcode allocate, label PDF compose — already centralized. Shopify UI must call these services, not reimplement.
