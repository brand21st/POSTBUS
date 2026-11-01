# Shopify Partial Payment — Root Cause Verification

**Date:** 2026-10-31  
**Mode:** Read-only. No code, database, Shopify, or config writes.  
**APIs used:** Admin GraphQL `2026-04` (validated), Admin REST `2025-01` (installed custom-app version).  
**Prior report:** `SHOPIFY_PARTIAL_PAYMENT_DUPLICATION_AUDIT.md`

Customer names, phones, emails, and addresses are omitted. Shop hostnames are referred to as Shop A and Shop B.

---

## 1. Confirmed root cause

**CONFIRMED.**

Partially paid orders from the affected merchants already contain **two Shopify LineItem records per purchased product**:

1. A **deposit / partial-COD checkout line** (`currentQuantity = 0` after an order edit). Original `quantity` remains > 0. Unit price is the prepaid slice (for example ₹314.70 or ₹40.00). Line properties describe “pay now / pay on delivery”.
2. A **replacement line added by order edit** (`currentQuantity > 0`). Unit price is the catalog price (for example ₹1049.00 or ₹499.00). Empty properties.

PostBus imports **both**, because it keeps every line with original `quantity > 0` and never consults `currentQuantity` / REST `current_quantity`.

PostBus does **not** invent extra rows in these samples. Shopify GraphQL line count = REST `line_items` count = PostBus `order_line_items` count.

The extra rows are **not currently purchased units**. They are **removed deposit artifacts** that Shopify still returns on `lineItems` / REST `line_items`.

Webhook races and missing unique constraints remain real defects, but they are **not** the cause of the 249-order PARTIAL pattern.

---

## 2. Sample selection (Step 1)

| Sample | Shop | PostBus order | Shopify order id | Payment | PostBus rows | Unique titles | Role |
|---|---|---|---|---|---|---|---|
| A1 | A | `veyncult-1020` | `7368621162688` | PARTIAL | 8 | 4 | All products doubled |
| A2 | A | `veyncult-1099` | `7375915122880` | PARTIAL | 6 | 3 | All products doubled |
| B1 | B | `#261315` | `18939810119915` | PARTIAL | 8 | 4 | All products doubled |
| B2 | B | `#261290` | `18937401344235` | PARTIAL | 6 | 3 | All products doubled |
| C1 | A | `veyncult-1106` | `7376336355520` | PAID | 2 | 2 | Control, fully paid |
| C2 | B | `#261406` | `18983582433515` | PAID | 2 | 2 | Control, fully paid |

Both shops: `shopify_connections.status = CONNECTED`, tokens present. Shop B lacks `read_products`; GraphQL still returned line items (variant/product GIDs denied). REST returned product/variant ids.

---

## 3. Evidence from original Shopify API (Step 2)

Fetched 2026-10-31T12:16Z. No mutations.

### 3.1 Shop A — `veyncult-1020` (PARTIALLY_PAID, `edited: true`)

| Shopify field | Value |
|---|---|
| `displayFinancialStatus` | `PARTIALLY_PAID` |
| `edited` | `true` |
| Tags | `order-edited`, `COD-Balance-2937`, `OTP Verified`, `postbus-booked` |
| Note attributes | `_cod_payment_type=partial`, `_cod_tier=1` |
| Gateway | `01 Cards, UPI, NB, Wallets by Razorpay` |
| SALE transaction | ₹1,258.80 success |
| Original `totalPrice` / REST `total_price` | ₹5,554.80 |
| **Current** `currentTotalPrice` | **₹4,296.00** |
| Original subtotal | ₹5,454.80 |
| Current subtotal | ₹4,196.00 |
| Outstanding | ₹3,037.20 |
| Shipping | ₹100.00 |

**Eight GraphQL line items, eight REST line items.** Four Shopify LineItem GIDs have `currentQuantity = 0`; four different GIDs have `currentQuantity = 1`. Same SKU/title paired across the two GIDs.

Example (SAND DARK WIDE — 34), two **different** LineItem IDs:

| LineItem GID suffix | Original qty | currentQuantity | Unit price | Properties |
|---|---|---|---|---|
| `…435840` | 1 | **0** | ₹314.70 | `_cod=1`, `_price=1049.00`, `_remaining=734.30`, Note “Pay on delivery” |
| `…763520` | 1 | **1** | ₹1,049.00 | none |

₹314.70 × 4 = ₹1,258.80 = the SALE capture.  
₹1,049 × 4 + ₹100 shipping = ₹4,296 = **current** total.  
₹1,049 × 4 + ₹314.70 × 4 + ₹100 = ₹5,554.80 = **original** total (what PostBus stored).

REST `current_quantity` matches GraphQL `currentQuantity`. REST `price` matches GraphQL `originalUnitPriceSet` / `discountedUnitPriceSet` (no line discounts).

### 3.2 Shop A — `veyncult-1099`

Same pattern: `edited: true`, tags `order-edited` + `COD-Balance-*`, three `currentQuantity = 0` deposit lines at ₹314.70 / ₹149.70, three current catalog lines at ₹1,049 / ₹499.

### 3.3 Shop B — `#261315` (PARTIALLY_PAID, `edited: true`)

Checkout app evidence on **removed** lines (not inferred from payment status alone):

- Line property `_codk_bundle_processed = true`
- Line property `description = "Pay ₹200 now and ₹2,295 on delivery"`
- SALE transaction ₹200.00
- Deposit unit price ₹40.00; `quantity` 1+1+1+2 = 5; 5 × ₹40 = ₹200

Replacement lines: catalog ₹499.00, `currentQuantity` 1 or 2, empty properties, **new LineItem IDs**.

| Totals | Amount |
|---|---|
| Original total | ₹2,695.00 |
| Current total | ₹2,495.00 |
| Difference | ₹200.00 (removed deposit lines) |
| Outstanding | ₹2,295.00 (matches the “on delivery” copy) |

### 3.4 Shop B — `#261290`

Same `_codk_bundle_processed` + “Pay now / on delivery” properties on `currentQuantity = 0` lines at ₹66.67; current lines at ₹399.00.

### 3.5 Controls (PAID, `edited: false`)

| Order | Shopify lines | currentQuantity | Prices | Properties | PostBus rows |
|---|---|---|---|---|---|
| `veyncult-1106` | 2 | both 1 | ₹1,049 and ₹1,099 | empty | 2 matching |
| `#261406` | 2 | both 1 | ₹399 and ₹599 | empty | 2 matching |

Same Razorpay gateway as affected orders. **No deposit lines, no order edit, no duplicates.** Partial-COD checkout + order edit, not Razorpay itself, produces the extra Shopify lines.

---

## 4. Shopify vs PostBus comparison (Steps 3, 5, 6)

### A1 `veyncult-1020`

| Stage | Line count | Notes |
|---|---|---|
| Shopify GraphQL `lineItems` | 8 | 4 current + 4 removed |
| Shopify REST `line_items` | 8 | same IDs |
| PostgreSQL `order_line_items` | 8 | same titles/prices; **no `source_line_item_id` column on this DB** |
| Dashboard | 8 | `lineItems()` returns all DB rows |

**First incorrect stage:** PostBus **mapping/filter**, not Shopify storage and not the UI. Shopify correctly exposes removed lines with `currentQuantity = 0`. PostBus treats original `quantity = 1` as “still buy this”.

Identity:

- Two **different** Shopify LineItem IDs per product: **CONFIRMED**.
- One line removed/edited (`currentQuantity = 0`): **CONFIRMED**.
- Both lines currently active: **NO**.
- Both financially “live” product purchases: **NO**. The ₹314.70 line is a **partial-COD deposit artifact** later replaced by the ₹1,049 line. The capture of ₹1,258.80 is the deposit, not a second garment.

Pricing (A1):

| Concept | Shopify | PostBus |
|---|---|---|
| Current product subtotal | ₹4,196 | displayed as ₹5,454.80 (sum of all stored rows) |
| Current order total | ₹4,296 | `total_amount` ₹5,554.80 (**original** `total_price`) |
| Outstanding / COD | ₹3,037.20 | `cod_amount` ₹3,037.20 (outstanding — **correct remaining**) |
| Amount actually captured | ₹1,258.80 | `amount_paid` ₹2,517.60 = original total − outstanding (**wrong**) |

`amount_paid` uses `total_price − total_outstanding` (`modules/shopify/payment.ts` `mapShopifyCollectable`). Mixing **original** total with **current** outstanding inflates paid-to-date.

B1 `#261315`: PostBus `amount_paid` ₹400 vs Shopify SALE ₹200; `cod_amount` ₹2,295 matches outstanding and the checkout “on delivery” text.

Discounts: none on sampled lines. Tax on Shop B follows original vs current headers (`total_tax` 411.11 vs `currentTotalTax` 380.60); PostBus stored original tax.

---

## 5. Payment applications (Step 4)

**CONFIRMED from line properties, tags, `edited`, and transactions — not from `partially_paid` alone.**

| Shop | Evidence | Mechanism |
|---|---|---|
| A | `_cod_payment_type=partial`, `_cod`, `_price`, `_remaining`, `order-edited`, `COD-Balance-*` | Partial COD at checkout: line priced at prepaid slice, then **order edit** replaces those lines with full-price lines |
| B | `_codk_bundle_processed`, description “Pay ₹X now and ₹Y on delivery” | Same class of app (COD-K / bundle partial COD), then order edit |

Not observed on these six orders: Shopify native payment terms, draft-order conversion flags, installment `payment_terms` (REST `payment_terms` was null), or PostBus-created payment lines.

Draft/source: `sourceName` / `source_name` = `web` for all six.

---

## 6. Database and sync (Step 7)

For these six orders:

- PostBus row count **equals** Shopify line count.
- Duplicate title pairs were inserted in **one** `created_at` (same microsecond).
- No extra PostBus-only rows.

Therefore **webhook retry / concurrent delete+insert did not produce this dataset**.

Still true from the prior audit, but **out of scope as this bug’s cause**:

- No unique `(order_id, source_line_item_id)` (column missing on connected DB).
- Custom webhooks are not delivery-idempotent.
- `refreshShopifyLineItems` is non-atomic.

---

## 7. Exact affected code

| Behavior | Location |
|---|---|
| Keep lines with original `quantity > 0` | `modules/shopify/orders.ts` `upsertShopifyOrder` ~2386 |
| Persist `item.quantity` and `item.price` | `shopifyLineItemRows` ~994–1007 |
| GraphQL maps `quantity` not `currentQuantity`; `originalUnitPriceSet` | `modules/shopify/graphql/orders.ts` 19–21, 176–191 |
| Order totals from original `total_price` / `subtotalPriceSet` | `upsertShopifyOrder` ~2371–2377 |
| PARTIAL `amount_paid = total_price − outstanding` | `modules/shopify/payment.ts` `mapShopifyCollectable` 244–258 |
| UI shows every DB row | `lib/dashboard/records.ts` `lineItems` 128–130 |

---

## 8. Origin of extra rows

| Question | Answer |
|---|---|
| Does Shopify contain both lines? | **Yes.** Distinct LineItem IDs. |
| Does PostBus add more than Shopify? | **No, on these samples.** |
| Are both lines legitimate current products? | **No.** `currentQuantity = 0` lines are removed deposit/edit artifacts. |
| Are they payment transactions stored as products? | **No.** Transactions are separate SALE rows. The deposit was **encoded as a line item by a checkout app**, then removed by order edit. |
| Why PARTIAL specifically? | That checkout path is what **edits** the order. Fully paid controls on the same shops are `edited: false` with one current line per product. |

---

## 9. Financial and operational impact

| Field | Impact | Severity |
|---|---|---|
| Product list / qty | Removed deposit lines shown as extra garments | **P0** |
| Header `total_amount` | Original Shopify total (includes removed deposit lines), higher than current Shopify total | **P1** |
| `amount_paid` | Original total − outstanding; larger than captured SALE | **P1** |
| `cod_amount` | Shopify outstanding; matches remaining collect on sampled orders | **P2** (correct remaining, but paired with inflated header) |
| Auto parcel weight | Can count deposit line + current line if both have weight | **P1** |
| Invoice **lines** | Duplicate products | **P1** |
| Invoice Shopify grand total | Uses stored `total_amount` (original) | **P1** |

India Post COD using outstanding is closer to truth than summing duplicated catalog prices.

---

## 10. Recommended minimal safe fix (do not implement yet)

1. **Import filter:** persist only lines with `currentQuantity` (GraphQL) or `current_quantity` (REST) **> 0**. Skip `currentQuantity = 0` even if original `quantity > 0`.
2. **Identity:** store Shopify LineItem GID; unique `(organization_id, order_id, source_line_item_id)`.
3. **Totals:** for operational/display/COD math, use **current** Shopify totals (`current_total_price` / `currentTotalPriceSet`) plus `total_outstanding`. Keep original totals in metadata if needed.
4. **PARTIAL paid-to-date:** `current_total − outstanding` or sum of successful SALE/CAPTURE amounts — never original `total_price − outstanding`.
5. Do **not** dedupe by title/SKU. Shop B has two current lines that share a product family with different sizes (`S` qty 2 vs `XL` qty 1) — those must remain separate. Only drop lines whose **Shopify id** is not current.

That is sufficient to stop new duplicates of this class.

---

## 11. Historical repair

Required for already-imported PARTIAL orders whose Shopify `currentQuantity = 0` lines were stored.

1. Dry-run: for each Shopify order, list PostBus rows vs Shopify GIDs with `currentQuantity > 0`.
2. Delete (or archive) PostBus rows whose Shopify id has `currentQuantity = 0`, or that match a removed deposit line by GID after GID backfill.
3. Recalculate `subtotal` / `total_amount` from **current** Shopify totals; recompute `amount_paid` from current total and outstanding.
4. Do not change booked AWB COD without an operator check if the booked `cod_amount` already equals outstanding (often already correct).
5. Rebuild sales-invoice **lines** if they copied duplicate products.
6. Tenant-scoped, approval-gated. Do not auto-run globally.

Connected DB still lacks `source_line_item_id`; repair must re-read Shopify, not guess by price.

---

## 12. Regression tests

Must fail on current code, pass after the filter:

1. Fixture: two Shopify lines, same variant, ids L1 `currentQuantity=0` price 314.70 and L2 `currentQuantity=1` price 1049 → PostBus stores **only L2**.
2. Same with REST `current_quantity`.
3. PARTIAL + `edited: true` + `_cod` / `_codk_bundle_processed` properties.
4. Fully paid control: one line per product, `edited: false`.
5. Two **current** lines, same product, different variant titles, both `currentQuantity > 0` → two rows.
6. `total_amount` equals `currentTotalPrice`; `amount_paid` equals current total − outstanding (or SALE sum); `cod_amount` equals outstanding.
7. Order edit after import: removed id disappears; new id appears; no concat.

---

## 13. Facts vs remaining hypotheses

| Item | Status |
|---|---|
| Shopify returns removed deposit lines with `currentQuantity = 0` and a new LineItem id at catalog price | **CONFIRMED** (4 PARTIAL orders, 2 shops) |
| PostBus stores every original-qty line | **CONFIRMED** |
| PostBus extra insert beyond Shopify | **NOT OBSERVED** on these six orders |
| Partial-COD checkout app + order edit | **CONFIRMED** via properties/tags/`edited` |
| Transactions stored as products | **REJECTED** |
| Webhook/sync race as cause of the 249-order pattern | **REJECTED** for this pattern |
| Mixing original `total_price` with outstanding inflates `amount_paid` | **CONFIRMED** on A1 and B1 |
| Exact third-party app id (COD-K vs custom) | **LIKELY** Shop B `_codk_*`; Shop A similar COD-balance app — not required to fix |
| All 249 PARTIAL dups worldwide are this workflow | **LIKELY** (same price-pair + 100% of two tenants’ PARTIALs); not re-fetched for every order |

**Missing evidence (acceptable to proceed):** App Store listing / app id of the checkout extension; `orders/edited` webhook payload; `read_products` on Shop B (variant ids still present on REST).

---

## 14. Final recommendation

Proceed with a **currentQuantity-only import filter** plus current-total financial mapping. Do not implement until explicitly approved.

The previous audit’s “ignore `currentQuantity`” finding is now **payload-proven**. The previous “Shopify may already send two priced rows” finding is **true**, and those two rows are **not both live products**.
