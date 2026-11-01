# PostBus Shopify Integration Audit

**Status:** READ-ONLY  
**Date:** 2026-10-20  
**Shopify docs consulted:** Authentication (`shopify.dev` ID tokens / token exchange), App Store self-review requirements, billing, App Home v1.1 Print API, Admin UI extensions 2026-07.

---

## Verdict

Current integration is a **merchant-supplied custom-app connector** for the **external PostBus dashboard**. It is **not** an embedded public app.

Maturity for **SaaS order import + fulfillment write-back:** **PARTIALLY VERIFIED** production-capable (HMAC, encrypted tokens, jobs, tests).  
Maturity for **Shopify App Store embedded app:** **Not started** in code.

---

## 1. Connection model (**VERIFIED**)

| Step | Evidence |
|------|----------|
| UI | `app/dashboard/integrations/shopify/shopify-client.tsx` — paste Client ID/secret |
| Persist | `lib/api/v1/integrations.ts` `POST integrations/shopify` — `client_id` plaintext, secret encrypted |
| OAuth URL | `modules/shopify/oauth.ts` `shopifyInstallUrl()` → `/admin/oauth/authorize` |
| Callback | `GET integrations/shopify/callback` — HMAC query, state cookie `pb_shopify_oauth_state` (`safeEqual`) |
| Token | `exchangeShopifyToken()` → `encrypted_access_token` |
| Fallback | `resolveShopifyAdminToken()` can use **client_credentials** if no decryptable access token |
| Platform env | `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SHOPIFY_SCOPES` / `SHOPIFY_APP_URL` in `lib/env.ts` — optional fallback; `SHOPIFY_APP_URL` **unused** in embedded sense |

`shopify_connections` is the credential row. `shopify_stores` is ancillary.

---

## 2. Scopes (**VERIFIED**)

Default (`lib/env.ts`):

```
read_orders,write_orders,read_products,read_fulfillments,write_fulfillments,
read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,
read_locations
```

`.env.example` omits `read_products`; code default **includes** it. Product REST `products.json` is used for line-item images/shipping (`modules/shopify/orders.ts` ~2503).

**Proposed minimum for public app (do not inflate):**

| Scope | Why |
|-------|-----|
| `read_orders` | Sync orders (PCD: customer address/phone/email) |
| `write_orders` | Stage tags (`postbus-processing|booked|…`) |
| `read_products` | Variant/weight/image enrichment |
| `read_fulfillments` / `write_fulfillments` | Tracking write-back |
| `read_merchant_managed_fulfillment_orders` / `write_merchant_managed_fulfillment_orders` | `fulfillmentCreate` path |
| `read_locations` | Fulfillment location |

**Do not request** payment gateway, theme, or marketplace scopes.  
**REQUIRES EXTERNAL VALIDATION:** Protected customer data (PCD) approval for public apps.

---

## 3. APIs and versions (**VERIFIED**)

| API | Constant | Use |
|-----|----------|-----|
| REST Admin | `SHOPIFY_API_VERSION = "2025-01"` | Orders list/fetch, products, webhook CRUD, fulfillment fallback |
| GraphQL Admin | `SHOPIFY_GRAPHQL_API_VERSION = "2026-04"` | `fulfillmentCreate`, tracking updates, tags, progress |

REST 2025-01 vs GraphQL 2026-04 split is **intentional in code**. For a new public app, **standardize on a single current GraphQL version** (REQUIRES EXTERNAL VALIDATION of Partner app config at build time). REST orders list is not inherently “deprecated” but GraphQL-first is Shopify’s current direction.

Rate limit: `modules/shopify/http.ts` — 20s timeout, 429 throws `RATE_LIMITED`; **no in-request Retry-After sleep**. Jobs retry via `lib/jobs/retry.ts`.

---

## 4. Webhooks (**VERIFIED**)

Registered topics (`ORDER_WEBHOOK_TOPICS`):

- `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`
- `fulfillment_orders/progress_reported`

Inbound: `POST /api/v1/webhooks/shopify` — HMAC `X-Shopify-Hmac-Sha256`, secret cascade (org, previous, platform env).

Idempotency: insert into `idempotency_keys` **before** processing. Failed handling after insert → Shopify retry treated as duplicate. **HIGH** reliability issue for embedded/public app (existing plan Phase 3).

**Missing (App Store):**

- Register **`app/uninstalled`** (handler exists if topic arrives; **not in registration list**)
- GDPR: `customers/data_request`, `customers/redact`, `shop/redact`
- `app_subscriptions/update` if using Billing API / need subscription sync

Registration skipped when webhook URL is not HTTPS or contains `localhost`.

---

## 5. Order sync and fulfillment (**VERIFIED**)

- Pull: `syncUnfulfilledShopifyOrders` — REST `orders.json?status=open&fulfillment_status=unshipped`
- Push: webhooks → `importShopifyWebhookOrder` → `upsertShopifyOrder`
- Dedupe: `external_order_references` + unique `(organization_id, source, source_order_id)`
- `auto_shopify_sync` false → webhook import skipped
- Fulfillment job `shopify-fulfillment` gated by `auto_shopify_fulfillment`
- Tracking payload: company `PostBus`, number = AWB, URL must start with `https://www.postbus.in/track` (`shopifyTrackingInfo`)

**Limitation:** Staging cannot write tracking URLs to Shopify.

---

## 6. Install / uninstall / reinstall

| Event | Today |
|-------|-------|
| Install | Merchant-driven OAuth from dashboard |
| Uninstall | Handler clears token if `app/uninstalled` received; **topic not registered** |
| Reinstall | Relies on connect flow; no Partner managed install |
| Token rotation | `encrypted_previous_client_secret` for HMAC; no expiring offline token refresh |

Shopify now requires **expiring offline access tokens** for new public apps calling GraphQL Admin API (`expiring=1`; refresh token). Current `exchangeShopifyToken` is authorization-code oriented. **ADAPT required.**

---

## 7. Embedded app gaps (App Store self-review)

From live requirements (2026-10-20 fetch):

| Req | PostBus |
|-----|---------|
| 1.1.1 Session / ID tokens | **Fail** — cookie Supabase auth; CSP blocks iframe |
| 1.1.2 Shopify checkout | **Likely pass** if app does not add offsite checkout. Existing WhatsApp/order-link/storefront **must stay out of the listed app** or they risk 1.1.2 / marketplace rules |
| 1.2.1 Shopify billing | **Fail** if App Store lists paid plans while Razorpay remains the charge path |
| 2.2.1 Use Shopify APIs | Connector uses APIs; listing a “configure custom app keys” UX is **discouraged** for public apps |
| 2.2.3 Latest App Bridge | **Fail** — no `app-bridge.js` |
| GDPR webhooks | **Fail** for public distribution |

`frame-ancestors 'none'` and `X-Frame-Options: DENY` (`lib/security/headers.ts` L69, L93) **block** Admin iframe. Must path-scope exceptions for `/shopify/*` to `https://admin.shopify.com https://*.myshopify.com` (**VERIFIED** current deny-all).

---

## 8. Dual distribution recommendation

**VERIFIED need:** Existing merchants already connected via BYO credentials.

**PROPOSAL:**

1. New **single Partner app** (platform `SHOPIFY_API_KEY`) for App Store / embedded.
2. Keep `shopify_connections` BYO path for current dashboard merchants until migrated.
3. Do **not** auto-merge orgs by email.
4. Shop domain remains globally unique (`shopify_connections_one_per_shop`).

---

## 9. Admin extensions (optional, not MVP core)

Shopify Admin UI extensions (API **2026-07** default in toolkit):

- **Admin action** — order More actions / bulk: “Book with India Post”
- **Admin block** — order detail card (merchant must pin)
- **Admin print action** — Print menu on orders (preview + print PDF)
- **Admin link** — jump into embedded app workspace

Main shipping workspace should remain **iframe App Home**, not an extension-only app (India Post, jobs, and PDFs need PostBus backend).
