# PostBus Merchant Public API — Phase 0 Audit

Read-only audit of the production codebase (`.worktrees` excluded). Findings are classified as **EXISTING**, **REUSABLE**, **NEEDS MODIFICATION**, **NEW IMPLEMENTATION REQUIRED**, or **BLOCKED / UNVERIFIED**. No endpoint or column is claimed unless it appears in migrations or source.

This document does not claim production deployment of the Merchant API.

---

## 1. Existing architecture summary

PostBus is a multi-tenant Next.js SaaS. Merchants sign in with Supabase Auth (email/password; optional WhatsApp OTP). The active tenant is `profiles.active_organization_id` plus a matching `organization_members` row. Dashboard and most HTTP APIs run through `/api/v1/*`, dispatched by `handleV1`. That surface is **session-authenticated** and includes billing, members, Shopify, India Post credentials, and automation. It is **not** a merchant-safe public API.

India Post booking, tracking, and labels are implemented as server modules plus `background_jobs`. Shopify ingestion is a separate path (`upsertShopifyOrder`) with its own automation flags.

API keys (`pb_live_…`) can already be **created** and **revoked** over the session API. Nothing authenticates inbound requests with those keys.

---

## 2. Actual technology stack

| Layer | Verified |
|---|---|
| App | Next.js `16.3.8`, React `19.2.8`, TypeScript, Zod `4` |
| Auth | `@supabase/ssr` + `@supabase/supabase-js`; cookie session; optional WhatsApp OTP |
| Database | PostgreSQL via Supabase; migrations in `supabase/migrations/` |
| UI | Tailwind CSS 4, Radix UI, lucide-react, sonner, tanstack query/table |
| Jobs | `background_jobs` table + `workers/`; optional BullMQ/`ioredis` when `jobRunner === "redis"` |
| India Post | `modules/india-post/*` (booking, tracking, labels, webhook) |
| Shopify | `modules/shopify/*` |
| Payments | Razorpay (billing), not used as merchant API auth |
| Tests | Vitest |

Clerk is **not** present.

---

## 3. Existing endpoint inventory

### 3.1 Internal / dashboard (`/api/v1/[...slug]` → `handleV1`)

Auth: Supabase session cookie via `requireTenant`. Rate limit: in-memory 60/min (180 for some webhook/print paths).

Commerce (non-exhaustive, from `lib/api/v1/commerce.ts` and related handlers):

- `GET/POST /api/v1/orders`, `GET /api/v1/orders/:id`
- `PATCH` order address / weights / service (session)
- `POST /api/v1/orders` may call `createShipmentsForOrders` when `createShipment: true`
- `GET/POST /api/v1/shipments`, booking validate/queue/excel
- Label download routes under `/api/v1/labels/...`

Workspace:

- `GET/POST /api/v1/api-keys`, `DELETE /api/v1/api-keys/:id` — **session only**; create returns `secret` once
- `GET/POST /api/v1/webhooks`
- Organizations, members, automation, audit-logs, settings

Integrations, billing, support, print-agent, VaChat MCP, inbound India Post/Shopify webhooks, and public storefront/track routes also live under `/api/v1` or `/api/v1/public/*`. **Do not expose these as the Merchant API.**

### 3.2 Super Admin

`/api/admin/[...slug]` → `requirePlatformAdmin()` (`platform_admins` + optional `PLATFORM_ADMIN_EMAIL` bootstrap).

### 3.3 Public unauthenticated

Examples: `/api/v1/public/track`, storefront, order-links, print-agent updater. These are **not** org API-key surfaces.

### 3.4 Merchant API key auth on inbound HTTP

**NEW IMPLEMENTATION REQUIRED.** `secret_hash` is written; no verify path exists for `Authorization: Bearer`.

---

## 4. Existing database schema references

### Identity / tenancy (`20260919090000_init_enums_identity.sql` and later)

- `profiles` (`id`, `email`, `full_name`, `active_organization_id`, later WhatsApp/pincode fields)
- `organizations` (`id`, `name`, `slug`, `timezone`, `currency`, `created_by`; later `account_status` `ACTIVE|SUSPENDED|DISABLED|BLOCKED|HOLD`, label identity)
- `organization_members` (`organization_id`, `user_id`, `role` `OWNER|ADMIN|MANAGER|OPERATOR|VIEWER`)
- `platform_admins`

### Commerce (`20260919090100_commerce_shipping.sql` + later)

- `orders`: `id`, `organization_id`, `source` (`SHOPIFY|MANUAL|API|WOOCOMMERCE` + later `WHATSAPP`), `source_order_id`, `order_number`, customer/address FKs, money, `payment_status`, `fulfillment_status`, `status`, `metadata`, timestamps; later COD/weight/tariff columns
- Unique: `(organization_id, order_number)`, `(id, organization_id)`
- `order_status`: `IMPORTED|READY|PROCESSING|BOOKED|SHIPPED|IN_TRANSIT|DELIVERED|FAILED|CANCELLED`
- `external_order_references`: unique `(organization_id, source, source_order_id)`
- `customers`, `addresses`, `order_line_items`
- `shipments`: `barcode`, `tracking_number`, status, dims, COD, operational/tracking columns, unique barcode per org when not null
- `tracking_events`
- `labels`

### Integrations (`20260919090200_integrations_platform.sql`)

- `api_keys`: `id`, `organization_id`, `name`, `key_prefix`, `secret_hash`, `status` (`ACTIVE|REVOKED`), `last_used_at`, `created_by`, timestamps. **No scopes, lookup_id, expiry, or hash_version today.**
- `idempotency_keys`: `organization_id`, `key`, `request_hash`, `response`, unique `(organization_id, key)`
- `webhook_endpoints`, `webhook_deliveries`
- `audit_logs`, `background_jobs`
- `automation_settings.auto_booking` default **false**

### RLS

Tenant `is_org_member` / `has_org_role`. `api_keys` read/write: **OWNER and ADMIN only** (`20260920190000_role_aware_rls_and_webhook_secrets.sql`). Service-role client `createAdminClient()` bypasses RLS.

---

## 5. Reusable services

| Capability | Entry | Class |
|---|---|---|
| Session tenant | `requireTenant` | EXISTING / REUSABLE |
| RBAC | `lib/permissions/rbac.ts`; `api_keys.manage` = OWNER/ADMIN | EXISTING / REUSABLE |
| Create order | `createManualOrder` | REUSABLE (do not pass `createShipment`) |
| List/get order | `listOrders`, `getOrder` | REUSABLE |
| Update pre-book | `updateOrderShippingAddress`, `updateOrderWeights` | REUSABLE |
| Book | `createShipmentsForOrders` → jobs → `runIndiaPostBooking` | REUSABLE (`runBookingNow: false` on public path) |
| List/get shipment | `listShipments`, `getShipment` | REUSABLE |
| Tracking apply | `applyIndiaPostTracking`; enqueue `enqueueOrgTrackingSyncIfIdle` | REUSABLE |
| Tracking URL | `buildPostBusTrackingUrl` | REUSABLE |
| Labels | `loadLabelPdfBytes`, official generate/store | REUSABLE |
| Key hashing | `hashSecret` (SHA-256), `hmacSha256`, `randomToken`, `safeEqual` | REUSABLE / HMAC for **new** keys |
| Envelope | `lib/api/response.ts` for dashboard | EXISTING (public API uses a separate envelope) |

---

## 6. Missing functionality

| Gap | Class |
|---|---|
| Bearer API-key auth for merchants | NEW IMPLEMENTATION REQUIRED |
| Key scopes, expiry, rotate, lookup_id, HMAC hash version | NEW IMPLEMENTATION REQUIRED |
| Developer Portal UI | NEW IMPLEMENTATION REQUIRED |
| Curated public DTOs / OpenAPI | NEW IMPLEMENTATION REQUIRED |
| `createManualOrder` writing `source_order_id` / `external_order_references` | NEEDS MODIFICATION (wrapper, not rewrite) |
| General idempotency on order create | NEEDS MODIFICATION (reuse `idempotency_keys`) |
| Order CSV/bulk import | NEW (Excel bulk is India Post booking workbook, not commerce CSV) |
| Cursor pagination `updated_since` | NEW (list is page/offset today) |
| Distributed rate limits | NEEDS MODIFICATION (in-memory today) |
| Merchant request logs (no PII payloads) | NEW IMPLEMENTATION REQUIRED |
| Google Apps Script / AI prompt artifacts | NEW IMPLEMENTATION REQUIRED |

---

## 7. Security risks

| Risk | Class | Disposition |
|---|---|---|
| Session `/api/v1` includes India Post, billing, members | EXISTING | Isolate Merchant API; never Bearer-auth `handleV1` |
| Unsalted SHA-256 `hashSecret` on existing keys | EXISTING | New keys HMAC; legacy keys cannot call Merchant API |
| Service-role bypasses RLS | EXISTING | Explicit `organization_id` filters on every query |
| In-memory rate limit not multi-instance | EXISTING | Postgres counters for Merchant API |
| Outbound `deliverWebhooks` has no SSRF URL block | EXISTING | **Do not extend webhooks in v1** |
| `createManualOrder` can surface Postgres `error.message` | EXISTING | Map to generic public errors |
| `POST /api/v1/orders` can book in the same request | EXISTING | Public create never sets `createShipment` |
| Public tracking RPCs are unauthenticated by AWB | EXISTING | Merchant tracking still org-scoped by shipment id + key |

No **BLOCKED** auth primitive: session, tenancy, booking locks, and barcode uniqueness already exist.

---

## 8. Tenant isolation risks

- `requireTenant` does not read `organization_id` from the client. **REUSABLE pattern for public API: org comes only from the key.**
- Dashboard queries already `.eq("organization_id", ctx.organizationId)`. **REUSABLE.**
- Service-role usage without org filter would be a cross-tenant leak. **Must enforce in Merchant API code and tests.**
- `public_find_shipment_global` is for the public track page, not org APIs. **Do not reuse for Merchant tracking.**

---

## 9. Recommended API architecture

Dedicated `/api/merchant/v1/*` catch-all. Pipeline: API key auth → org status → scope → validation → Postgres rate limit → idempotency → existing services → standard merchant envelope.

Do not HTTP-call `/api/v1`. Do not use India Post or Supabase service-role keys as merchant credentials. Source for created orders: existing enum value `API`.

---

## 10. Proposed database changes (additive)

- `api_keys`: `scopes text[]`, `lookup_id text`, `hash_version text`, `expires_at`, `revoked_at`; unique `lookup_id`
- `idempotency_keys`: `operation`, `processing_state`, `expires_at`
- `merchant_api_request_logs`, `merchant_api_rate_buckets` + consume RPC
- Index `orders (organization_id, updated_at, id)` if missing

Do **not** execute against production as part of development.

---

## 11. Implementation phases

Matches the approved plan: audit (this file) → contract + keys → read APIs → create/bulk → booking → tracking/labels → Developer Portal → OpenAPI/docs/Apps Script → tests → staging docs. Webhooks deferred.

---

## 12. Backward compatibility

- `/api/v1` session contract unchanged except optional fields on `POST /api/v1/api-keys` (scopes) for the portal
- Existing `api_keys` rows without `lookup_id`/`scopes`/`hash_version=hmac-v1` cannot call Merchant API
- Order/shipment/booking worker behavior unchanged
- Shopify automation unchanged; `API` source does not go through `upsertShopifyOrder`
- `auto_booking` remains Shopify-path; public create does not auto-book

---

## 13. Production deployment risks

- Applying migrations without review
- Accidental `runBookingNow: true` on the public book path (would call CEPT on the HTTP request)
- Logging Authorization headers or request bodies with PII
- Treating cached tracking as live India Post confirmation
- Enabling outbound webhooks without SSRF controls
- Multi-instance rate limits if someone reused in-memory `rateLimit` for the public API

**Classification of this audit:** completed read-only. Implementation proceeds as isolated, backward-compatible development. No production migrate/deploy in this workstream.
