# Shopify Concurrent Sync Test Results

**Date:** 2026-11-01

## Architecture

`refreshShopifyLineItems` now calls `public.replace_shopify_order_line_items` instead of a client-side DELETE then INSERT.

Serialization: `SELECT … FOR UPDATE` on the organization-owned order row, plus a **per-order** advisory xact lock. No global lock.

Stale protection: compare `p_source_updated_at` to `orders.metadata.shopifyPayment.updatedAt`. Older Shopify `updated_at` returns `skipped_stale` without mutating lines.

App-level: `isShopifyPaymentPayloadStale` now **skips the entire existing-order update** (not only payment fields).

## Results

| Test | Layer | Result |
|---|---|---|
| C1 sequential identical replace | PGlite **INTEGRATION PASS** + staging **STAGING PASS** | One active set |
| C2 concurrent identical | PGlite **INTEGRATION PASS** (single backend serializes). Two-connection Postgres overlap **NOT EXECUTED** | One set after Promise.all |
| C3 webhook + sync overlap | Same RPC; **UNIT** mock sequential **PASS**. True dual-connection **NOT EXECUTED** | — |
| C4 old snapshot vs new | PGlite **INTEGRATION PASS**; staging **STAGING PASS** `skipped_stale` | Deposit not stored |
| C5 invalid payload | PGlite **INTEGRATION PASS** empty title raises; prior rows remain | Atomic |
| C6 two orders same org | PGlite **INTEGRATION PASS** | Independent |
| C7 two tenants | PGlite **INTEGRATION PASS** org B cannot replace org A order | Exception `order not found` |
| C8 same SKU two GIDs | PGlite **INTEGRATION PASS**; staging **STAGING PASS** | Two rows |
| C9 currentQuantity 0 / qty 0 | PGlite **INTEGRATION PASS** reject; unit selector **PASS** | Never inserted |
| C10 locked shipment | PGlite **INTEGRATION PASS** `skipped_locked` | No line rewrite |

Command: `npx vitest run modules/shopify/replace-line-items.pg.test.ts` — **9 PASS**.

## Residual

True two-session overlap on staging Postgres was not launched as two `psql` clients in parallel. PGlite Promise.all is serialized on one connection. Residual risk: **POSSIBLE** hash collision on advisory lock (still serialized by `FOR UPDATE` on the order row).
