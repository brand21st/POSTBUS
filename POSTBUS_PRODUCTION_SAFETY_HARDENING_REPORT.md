# PostBus Production Safety Hardening Report

**Date:** 2026-11-01  
**Scope:** Local implementation + isolated staging Postgres (`127.0.0.1:55432`).  
**Not done:** production deploy, production migration, Shopify mutations, India Post live booking, historical repair, git commit/push.

## Executive summary

The `currentQuantity` import fix is unchanged. This round added:

1. Additive RPC `replace_shopify_order_line_items` for atomic per-order line replace, stale snapshot skip, and locked-shipment skip.
2. Freeze of operational money (`total_amount`, `amount_paid`, `cod_amount`, subtotal/tax/shipping/discount) when a booking snapshot is locked, while still allowing payment/fulfillment status updates and an audit reconciliation object.
3. Isolated staging schema + real RPC writes proving two active same-SKU lines and stale deposit rejection.

**Verdict: BLOCKED — ADDITIONAL VALIDATION REQUIRED**

Remaining: production schema still missing columns until an approved migrate; Next.js `:3001` / PostgREST `:54321` / live Shopify HTTP E2E were not run.

## Changes implemented

### Files

| Path | Function / object | Before | After | Tests |
|---|---|---|---|---|
| `supabase/migrations/20261101090000_replace_shopify_order_line_items.sql` | `replace_shopify_order_line_items` | n/a | Atomic replace, stale/locked skip, INVOKER | PGlite + staging SQL |
| `scripts/staging/shopify-compat.sql` | staging tables | n/a | Minimal orders/line items | staging apply |
| `scripts/staging/apply-shopify-compat.mjs` | apply + fixture | n/a | Isolated apply | staging |
| `modules/shopify/orders.ts` | `refreshShopifyLineItems` | DELETE+INSERT | RPC | orders.test, pg |
| `modules/shopify/orders.ts` | `upsertShopifyOrder` | Totals always written; stale skipped payment only | Stale skips all updates; locked freezes money; reconciliation metadata | orders.test |
| `modules/shopify/orders.ts` | `attachShopifyLockedReconciliation` | n/a | Audit Shopify vs locked total | orders.test |
| `modules/shopify/payment.test.ts` | collectable cases | partial fixture | + ₹1049/₹734.30, auth, refund, zero outstanding | payment.test |
| `modules/shopify/replace-line-items.pg.test.ts` | C1–C10 | n/a | PGlite | 9 PASS |
| `modules/shopify/line-items.ts` | selector | unchanged | unchanged | line-items.test |

Unrelated working-tree files were not rewritten.

## Database migrations created or used

- **Used as-is:** `20261029120001_shopify_fulfillment_eligibility.sql` (not applied on production; not fully applied on slim staging).
- **Created:** `20261101090000_replace_shopify_order_line_items.sql` — applied on **staging only**.

## Staging setup

`npm run staging:up` — isolated `postbus_staging` on 55432. Production ref not used. App `:3001` and API `:54321` down.

## Schema verification

Staging after apply: three columns **present**, RPC **present**. Production still **missing** those columns (do not apply until approved).

## Concurrency / stale snapshots

See `SHOPIFY_CONCURRENT_SYNC_TEST_RESULTS.md`. Shopify `updated_at` vs stored `shopifyPayment.updatedAt` is the version, not webhook arrival time.

## Booked orders

See `SHOPIFY_BOOKED_ORDER_PROTECTION.md`.

## Payment / COD

PARTIAL remains `current_total − outstanding`. ₹1049 / ₹734.30 / ₹314.70 **UNIT PASS**. Transaction-sum accounting not implemented (documented, not silently changed).

## Shopify regression

Unit REST/GraphQL/selector tests **PASS** (106 including PGlite). Live shops **NOT EXECUTED**.

## India Post mock

No CEPT calls. Weight still uses existing parcel helpers; RPC does not zero weight. Booking lock prevents line rewrite.

## Invoices

`createSalesInvoiceFromOrder` still returns existing non-cancelled invoices. New invoices would use stored (now filtered) lines. Staging invoice E2E **NOT EXECUTED**.

## Multi-tenant

RPC requires matching `organization_id` + `order_id`. PGlite C7 **PASS**.

## Performance

Per-order lock only. No extra Shopify HTTP beyond existing refresh rules. No load benchmark.

## Tests executed

| Command | Result |
|---|---|
| `npx vitest run` Shopify line-items, payment, graphql, orders, replace-line-items.pg (`--maxWorkers=1`) | **106 PASS** |
| `npm run typecheck` | **PASS** (~220s) |
| `npx eslint` on touched Shopify files | **PASS** (exit 0; ReadLints clean) |
| Full `npm test` | **NOT EXECUTED** |
| `npm run staging:up` | **PASS** |
| `node scripts/staging/apply-shopify-compat.mjs` | **PASS** |

## Remaining risks / blockers

**P0:** Production still lacks columns; do not deploy app first.  
**P0:** No PostgREST/Next staging E2E of webhook import.  
**P1:** Dual-connection overlap on real Postgres not executed (PGlite serializes).  
**P1:** Unbooked historical PARTIAL orders will change on next sync after deploy.

## Production readiness gates

| Gate | Result |
|---|---|
| 1 Root cause fixed | **PASS** (unit) |
| 2 Deposit excluded | **PASS** unit + staging RPC |
| 3 Active products preserved | **PASS** |
| 4 Current totals | **PASS** unit |
| 5 Partial COD | **PASS** unit |
| 6 Migration tested | **PASS** staging; production **NOT applied** |
| 7 App/schema compatibility | **PASS** staging; production **FAIL** until migrate |
| 8 Staging isolated | **PASS** (Postgres) |
| 9 Staging E2E | **BLOCKED** (no :3001 Shopify HTTP) |
| 10 Concurrent sync | **PASS** PGlite; dual-session **NOT VERIFIED** |
| 11 Old snapshots | **PASS** |
| 12 Booked shipment | **PASS** unit/PGlite |
| 13 AWBs | **PASS** unit; live **NOT VERIFIED** |
| 14 New invoices | **NOT VERIFIED** |
| 15 Existing invoices | **PASS** code |
| 16 Fully paid | **PASS** unit |
| 17 Normal COD | **PASS** unit |
| 18 Multi-tenant | **PASS** PGlite |
| 19 Rate limits | **NOT VERIFIED** (no extra fetch on complete PARTIAL) |
| 20 Rollback plan | **PASS** (runbook) |
| 21 TypeScript | **PASS** |
| 22 Automated tests | **PASS** (106) |
| 23 No production changes | **PASS** |

## Rollback

Redeploy previous app. Leave additive columns/function in place. See `POSTBUS_PRODUCTION_DEPLOYMENT_RUNBOOK.md`.

## Final recommendation

Do **not** deploy to production until:

1. Approved production apply of the additive migration(s) + PostgREST reload.
2. Optional but strongly recommended: one Shopify **dev-store** import on an isolated app pointed at a non-production database.

Companion reports: `DATABASE_COMPATIBILITY_VALIDATION.md`, `SHOPIFY_CONCURRENT_SYNC_TEST_RESULTS.md`, `SHOPIFY_BOOKED_ORDER_PROTECTION.md`, `STAGING_INTEGRATION_TEST_RESULTS.md`, `HISTORICAL_SHOPIFY_ORDER_IMPACT.md`, `POSTBUS_PRODUCTION_DEPLOYMENT_RUNBOOK.md`.
