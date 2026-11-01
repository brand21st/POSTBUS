# Shopify Partial Payment Line-Item Fix — Implementation Report

**Project:** PostBus — India Post Shipping Automation SaaS  
**Date:** 2026-10-31  
**Scope:** Local implementation only. No production deploy, no production database writes, no Shopify mutations, no historical order repair, no commit, no push.  
**API versions in code:** REST `2025-01`; GraphQL Admin `2026-04`.

---

## 1. Executive Summary

The confirmed defect is that PostBus imported Shopify line items using original `quantity > 0`. On edited deposit / partial-COD orders, Shopify keeps the original LineItem ID with `currentQuantity = 0` and adds a new LineItem ID for the replacement product. PostBus stored both, so removed deposit lines appeared as products.

The local fix:

- Imports **only** lines with REST `current_quantity` / GraphQL `currentQuantity` **> 0**.
- Uses Shopify LineItem GID as identity. Does **not** merge by title, SKU, product, or variant.
- Maps operational order amount from `current_total_price` / `currentTotalPriceSet`.
- Computes PARTIAL `amount_paid` as **current total − outstanding**, not original total − outstanding.
- Leaves COD (`outstanding`) unchanged for valid partial-payment samples.
- Skips new import and skips line overwrite when an **edited** order is missing current quantity.
- Does **not** rewrite booked India Post shipments, AWBs, or existing invoices.
- Does **not** repair the ~249 historical PARTIAL duplicates.

**Recommendation:** Land this locally, validate on staging, then deploy with a separate historical recovery process. This change is **not production-ready** until staging validation is executed.

---

## 2. Confirmed Root Cause

Shopify edited partial-payment orders contain multiple LineItem IDs for the same SKU:

| Line | `currentQuantity` | Role |
|---|---|---|
| Deposit LineItem A | 0 | Removed after order edit |
| Product LineItem B | 1 | Active replacement |

PostBus previously persisted every REST/GraphQL line with original `quantity > 0`, so A and B both became `order_line_items`. Operational `total_amount` came from original `total_price`, so PARTIAL `amount_paid = original_total − outstanding` overstated captured sales after edits.

Webhook races were **not** the primary cause. Shopify already returns both LineItem IDs.

---

## 3. Implementation Overview

Smallest shared change:

1. New selector `selectActiveShopifyLineItems()` used by REST webhooks, REST sync, and GraphQL-mapped remotes (all persist through `upsertShopifyOrder`).
2. GraphQL queries now request `edited`, `currentQuantity`, `currentTotalPriceSet`, `currentSubtotalPriceSet`, `currentTotalTaxSet`, `discountedUnitPriceSet`.
3. Payment mapping uses `shopifyOperationalOrderTotal()` (current total, else original).
4. Edited payloads missing current quantity: log `shopify.line_items.current_quantity_missing`, skip new import, skip line rewrite, skip money overwrite when current total is also absent. Custom OAuth webhooks re-read REST `GET /orders/{id}.json` when the snapshot is incomplete. App installs already re-read GraphQL.

No unique index on `source_line_item_id` (historical duplicates would fail). No production migration applied.

---

## 4. Files Modified

| Path | Role |
|---|---|
| `modules/shopify/line-items.ts` | **Added.** Shared current-quantity selector. |
| `modules/shopify/line-items.test.ts` | **Added.** Selector regressions. |
| `modules/shopify/payment.ts` | Current vs original totals; PARTIAL paid amount. |
| `modules/shopify/payment.test.ts` | Current-total `amount_paid` / COD case. |
| `modules/shopify/graphql/orders.ts` | GraphQL current fields and mapping. |
| `modules/shopify/graphql/orders.test.ts` | Current totals / discounted unit price. |
| `modules/shopify/orders.ts` | Filter at upsert; skip incomplete edited writes; operational totals; webhook re-read. |
| `modules/shopify/orders.test.ts` | Partial-COD import, skip paths, payment-evidence timeout. |
| `SHOPIFY_PARTIAL_PAYMENT_FIX_IMPLEMENTATION.md` | This report. |

Inspected, not rewritten: `modules/shopify/sync-job.ts`, `modules/shipments/service.ts`, `modules/sales-invoices/service.ts`, `lib/dashboard/records.ts`, `app/(site)/dashboard/orders/[id]/page.tsx`, `lib/api/v1/inbound-webhooks.ts`, `lib/shopify-app/webhooks.ts`, `supabase/migrations/20261029120001_shopify_fulfillment_eligibility.sql`.

---

## 5. Exact Functions Modified

| File | Function | Change | Reason | Tests |
|---|---|---|---|---|
| `modules/shopify/line-items.ts` | `shopifyCurrentQuantity` | Reads REST `current_quantity` or GraphQL `currentQuantity`. | Authoritative remaining qty. | `line-items.test.ts` |
| `modules/shopify/line-items.ts` | `shopifyOrderLooksEdited` | `edited`, `order-edited` tag, or mixed current qty 0 + >0. | Missing-qty fallback only for unedited orders. | `line-items.test.ts` |
| `modules/shopify/line-items.ts` | `selectActiveShopifyLineItems` | Keep `currentQuantity > 0`; skip write if edited and qty missing; GID identity. | Drop deposit lines; keep same-SKU active lines. | `line-items.test.ts`, `orders.test.ts` |
| `modules/shopify/line-items.ts` | `shopifyLineSnapshotNeedsRefresh` | True when edited + missing current qty. | Trigger REST re-read. | `line-items.test.ts` |
| `modules/shopify/payment.ts` | `shopifyOriginalOrderTotal` | `total_price`. | Preserve original. | `payment.test.ts` |
| `modules/shopify/payment.ts` | `shopifyCurrentOrderTotal` | `current_total_price` / `currentTotalPriceSet`. | Post-edit operational amount. | `payment.test.ts` |
| `modules/shopify/payment.ts` | `shopifyOperationalOrderTotal` | Current, else original, else 0. | Shared money base. | `payment.test.ts`, `orders.test.ts` |
| `modules/shopify/payment.ts` | `classifyShopifyRemotePayment` | Uses operational total; snapshot stores original + current. | Classification vs captured amount. | `payment.test.ts` |
| `modules/shopify/payment.ts` | `mapShopifyCollectable` | PARTIAL: `amount_paid = max(0, operationalTotal − outstanding)`; COD from outstanding. | Stop original_total − outstanding. | `payment.test.ts` |
| `modules/shopify/graphql/orders.ts` | `LINE_ITEM_FIELDS` / `ORDER_FIELDS` | Current qty/totals/tax, discounted unit price, `edited`. | GraphQL authority. | `graphql/orders.test.ts` |
| `modules/shopify/graphql/orders.ts` | `mapGraphqlLineItem` | Maps `current_quantity`; price = discounted ?? original. | Same remote shape as REST. | `graphql/orders.test.ts` |
| `modules/shopify/graphql/orders.ts` | `mapGraphqlOrder` | Maps current totals, `edited`. | Shared upsert. | `graphql/orders.test.ts` |
| `modules/shopify/orders.ts` | `attachShopifyTotals` | Writes `shopifyTotals` on metadata. | Audit original vs current. | `orders.test.ts` |
| `modules/shopify/orders.ts` | `shopifyLineItemRows` | `source_line_item_id` via GID (unchanged intent). | Stable identity when column exists. | `orders.test.ts` |
| `modules/shopify/orders.ts` | `upsertShopifyOrder` | Active-line selection; skip new import; skip line rewrite; skip money overwrite if current total also missing; persist operational totals. | Pipeline fix. | `orders.test.ts` |
| `modules/shopify/orders.ts` | `importShopifyWebhookOrder` | REST re-read if payment **or** line snapshot needs refresh. | Incomplete webhook payloads. | Existing webhook tests |

Unchanged by design: `refreshShopifyLineItems` still skip-rewrites when order/shipment is BOOKED/QUEUED (`SHOPIFY_WEIGHT_LOCKED_*`). Invoice `maybeEnqueueSalesInvoice` still only on new import / payment-confirmed; no historical invoice rewrite.

---

## 6. Before and After Behavior

| Scenario | Before | After |
|---|---|---|
| Edited partial COD: deposit qty 1 / current 0 + replacement current 1 | Two product rows | One product row (replacement GID) |
| Two active lines, same SKU | Both stored (correct) | Both stored (correct) |
| Unedited order, current qty omitted | Original quantity | Original quantity (allowed) |
| Edited order, current qty omitted | Original quantity → deposit imported | Skip new import / skip line overwrite |
| Operational total after edit | Original `total_price` (deposit included) | `current_total_price` |
| PARTIAL `amount_paid` | original − outstanding (inflated) | current − outstanding |
| COD collect | outstanding | outstanding (unchanged formula) |
| Booked shipment | Lines locked | Still locked |
| Existing invoice | Not regenerated by import | Still not regenerated |

---

## 7. Shopify Line Item Mapping Changes

Normalization (REST + GraphQL → `ShopifyRemoteOrder`):

| Field | REST | GraphQL | Internal |
|---|---|---|---|
| Line identity | numeric `id` | `gid://shopify/LineItem/...` | `shopifyLineItemGid` |
| Original quantity | `quantity` | `quantity` | kept on remote; **not** used as active qty when current exists |
| Current quantity | `current_quantity` | `currentQuantity` | filter + stored `quantity` on PostBus rows |
| Remaining | `unfulfilled_quantity` / `fulfillable_quantity` | `unfulfilledQuantity` | persisted if column exists |
| Unit price | `price` | `discountedUnitPriceSet` ?? `originalUnitPriceSet` | `unit_price` |
| Weight | `grams` / variant weight | variant `inventoryItem.measurement.weight` | grams |

Active import rule:

- `currentQuantity > 0` → include with that quantity (e.g. 2 → one row qty 2).
- `currentQuantity = 0` → exclude.
- `currentQuantity` missing **and** order looks edited → do not fall back; `skipLineWrite`.
- `currentQuantity` missing **and** not edited → original `quantity`.

---

## 8. Financial Calculation Changes

Documented concepts:

| Concept | Source | PostBus field |
|---|---|---|
| Original order total | REST `total_price` / GraphQL `totalPriceSet` | `metadata.shopifyTotals.originalTotal` |
| Current order total | REST `current_total_price` / GraphQL `currentTotalPriceSet` | `orders.total_amount` when present; `shopifyTotals.currentTotal` |
| Operational total | current ?? original ?? 0 | `total_amount`, payment settlement |
| Current subtotal | `current_subtotal_price` / `currentSubtotalPriceSet` else `subtotal_price` | `orders.subtotal` |
| Outstanding | `total_outstanding` / `totalOutstandingSet` | COD remaining |
| Net paid (PARTIAL) | `max(0, operationalTotal − outstanding)` | `amount_paid` |
| COD collect | outstanding (PARTIAL/COD) | `cod_amount` |

**Not** used as the operational total: sum of imported product prices.

If current total is missing on an edited incomplete payload, money fields on **existing** orders are left unchanged.

Refunded / partially refunded classification (`REFUNDED`) is unchanged.

---

## 9. COD Compatibility Verification

Sample from the investigation (₹1049 current, ₹314.70 captured, ₹734.30 outstanding) and the live-shaped fixture (current ₹4296, outstanding ₹3037.20):

- `cod_amount` = outstanding **3037.20** — **PASS** in unit tests.
- `amount_paid` = 4296 − 3037.20 = **1258.8** (not 5554.80 − 3037.20).

Merchant COD fees and manual COD orders are untouched. Not every `partially_paid` order is assumed to need COD; classification still uses Shopify financial status + gateways.

---

## 10. India Post Booking Impact

- New/open orders: shipment weight uses **active** line quantities only (`shopifyParcelFromLineItems` after selection).
- `refreshShopifyLineItems` still returns early for BOOKED / SHIPPED / IN_TRANSIT / DELIVERED / CANCELLED orders and QUEUED/BOOKED shipments; only images may update.
- Incomplete edited updates no longer call `refreshUnbookedShopifyShipmentCollect` when current total is unknown.
- Booked AWB collect-conflict path unchanged: audit log, no AWB rewrite.

**No India Post booking, barcode, or AWB regeneration was executed.**

---

## 11. Invoice Impact

`modules/sales-invoices/service.ts` builds new invoice lines from stored `order_line_items`. After this fix, **newly generated** invoices for **newly imported or refreshed open** orders will exclude deposit lines.

Existing invoices are not rewritten. Invoice enqueue remains `ORDER_CREATED` / `PAYMENT_CONFIRMED` only. Historical invoice correction is out of scope.

---

## 12. Database Migration Requirements

Repo already contains `supabase/migrations/20261029120001_shopify_fulfillment_eligibility.sql` adding `source_line_item_id`, `unfulfilled_quantity`, `requires_shipping`. Prior production read showed those columns **absent** on the connected production database.

**This implementation:**

- Writes `source_line_item_id` / `unfulfilled_quantity` when the table has those columns.
- Does **not** require them for the currentQuantity filter (filter is in-memory before insert).
- Does **not** add a unique index (historical duplicate GIDs would fail).
- Did **not** apply any migration to production or staging.

**Rollout order (when approved):** apply the existing additive migration on staging → production, then this application code. If the columns are missing at runtime, inserts that include unknown columns will error — confirm staging schema before production.

---

## 13. Unit Test Results

Command:

```text
npx vitest run modules/shopify/line-items.test.ts modules/shopify/payment.test.ts modules/shopify/graphql/orders.test.ts modules/shopify/orders.test.ts
```

| Suite | Result |
|---|---|
| `modules/shopify/line-items.test.ts` | **PASS** (5) |
| `modules/shopify/payment.test.ts` | **PASS** (16) |
| `modules/shopify/graphql/orders.test.ts` | **PASS** (6) |
| `modules/shopify/orders.test.ts` | **PASS** (66) |
| **Total** | **93 PASS** |

Mapped required cases:

| ID | Case | Status |
|---|---|---|
| T1 | Fully paid, one product | **PASS** (existing paid import) |
| T2 | Fully paid, multiple products | **PASS** (existing import tests) |
| T3 | Deposit `currentQuantity = 0` excluded | **PASS** |
| T4 | Replacement `currentQuantity = 1` included | **PASS** |
| T5 | Multiple active products | **PASS** |
| T6 | Quantity 2 on one line | **PASS** (`line-items.test.ts`) |
| T7 | Partial then full payment | **NOT EXECUTED** as a dedicated sequence (PAID mapping **PASS**) |
| T8 | Order edited | **PASS** |
| T9 | Two active same SKU | **PASS** |
| T10 | Repeated webhook | **PASS** (duplicate webhook / skip processing tests) |
| T11 | Repeated background sync | **PASS** at upsert idempotency level; full `sync-job` loop **NOT EXECUTED** as a new case |
| T12 | Concurrent webhook + sync | **NOT EXECUTED** (delete+insert remains non-atomic; see risks) |
| T13 | Missing current qty on edited | **PASS** |
| T14 | Current total ≠ original | **PASS** |
| T15 | Partial COD | **PASS** |
| T16 | Booked India Post shipment | **PASS** (weight lock + collect conflict tests) |
| T17 | Existing invoice | **NOT EXECUTED** as a dedicated invoice rewrite test; code path does not regenerate historical invoices |
| T18 | Refunded / partially refunded | **PASS** (status mapping) |
| T19 | Discount, shipping, tax | **PASS** (GraphQL mapping of those fields; full tax+discount settlement **NOT EXECUTED** as a dedicated money matrix) |
| T20 | Multi-tenant isolation | **PASS** at query `.eq("organization_id")` usage; live cross-tenant **NOT EXECUTED** |

---

## 14. Integration Test Results

| Check | Status |
|---|---|
| TypeScript `npm run typecheck` | **PASS** |
| ESLint on modified Shopify files | **PASS** |
| Full `npm test` (entire repo) | **NOT EXECUTED** |
| Live Shopify REST/GraphQL against shops | **NOT EXECUTED** (forbidden for this task) |
| India Post booking integration | **NOT EXECUTED** |

---

## 15. Staging Validation Results

**NOT EXECUTED.** Staging credentials / authorized staging shops were not used in this session. Production was not used as a substitute.

Required before production:

- Import a deposit-then-edit PARTIAL order on staging; confirm one active product, current total, `amount_paid`, COD outstanding.
- Fully paid / pending / refunded controls.
- Repeat webhook + background sync.
- Book a shipment, then send `orders/updated`; confirm AWB unchanged.
- Generate a **new** invoice; confirm no deposit line. Confirm an **old** invoice row is unchanged.

---

## 16. Remaining Risks

1. **Non-atomic `DELETE` then `INSERT` in `refreshShopifyLineItems`.** Concurrent webhook + sync can still theoretically duplicate rows. Not rewritten in this change (scope: smallest reliable fix). Mitigated by filtering to active GIDs only; not eliminated.
2. **Production missing `source_line_item_id`.** Deploying code that writes those columns before the migration will fail inserts. Confirm schema first.
3. **Webhook REST payloads omitting `current_quantity`.** Custom OAuth path re-reads the order; if that GET fails, edited orders skip line overwrite (safe) and skip new import (may delay first import).
4. **`shopifyOrderLooksEdited` heuristic** (mixed 0 and >0 current qty) may treat unusual unedited payloads as edited. Safer than importing zeros.
5. **Historical ~249 PARTIAL duplicates remain** until a separate recovery.
6. **Open unbooked historical orders** will self-correct on next successful sync **after** deploy; booked orders will **not** drop deposit lines automatically (lock). That is intentional.
7. **`amount_paid = current − outstanding` is not always equal to captured transactions** (refunds, adjustments). Transactions are used for PAID classification; PARTIAL still uses outstanding. Incomplete transaction lists do not invent paid amounts beyond this formula.

---

## 17. Historical Data Recovery Plan

**Not executed. Proposal only.**

Classify Shopify orders (read-only) into:

| Class | Action |
|---|---|
| A. Not yet shipped | Eligible for dry-run line replace from Shopify current lines |
| B. Queued | Hold; do not change booking params |
| C. Booked India Post | Do not mutate shipment/AWB; optional display-only discrepancy |
| D. Delivered | Do not mutate |
| E. Canceled | Optional line cleanup only if no shipment lock |
| F. Invoice generated | Do not auto-rewrite invoice; flag discrepancy |

Process:

1. Backup `orders` / `order_line_items` / `shipments` / invoice tables.
2. Read-only Shopify revalidation: compare stored rows vs current LineItem GIDs + `currentQuantity`.
3. Financial recon: original vs current totals vs outstanding vs `amount_paid`.
4. Dry-run CSV per tenant.
5. Tenant-level approval.
6. Apply only class A (and approved E) in batches; never delete to satisfy a unique index without review.
7. Rollback: restore from backup.

---

## 18. Rollback Instructions

Local / future deploy:

1. Revert the files listed in section 4 (except this report, if retained).
2. Do not reverse the additive 20261029 migration if already applied (columns are nullable).
3. Do not bulk-delete `order_line_items`.
4. Restart the Next.js app / sync workers.

---

## 19. Production Deployment Checklist

Do **not** proceed until explicitly approved.

- [ ] Staging validation in section 15 complete
- [ ] Confirm staging/production have `source_line_item_id` / `unfulfilled_quantity` **or** ship a compatibility insert that omits those columns
- [ ] Apply `20261029120001_shopify_fulfillment_eligibility.sql` if missing (**separate** approval)
- [ ] Deploy application code
- [ ] Smoke: new PARTIAL edited order, paid order, pending COD, booked order update
- [ ] Do **not** run historical repair in the same change
- [ ] Monitor `shopify.line_items.current_quantity_missing` logs
- [ ] No Shopify order mutations, no India Post rebook, no invoice regen

---

## 20. Final Recommendation

**Ship the application fix to staging after review.** It is the correct, minimal correction of `currentQuantity` import and current-total payment math.

**Do not mark production-ready** until:

- Staging validation is executed (**currently NOT EXECUTED**)
- Schema compatibility for `source_line_item_id` is confirmed
- Concurrent delete+insert risk is accepted or a follow-up transactional refresh is scheduled

**Do not** auto-repair historical booked/invoiced orders in this release.

**This session did not:** commit, push, deploy, apply production migrations, mutate Shopify, rebook India Post, regenerate AWBs, or overwrite invoices.

### Acceptance criteria

| Criterion | Status |
|---|---|
| Removed deposit lines excluded | **Met** (unit) |
| Active Shopify products preserved | **Met** (unit) |
| `currentQuantity` respected | **Met** (unit) |
| REST and GraphQL mappings consistent | **Met** (unit) |
| Not merged by SKU | **Met** (unit) |
| Current order total mapped | **Met** (unit) |
| Amount paid reconciled to current − outstanding | **Met** (unit) |
| Outstanding / COD accurate | **Met** (unit) |
| Fully paid / pending / refund mapping | **Met** (unit) |
| Order edits | **Met** (unit) |
| Repeated sync no extra products | **Met** at upsert; concurrent race **residual risk** |
| Missing quantity safe | **Met** (unit) |
| Booked shipments / AWBs / invoices protected | **Met** in code; live **NOT EXECUTED** |
| Multi-tenant isolation | **Met** in query filters; live **NOT EXECUTED** |
| Typecheck / lint | **PASS** |
| Relevant unit tests | **PASS** (93) |
| Production deployment occurred | **No** |

**Verdict:** Local implementation complete. **Not production-ready** pending staging validation and schema confirmation.
