# Shopify Partial Payment Line-Item Duplication — Technical Audit

**Project:** PostBus — India Post Shipping Automation SaaS  
**Date:** 2026-10-31  
**Scope:** Read-only audit. No source changes, migrations, production writes, Shopify mutations, deploys, or commits.  
**API versions in code:** REST `2025-01` (`SHOPIFY_API_VERSION`); GraphQL / public-app webhooks `2026-04`.  
**Shopify Admin docs consulted:** GraphQL Admin 2026-04 `LineItem`, `Order`, `OrderDisplayFinancialStatus`.

---

## 1. Executive Summary

PostBus **does persist extra product rows** on Shopify orders whose payment status is `PARTIAL` (`financial_status` / `displayFinancialStatus` = `partially_paid`). This is **not a frontend-only rendering bug**.

A read-only scan of the connected Supabase database found:

| Metric | Value |
|---|---|
| Shopify orders | 15,228 |
| `PARTIAL` Shopify orders | 443 |
| Shopify orders with duplicate `title`+`SKU` line rows | 334 |
| Of those, `PARTIAL` | **249 (75%)** |
| `PARTIAL` orders in the two most-affected tenants | **100% duplicated** (214/214 and 34/34) |
| Typical duplicate shape | **2 rows, same quantity, different `unit_price`, same `created_at`** |
| Identical ₹X + ₹X clones | **1 of 280** duplicate groups |

The merchant-facing symptom (“the same product appears twice”) is **CONFIRMED**. The illustrative financial example (₹500 + ₹500 → ₹1,000 header total) is **mostly not what the database shows**. For duplicated `PARTIAL` orders, `sum(unit_price × quantity)` is about **0.99×** `orders.total_amount` (Shopify `total_price`), and **no** duplicated `PARTIAL` order has line-sum exceeding header total by more than ₹1.

**Primary conclusion**

1. **CONFIRMED:** PostBus writes one `order_line_items` row per Shopify `line_items[]` entry with original `quantity > 0`. It does **not** persist or filter on GraphQL `currentQuantity` / REST `current_quantity`. It does **not** uniquely constrain Shopify line-item identity. The dashboard, packing UI, and sales-invoice **lines** render every stored row.
2. **LIKELY:** For the affected tenants, Shopify (or a checkout/partial-payment app on those shops) already supplies **two LineItem objects** with the same title/SKU and **different unit prices** on partially paid orders. PostBus stores both. That matches 100% of those tenants’ `PARTIAL` imports and the same-insert-timestamp pattern.
3. **LIKELY (code defect, not yet payload-proven):** Using GraphQL `quantity` (includes removed/refunded units) instead of `currentQuantity` will keep **removed** lines after order edits **and** add replacement lines — a second duplication mechanism that would also concentrate on edited/partially paid orders.
4. **POSSIBLE:** Concurrent webhook + sync `DELETE` then `INSERT` of line items can double rows. Production timestamps and **different prices** on the two copies make this a **poor explanation of the dominant `PARTIAL` pattern**.
5. **NOT CONFIRMED:** Payment **transactions** being mapped as products. They are not.

**Do not implement a fix until this report is approved.** Historical rows should not be auto-repaired.

---

## 2. Bug Description

Observed: a Shopify order that is **partially paid** imports into PostBus with the same product listed more than once. Quantities, product subtotals, weights, and invoices that iterate `order_line_items` can look inflated even when `orders.total_amount` still matches Shopify’s order total.

This audit treated the ₹500/₹500 example as **illustrative**, not as a specific production record.

---

## 3. Severity and Business Impact

**Overall: P0** for order integrity on affected tenants; **P1** platform-wide because the write path is shared.

| Impact | Severity | Notes |
|---|---|---|
| Wrong product list on order details / Shopify app orders | **P0** | Confirmed in DB + dashboard maps every row (`lib/dashboard/records.ts` `lineItems`). |
| Merchant trusts duplicated lines as extra purchased units | **P0** | Same quantity on both rows. |
| India Post declared weight if auto-sum uses `quantity` | **P1** | Dashboard auto box weight = `Σ(weight × quantity)` over **all** rows. Booking path for Shopify prefers `unfulfilled_quantity` (often null in this DB). |
| COD / AWB collect amount | **P2** for this pattern | COD comes from Shopify outstanding vs `total_price`, not line-sum. No duplicated `PARTIAL` order had `cod_amount > total_amount`. |
| Header order total vs Shopify | **P2** | Stored `total_amount` is Shopify `total_price`, not `sum(lines)`. |
| Sales invoice **lines** | **P1** | Built from `order_line_items`; grand total for Shopify uses imported `total_amount`. Lines and total can disagree. |
| Historical data | **P1** | 249 `PARTIAL` orders already stored this way (plus 85 non-partial title/SKU dups). |

---

## 4. Shopify Integration Architecture

PostBus has **two** Shopify ingresses that share `upsertShopifyOrder`:

| Path | Files | Topics | Order read |
|---|---|---|---|
| Public App Store app | `shopify.app.toml`, `shopify.app.production.toml`, `lib/shopify-app/webhooks.ts` | `orders/create`, `orders/updated`, `orders/cancelled` (not `orders/paid`, not `orders/edited`) | Webhook REST body, then GraphQL re-read (`fetchAppOrder`) |
| Custom OAuth / `shopify_connections` | `lib/api/v1/inbound-webhooks.ts`, `registerShopifyOrderWebhooks` | Code registers `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`, `fulfillment_orders/progress_reported` | REST webhook; GraphQL/REST hydrate for weights/images; payment re-fetch only if financial status is missing/`pending`/`authorized` |

Background sync: `modules/shopify/sync-job.ts` → worker `shopify-sync` → `syncShopifyOrders` / `syncAppInstallationOrders`.

**Connected database:** `shopify_connections` exists; `shopify_app_webhook_deliveries` and `shopify_app_installations` **do not**. Live traffic for this dataset is the **custom OAuth / REST** path, not the public-app GraphQL path.

---

## 5. Complete Order Synchronization Flow

```
Shopify Order
    → REST webhook JSON  (custom app: /webhooks/shopify)
      or GraphQL Order   (public app: fetchAppOrder)
    → importShopifyWebhookOrder / sync loop
    → mergeShopifyRemoteOrder (webhook + fresh)
    → classifyShopifyRemotePayment
    → upsertShopifyOrder
         → orders insert/update (Shopify totals)
         → order_line_items insert  OR  refreshShopifyLineItems (delete all + insert)
         → external_order_references unique (org, source, source_order_id)
    → GET /api/v1/orders/:id
    → Dashboard / Shopify app / packing / sales invoice / India Post booking
```

| Stage | Function | File | Lines | Transform | Duplication risk |
|---|---|---|---|---|---|
| Public webhook HMAC + idempotency | `handleShopifyPublicAppWebhook` / `processDelivery` | `lib/shopify-app/webhooks.ts` | 23–97 | Dedupes **same** `x-shopify-webhook-id` only | Different topics (`create` vs `updated`) both run |
| Public order import | `importAppOrderWebhook` | same | 171–208 | Parses REST body; GraphQL refresh | — |
| Custom webhook | `handleInboundWebhook` | `lib/api/v1/inbound-webhooks.ts` | 150–166 | **No** webhook-id table | Retries re-enter upsert |
| Webhook register (custom) | `registerShopifyOrderWebhooks` | `modules/shopify/orders.ts` | 2170–2193 | POSTs topics including `orders/paid` | Extra `paid` vs public app |
| GraphQL map | `mapGraphqlLineItem` / `mapGraphqlOrder` | `modules/shopify/graphql/orders.ts` | 176–242 | GID line id; `quantity` not `currentQuantity`; `originalUnitPriceSet` | Extra page concat at 241 |
| Merge | `mergeShopifyRemoteOrder` | `modules/shopify/orders.ts` | 1352–1366 | **Replaces** `line_items` if fresh has any | Not array-concat |
| Line filter | `upsertShopifyOrder` | `modules/shopify/orders.ts` | 2386 | `quantity > 0` only | Keeps removed originals |
| Row map | `shopifyLineItemRows` | `modules/shopify/orders.ts` | 994–1012 | `source_line_item_id`, original qty, `price` | No current qty |
| First insert | `upsertShopifyOrder` | `modules/shopify/orders.ts` | 2540–2544 | Insert, no delete | Concurrent first-insert race |
| Update | `refreshShopifyLineItems` | `modules/shopify/orders.ts` | 1079–1138 | Delete all + insert; skip if booked/queued | Non-atomic double-insert |
| Payment | `classifyShopifyRemotePayment` | `modules/shopify/payment.ts` | 187–226 | `partially_paid` → `PARTIAL` | Transactions are money, not lines |
| UI | `lineItems()` | `lib/dashboard/records.ts` | 128–130 | No dedupe | Displays DB as-is |
| Totals UI | order detail | `app/(site)/dashboard/orders/[id]/page.tsx` | ~284+, line table 481+ | Header uses order total; table uses each row | Visual double product |
| Invoice lines | `getSalesInvoice` builder | `modules/sales-invoices/service.ts` | 170–220 | Lines from DB; Shopify grand total imported | Line vs total mismatch |
| Booking weight | `createShipmentsForOrders` | `modules/shipments/service.ts` | 283–300 | Shopify uses `unfulfilled_quantity` or 0 | Inflated if fallback to `quantity` |
| Dashboard weight | `autoBoxWeight` | `app/(site)/dashboard/orders/[id]/page.tsx` | 243–246 | `weight × quantity` all rows | Inflated |

---

## 6. Partial Payment Handling Analysis

Shopify GraphQL `OrderDisplayFinancialStatus` (Admin 2026-04): `AUTHORIZED`, `EXPIRED`, `PAID`, `PARTIALLY_PAID`, `PARTIALLY_REFUNDED`, `PENDING`, `REFUNDED`, `VOIDED`.

PostBus maps (`modules/shopify/payment.ts` 148–171, 244–264):

| Shopify | PostBus `payment_status` | Collect |
|---|---|---|
| `paid` | `PAID` | prepaid, `amount_paid = total` |
| `partially_paid` | `PARTIAL` | `amount_paid = total − outstanding`, `cod_amount = outstanding` |
| `pending` / `authorized` | `COD` if COD gateway, else `PENDING` | COD = total if COD |
| `refunded` / `partially_refunded` | `REFUNDED` | not a product event |
| `voided` | `FAILED` | — |

GraphQL field used: `displayFinancialStatus` lowercased into `financial_status` (`modules/shopify/graphql/orders.ts` 224).

**Totals actually imported** (`upsertShopifyOrder` 2371–2377):

- `subtotal` ← `subtotal_price` / GraphQL `subtotalPriceSet` (original, not `currentSubtotalPriceSet`)
- `total_amount` ← `total_price` / `totalPriceSet` (**not** `currentTotalPriceSet`)
- `total_outstanding` used only for PARTIAL collect math
- `total_received` **not read**

`shopifyPaymentNeedsRefresh` (payment.ts 294–297) is true only for missing/`pending`/`authorized`. **`partially_paid` does not trigger** a REST payment refresh on the custom-app path. Line items therefore stay whatever the webhook (or sync REST page) already contained.

**Transactions:** `shopifyHasSuccessfulPaymentTransaction` only decides PAID vs not. `mapGraphqlOrder` does not push transactions into `line_items`. **Hypothesis B (transactions as products): NOT CONFIRMED / rejected for this codebase.**

Does partial payment cause re-import? **Yes.** `orders/updated` fires when a partial capture is recorded. That is by design. Re-import uses replace-on-update when the order already exists **and** is not weight-locked.

---

## 7. Line Item Duplication Analysis

### What PostBus stores

`shopifyLineItemRows` (orders.ts 994–1012):

- Identity: `source_line_item_id = String(item.id)` (GraphQL GID vs REST numeric — different strings for the same line)
- Quantity: `item.quantity` (GraphQL: **original, including removed/refunded** per Shopify LineItem docs)
- Price: `item.price` (GraphQL: **`originalUnitPriceSet`**, not `discountedUnitPriceSet`)
- Remaining: `unfulfilled_quantity` / `fulfillable_quantity` only

Filter before write (2386):

```text
(remote.line_items ?? []).filter((item) => Number(item.quantity ?? 0) > 0)
```

`current_quantity` / `currentQuantity` is copied on the remote object (`graphql/orders.ts` 187) and **never used** for insert/filter.

Shopify Admin GraphQL `LineItem.quantity`: *“The number of units ordered, including refunded and removed units.”*  
Correct current commerce quantity is `currentQuantity` (queried but ignored).

### Production shape (read-only SQL, no PII)

`PARTIAL` duplicate groups: **280**.

| Property | Result |
|---|---|
| Copies = 2 | 279 / 280 |
| Same quantity | 280 / 280 |
| Different `unit_price` | 279 / 280 |
| Identical qty **and** price | **1** |
| Same `created_at` on both rows | 249 / 249 affected `PARTIAL` **orders** |
| Entire product set doubled (`rows = unique_title_sku × 2`) | 248 / 249 orders |
| One price is 0 | 0 |
| Mean price gap | ₹435.16 |
| Price ratios clustered | 1.995 (23), 2.495 (71), 2.995 (3), ≥3.33 (182) |

This is **not** “the same payload inserted twice” (that would be identical prices). It is **two priced rows for the same title/SKU written in one insert**.

Legitimate separate Shopify lines for the same variant are possible; **100% of two tenants’ PARTIAL orders** showing this pattern is not explained by occasional custom-line extras.

### Hypotheses vs evidence

| ID | Hypothesis | Verdict |
|---|---|---|
| A | Bad line-item transform (qty/price fields) | **LIKELY** contributor: original qty + original unit price; `currentQuantity` ignored |
| B | Transactions as products | **NOT CONFIRMED** |
| C | Duplicate webhook delivery | **POSSIBLE** on custom path (no webhook-id store); does not explain different prices + same timestamp |
| D | Background sync race | **POSSIBLE** generally; **poor fit** for dominant PARTIAL pattern |
| E | Upsert conflict target | **CONFIRMED gap:** no unique `(order_id, source_line_item_id)`; connected DB **lacks the column** |
| F | Special-case `partially_paid` mapper duplicating lines | **NOT CONFIRMED** — payment mapper does not touch `line_items` |
| G | Update merge concatenates old+new | **NOT CONFIRMED** in `mergeShopifyRemoteOrder` (replace). `refreshShopifyLineItems` replaces via delete+insert |
| H | REST+GraphQL concat | **NOT CONFIRMED** in current merge (replace). GraphQL pagination concat is first page + `after` cursor only |
| I | Frontend double render | **NOT CONFIRMED** as root; DB already has two rows |
| J | Header total = sum(lines) | **NOT CONFIRMED** for stored `total_amount`; **POSSIBLE** in UI mental math / invoice lines |
| K | Order-edit identity / `currentQuantity` | **LIKELY** for edits; **unproven** without a raw Shopify payload |

---

## 8. Webhook and Background Sync Findings

**Public app** (`lib/shopify-app/webhooks.ts`): in-process lock + `shopify_app_webhook_deliveries` primary key. Same delivery is idempotent. **`create` and `updated` are different ids** — both import.

**Custom app** (`inbound-webhooks.ts` 150–166): HMAC only. **No delivery table.** Shopify retries and overlapping `create`/`updated`/`paid` all call `importShopifyWebhookOrder`.

**`orders/edited`:** not subscribed. Edits arrive only as `orders/updated` (full order snapshot).

**Sync vs webhook:** `enqueueShopifyOrderSync` dedupes **active `shopify-sync` jobs per org**, not per order. A webhook and a running sync can `upsertShopifyOrder` the same order concurrently.

**`refreshShopifyLineItems` (1079–1128):** not in a DB transaction. Concurrent delete+insert can leave two full copies. **POSSIBLE P1**, not the dominant PARTIAL evidence (prices differ; timestamps equal).

**Weight lock (1088–1106):** once a shipment is `QUEUED`/`BOOKED`/… line items are **not** rewritten. A bad first insert is sticky.

---

## 9. Database Integrity Findings

Connected project indexes (read-only):

| Object | Constraint |
|---|---|
| `orders` | unique `(organization_id, order_number)` |
| `external_order_references` | unique `(organization_id, source, source_order_id)` |
| `order_line_items` | **PK `id` only**. Index `(organization_id, order_id)` is **not unique** |

Repo migration `20261029120001_shopify_fulfillment_eligibility.sql` adds `source_line_item_id` and `unfulfilled_quantity`. **Those columns are absent on the connected database.** The live importer cannot persist Shopify line identity even if the code sends it (unknown extra keys are dropped by PostgREST).

**CONFIRMED:** one Shopify line can be inserted many times for the same org/order. No tenant-scoped unique line identity.

Webhook deliveries table from `20261020120000_shopify_public_app_foundation.sql` is also **absent** on this database.

---

## 10. Financial Calculation Findings

| Concept | Shopify source of truth | PostBus field | Used? |
|---|---|---|---|
| Original order total | REST `total_price` / GQL `totalPriceSet` | `orders.total_amount` | Yes |
| Current total after edits/returns | `current_total_price` / `currentTotalPriceSet` | — | **No** |
| Original subtotal | `subtotal_price` / `subtotalPriceSet` | `orders.subtotal` | Yes |
| Current subtotal | `current_subtotal_price` | — | **No** |
| Outstanding | `total_outstanding` / `totalOutstandingSet` | PARTIAL `cod_amount` / `amount_paid` | Yes |
| Amount received | `total_received` | — | **No** (derived as total − outstanding) |
| Line unit price | REST `price` (typically current unit); GQL `discountedUnitPriceSet` vs `originalUnitPriceSet` | `unit_price` from `price` / **original** GQL | Original GQL |
| Line qty now | `current_quantity` / `currentQuantity` | `quantity` from original | **Wrong field** |

Fallback on first insert (2480–2497): if Shopify totals are 0, `total_amount` becomes `Σ(price × quantity)`. Duplicated lines **would** inflate that fallback. Normal Shopify orders have `total_price` set, so the header usually stays correct.

`roundMoney` uses 2 decimal places (`modules/orders/payment.ts` 4–6).

**PARTIAL collect:** `cod_amount = outstanding` when present (`payment.ts` 246–258). COD is **not** “sum of duplicate products”. Do not treat COD as identical to outstanding without that mapper — currently it is.

---

## 11. COD / Shipping / Invoice Impact

| Surface | Uses duplicate rows? | Effect |
|---|---|---|
| India Post COD on AWB | `shipmentCollectFromOrder` ← order `cod_amount` / outstanding | **Not inflated** by extra product rows in scanned `PARTIAL` data (`cod_exceeds_total = 0`) |
| Prepaid vs COD mode | `PARTIAL` → COD collect of outstanding | Correct **if** Shopify outstanding is correct |
| Dashboard product list | Yes | Product appears twice |
| Auto box weight on order page | `Σ(weight × quantity)` | **Can inflate** if both rows have weight |
| `createShipmentsForOrders` Shopify weight | `unfulfilled_quantity` or **0** if null | Connected DB has no column → JS `undefined` → 0 from lines; parcel/manual weight may still apply |
| Packing slip | `order_line_items` | Extra lines |
| Sales invoice lines | `order_line_items` | Extra lines; Shopify grand total still imported `total_amount` |
| Declared value | typically `total_amount` / shipment fields | Header path safer than line-sum |

---

## 12. Reproduction Test Results

Safe unit tests run (no Shopify, no production writes):

| Suite | Result |
|---|---|
| `modules/shopify/graphql/orders.test.ts` |  Pass (mapping uses original `quantity` / `originalUnitPriceSet`) |
| `modules/shopify/payment.test.ts` | Pass (`partially_paid` → PARTIAL + outstanding COD) |

| ID | Scenario | Result |
|---|---|---|
| TEST 1 | Single product, fully paid | **NOT EXECUTED** against Shopify. DB: paid title-dup rate is low except 20/122 in tenant 1. |
| TEST 2 | Single product, partially paid | **NOT EXECUTED** live. DB: dominant failure class. |
| TEST 3 | Multiple products, partial | **NOT EXECUTED** live. DB: whole set doubled (248/249). |
| TEST 4 | Qty > 1, partial | **NOT EXECUTED**. DB: 9 groups with qty 2, still two rows same qty different price. |
| TEST 5–8 | Further payment / edit / cancel | **NOT EXECUTED** |
| TEST 9 | Repeated `orders/updated` | **NOT EXECUTED**. Custom path has no webhook-id idempotency. |
| TEST 10 | Concurrent webhook + sync | **NOT EXECUTED**. Code allows it. |
| TEST 11 | Repeated manual sync | **NOT EXECUTED**. Update path should replace unless locked. |
| TEST 12 | Two legitimate same-variant lines | **NOT EXECUTED**. Deduping by product_id is correctly avoided in code. |

**Do not treat the production aggregates as a substitute for a captured Shopify payload.** They prove PostBus **storage** of two priced rows; they do not by themselves prove whether Shopify `currentQuantity` on one of those rows is 0.

---

## 13. Confirmed Root Cause

### CONFIRMED (P0) — Persistence and display of every original-qty Shopify line

**Root cause:** `upsertShopifyOrder` / `shopifyLineItemRows` persist every `line_items` element with `quantity > 0`, using original quantity and (on GraphQL) original unit price. The UI lists every `order_line_items` row. There is no unique Shopify line-item key in the live schema.

**Evidence:**

- `modules/shopify/orders.ts` 2386, 994–1007, 2540–2544, 1079–1128
- `modules/shopify/graphql/orders.ts` 19–21, 176–191
- Shopify LineItem.quantity includes removed units ([LineItem](https://shopify.dev/docs/api/admin-graphql/2026-04/objects/LineItem))
- DB: 249 `PARTIAL` orders with two title/SKU rows, same qty, different price, same insert timestamp
- Two tenants: **100%** of `PARTIAL` orders

**Confidence:** High that PostBus stores and shows extra rows.  
**Confidence:** Medium that Shopify’s **current** order also contains two **current** lines vs one current + one removed. Missing evidence: raw `id` + `currentQuantity` from Shopify for one affected order.

**Reproduction:** Import any order whose Shopify `line_items` has two entries with the same title/SKU and `quantity >= 1`. PostBus will show both.

**Impact:** Duplicate products on dashboard, packing, invoice lines; possible double weight on auto-sum UIs.

**Recommended fix (do not apply yet):** See §17.

### LIKELY (P0) — `currentQuantity` ignored after order edits / partial-pay apps

Removed lines stay importable (`quantity` still > 0). Replacement lines are additional rows. Partial capture workflows often edit orders. Matches tenant-wide PARTIAL correlation.

**Confidence:** Medium until a payload is captured.

### LIKELY (P1) — GraphQL `originalUnitPriceSet` vs REST current `price`

If public-app GraphQL refresh were concatenated with REST (not in current merge) or if a shop’s REST payload already has list vs net lines, different `unit_price` on the two rows is explained. Current merge **replaces** rather than concatenates.

### POSSIBLE (P1) — Non-atomic `refreshShopifyLineItems` and first-insert race

`orders.ts` 1108–1128 and 2540–2554. No per-order lock. Custom webhooks are not idempotent by delivery id.

**Confidence:** Medium as a general defect; **Low** as the cause of **this** PARTIAL price-pair pattern.

---

## 14. Other Potential Issues

| Finding | Sev | Confidence | Action |
|---|---|---|---|
| `currentTotalPriceSet` / `current_subtotal_price` unused | P2 | High | Use current totals for post-edit amounts; keep original totals distinct |
| Public app omits `orders/paid`; custom app registers it | P3 | High | Align topics; `updated` already covers payment changes |
| `orders/edited` not subscribed | P3 | High | Rely on `updated` or add edited handling without double-applying deltas |
| `shopifyPaymentNeedsRefresh` skips `partially_paid` | P2 | High | Still re-read line items + outstanding on payment change |
| Connected DB missing `source_line_item_id`, `unfulfilled_quantity`, public-app webhook table | P0 (ops) | High | Apply pending migrations in a separate, approved change |
| Invoice lines vs imported grand total can disagree | P1 | High | Build invoice lines from **current** Shopify lines |
| Auto weight sums duplicate qty | P1 | High | Sum by Shopify line id / current qty |
| GraphQL `transactions(first: 5)` may truncate payment evidence | P3 | Medium | Page transactions if classification depends on them |
| GID vs numeric `source_line_item_id` if column is applied later | P2 | High | Normalize to GID everywhere |

---

## 15. Affected Files and Functions

| File | Function / area | Role |
|---|---|---|
| `modules/shopify/orders.ts` | `upsertShopifyOrder`, `shopifyLineItemRows`, `refreshShopifyLineItems`, `importShopifyWebhookOrder`, `mergeShopifyRemoteOrder`, `registerShopifyOrderWebhooks` | Write path |
| `modules/shopify/graphql/orders.ts` | `mapGraphqlLineItem`, `mapGraphqlOrder`, `remainingLineItems` | GraphQL normalize |
| `modules/shopify/payment.ts` | `classifyShopifyRemotePayment`, `mapShopifyCollectable` | PARTIAL/COD |
| `lib/shopify-app/webhooks.ts` | `handleShopifyPublicAppWebhook` | Public webhooks |
| `lib/api/v1/inbound-webhooks.ts` | `handleInboundWebhook` | Custom webhooks |
| `modules/shopify/sync-job.ts` | `enqueueShopifyOrderSync` | Job dedupe |
| `lib/dashboard/records.ts` | `lineItems` | UI source |
| `app/(site)/dashboard/orders/[id]/page.tsx` | product table, `autoBoxWeight` | Display / weight |
| `modules/sales-invoices/service.ts` | invoice line build | Invoice |
| `modules/shipments/service.ts` | `createShipmentsForOrders` | Booking weight |
| `supabase/migrations/20260919090100_commerce_shipping.sql` | `order_line_items` | No line unique |
| `supabase/migrations/20261029120001_shopify_fulfillment_eligibility.sql` | identity columns | Not applied on connected DB |

---

## 16. Historical Data Impact

**Yes. Do not auto-repair.**

Read-only counts (connected DB):

- 249 `PARTIAL` Shopify orders with duplicate title/SKU
- 85 additional Shopify orders in other payment statuses with title/SKU dups (paid 30, pending 38, COD 4, failed 9, refunded 4)
- Concentrated in **3** organizations (214, 34, 1)

Repair must:

1. Fetch live Shopify order (`lineItems { id, quantity, currentQuantity, originalUnitPriceSet, discountedUnitPriceSet }`).
2. Keep rows whose Shopify id is still current (`currentQuantity > 0`).
3. Never collapse two **current** Shopify line ids that happen to share a variant.
4. Skip booked shipments or repair display-only if AWB already used inflated weight.
5. Recalculate invoices that copied duplicate lines.

---

## 17. Recommended Fix Strategy

**Stop. Wait for explicit approval before coding.**

### 17.1 Mapping (correctness)

1. Persist **Shopify line item GID** as the stable id (`gid://shopify/LineItem/…` for REST numeric ids).
2. Store `quantity = currentQuantity` (fallback: REST `current_quantity`). Skip lines with current qty 0.
3. Store unit price from **discounted / current** unit price; keep original unit price in metadata if needed for MRP display.
4. Keep `unfulfilled_quantity` for shipping weight, not as a second product row.
5. Continue to allow two current lines with the same `variant_id`.

### 17.2 Idempotent sync

1. Unique `(organization_id, order_id, source_line_item_id)` where `source_line_item_id is not null`.
2. Upsert line items on that key; delete only ids absent from the current Shopify snapshot (in one transaction).
3. `SELECT … FOR UPDATE` (or advisory lock) on `orders.id` for the duration of the line rewrite.
4. Custom webhooks: persist `x-shopify-webhook-id` like the public app.
5. Per-order in-flight lock so webhook + `shopify-sync` cannot interleave.

### 17.3 Money

1. `total_amount` / subtotal: document original vs current; for shipping/COD use **current** total and **outstanding**.
2. Never set operational totals from `sum(order_line_items)` except as a last-resort fallback after current-qty filtering.
3. PARTIAL COD remains `outstanding`, not line-sum.

### 17.4 Tests (must fail today, pass after fix)

See §18.

### 17.5 Historical recovery (separate change)

Script: org-scoped, dry-run first, compare Shopify GIDs, report diffs, require operator approval per tenant.

---

## 18. Regression Test Plan

Fixtures (no live Shopify writes):

1. One line, `paid` → one row, totals match `totalPriceSet`.
2. One line, `partially_paid`, `currentQuantity = 1`, `quantity = 1` → one row; COD = outstanding.
3. Two **different** products, partial → two rows.
4. `quantity = 3`, `currentQuantity = 3` → qty 3, one row.
5. Partial then second capture (`updated`) → still one row per current Shopify id.
6. Partial then `paid` → still no dupes; status PAID; COD 0.
7. Order edit: original line `currentQuantity = 0`, new line `currentQuantity = 1`, same variant → **one** stored row (the current id).
8. Cancel → no extra lines; status cancelled.
9. Same `webhook-id` twice → one write.
10. Overlapping `create` + `updated` → one set of current lines.
11. Manual sync twice → idempotent.
12. Two current Shopify line ids, same variant, both `currentQuantity > 0` → **two** rows (legitimate).
13. GraphQL original vs discounted unit price → store discounted/current; do not insert both.
14. Booked shipment + later Shopify edit → do not silently inflate booked weight; flag conflict.

---

## 19. Deployment Risk Assessment

| Change | Risk |
|---|---|
| Filter `currentQuantity` | Medium: drops removed lines (desired); mis-filter could hide real items if field missing |
| Unique line id | Medium: requires backfill + GID normalize; duplicates must be cleaned first |
| Atomic upsert | Low–medium |
| Auto historical delete | **High** — do not ship with the mapping fix |
| COD formula change | High if mixed with line-sum |

Rollout: mapping + lock + unique constraint on **new** writes; repair job later.

---

## 20. Final Engineering Recommendation

1. Treat this as a **real P0 data-integrity defect** on at least two tenants’ partially paid Shopify orders.
2. Do **not** “dedupe by product/SKU” — that would destroy legitimate multi-line orders.
3. Next diagnostic **before** coding (still read-only): for one affected order, compare Shopify `lineItems.nodes.{id,quantity,currentQuantity,originalUnitPriceSet,discountedUnitPriceSet}` to `order_line_items`. That single payload distinguishes “Shopify sent two current lines” vs “PostBus kept a removed line”.
4. Apply schema migrations for `source_line_item_id` / `unfulfilled_quantity` only as part of the approved fix, after a duplicate-cleanup plan.
5. **Do not implement, deploy, or repair history without explicit approval.**

---

## Finding register

| # | Finding | Sev | Evidence | Confidence | Recommended action |
|---|---|---|---|---|---|
| F1 | Extra product rows stored for PARTIAL orders | P0 | SQL aggregates; `shopifyLineItemRows` 994–1007; dashboard `lineItems` 128–130 | High | Map current Shopify lines by GID |
| F2 | Original `quantity` used instead of `currentQuantity` | P0 | `graphql/orders.ts` 186–188; filter 2386; Shopify LineItem docs | High | Filter/store current qty |
| F3 | GraphQL unit price is original, not discounted | P1 | `graphql/orders.ts` 21, 191 | High | Use discounted/current unit price |
| F4 | No unique line-item identity in live DB | P0 | `pg_indexes`; missing columns | High | Unique GID + upsert |
| F5 | Non-atomic delete+insert | P1 | `refreshShopifyLineItems` 1120–1127 | Medium | Transaction + lock |
| F6 | Custom webhooks not delivery-idempotent | P1 | `inbound-webhooks.ts` 150–166 vs `webhooks.ts` 61–68 | High | Persist webhook id |
| F7 | Header total not line-sum (usually) | P2 | `upsertShopifyOrder` 2371–2377; SQL line_sum ≈ total | High | Keep Shopify totals; don’t sum dups |
| F8 | PARTIAL COD from outstanding | P2 | `payment.ts` 246–258; SQL `cod_exceeds_total = 0` | High | Keep; don’t switch to line-sum |
| F9 | Auto weight can inflate | P1 | order detail 243–246 | High | Sum current shippable qty |
| F10 | Transactions not products | — | `payment.ts` 112–127; graphql map | High | No change |
| F11 | Historical duplicates exist | P1 | 249 PARTIAL orders, 3 orgs | High | Separate repair |
| F12 | Identical ₹+₹ clone is rare | P3 | 1/280 groups | High | Don’t optimize for that example alone |

---

*End of audit. Implementation is blocked pending explicit approval.*
