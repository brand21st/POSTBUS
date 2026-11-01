# PostBus Shopify App Test Plan

**Date:** 2026-10-20  
**Do not** run destructive tests against production. Use Shopify **dev stores**, CEPT **UAT**, Razorpay **test** only if touching SaaS billing (Shopify path should not).

Existing tests to **keep green:** `modules/india-post/**/*.test.ts` (large suite), `modules/shopify/*.test.ts` (5 files), billing, merchant-api, booking-idempotency.

---

## 1. Layers

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest | JWT claims, tenant wrapper, HMAC timing-safe, mapping |
| Integration | Vitest + PGlite (existing `*.pg.test.ts` pattern) | RLS, allocate barcode, quota, provision org |
| API contract | Vitest | `/api/shopify/v1` status codes |
| E2E | Playwright + Shopify CLI / dev store | Install, orders, book UAT |
| Load | k6/optional | **NOT MEASURED** today; add after beta |
| App Store | Manual + Shopify automated session check | 1.1.1 |

---

## 2. Positive cases

- Install → org created → Home setup guide  
- Reinstall same shop reconnects same org  
- ID token happy path lists **only** that org’s orders  
- Webhook `orders/create` upserts; unique source id  
- Bulk book 10 READY orders → jobs → UAT book **or** stub  
- Label download 200 PDF  
- Tracking event applied in rank order  
- Fulfillment GraphQL called when `auto_shopify_fulfillment`  
- Uninstall → token null, sync stops  
- App Pricing grant → quota allows book  

---

## 3. Negative / failure injection

| Scenario | Expected |
|----------|----------|
| Shopify authorization fails | No org; error page; no email user created |
| ID token expired | 401 + `X-Shopify-Retry-Invalid-Session-Request` |
| Shopify 429 | Job retry `RATE_LIMITED` (`lib/jobs/retry.ts`) |
| CEPT timeout after POST | `RECOVERY_REQUIRED`; **no second POST** |
| CEPT response lost | Reconcile via track; `canRetryCeptPostAfterUnknown` false |
| Duplicate order webhook | Idempotent upsert |
| Duplicate tracking webhook | Deduped events |
| Label generation fail | Shipment booked; label retry job |
| Fulfillment update fail | Booking remains; job retries; no re-book |
| Subscription expired | `assertPlanFeature` / quota deny; no CEPT |
| Uninstall mid-job | Jobs fail auth; no CEPT with revoked token |
| Reinstall | New token; historical shipments visible |
| Two users book same order | One shipment; second skip (`createShipmentsForOrders`) |
| Cross-tenant order UUID | 404 |
| Email of org A + shop of org B | Link **rejected** |
| `auto_shopify_sync=false` | Webhook skip |
| Disable auto-book with queued jobs | Queued jobs **still run** (document + assert) |
| Header select-all pagination | Selection model tests (must not wipe other pages) |
| HMAC invalid | 401 webhook |
| GDPR redact | Compliance job queued; **REQUIRES** policy |

---

## 4. Billing tests

- No Razorpay checkout in `/shopify`  
- Entitlement from Shopify provider satisfies `consume_order_quota`  
- Dual provider: cannot decrement twice for one book  
- Decline charge / reinstall resubscribe (App Store 1.2.2)

---

## 5. Browser / device

Chrome incognito iframe (session tokens). Safari. Shopify Mobile `print()`. Desktop PDF print. **USB:** agent tests on Windows separately (`print-agent-desktop`).

---

## 6. Regression

Full `npm test` + `npm run typecheck`. Do not skip hooks. Staging isolation tests (`lib/env/staging-isolation.test.ts`, CEPT URL assert) stay mandatory.

---

## 7. Environments

| Env | Shopify | CEPT | DB |
|-----|---------|------|-----|
| Local | Dev store | stub / UAT | local supabase |
| Staging | Dev/custom | UAT only (`environment.ts`) | staging project |
| Prod | Real | PROD contracts | prod — **beta allowlist** |
