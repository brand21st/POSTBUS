# POSTBUS — Shopify Draft Order Payment Status Audit

**Date:** 2026-10-14  
**Scope:** Read-only investigation. No code changes, no database writes, no Shopify mutations, no India Post booking calls.  
**Shopify API versions in code:** REST `2025-01`, GraphQL `2026-04`.  
**Final verdict:** ROOT CAUSE PARTIALLY CONFIRMED

---

## SECTION A — Executive Summary

PostBus does **not** have a separate Draft Order pipeline. Completed Shopify Draft Orders become normal Shopify Orders and enter PostBus through the same REST webhook / REST list-sync path as checkout orders. Payment classification is centralized in `mapShopifyPaymentStatus()` and runs on every import and every update.

The Orders page does **not** invent “Pending Payment”. It renders `orders.payment_status` from the database. Production data shows **1,084 Shopify rows already stored as `PENDING`**, all with empty `metadata` and `amount_paid = 0`.

The classifier is binary for unpaid Shopify states:

- `financial_status` in `{pending, authorized}` **and** gateway name matches `/cash[_\s-]*on[_\s-]*delivery|\bcod\b/i` → **COD**
- otherwise those states (and any unknown / missing status) → **PENDING**
- only exact `paid` → **PAID**

That is why checkout **paid** and checkout **COD** work, while completed Draft Orders often do not:

1. **Scenario B (expected COD):** Shopify Admin draft completion frequently leaves `financial_status: pending` with gateway `manual` or empty. That is **not** a COD gateway string, so PostBus stores `PENDING`. Checkout COD works because those orders carry `Cash on Delivery (COD)` / `cash_on_delivery`.
2. **Scenario A (expected PAID):** If Shopify actually sends `financial_status: paid`, PostBus **would** store `PAID`. A lasting `PENDING` badge therefore means the payload reaching `mapShopifyPaymentStatus` is **not** `"paid"`. The usual Shopify meaning of that payload is “payment pending / manual method / payment terms”, not “captured”. This is **LIKELY** for Draft “Pay later” / unpaid complete; it is **UNVERIFIED** for a true Admin “Mark as paid” because PostBus never stores `financial_status`, gateway names, `source_name`, or transactions.

The first incorrect classification happens in **`modules/shopify/orders.ts` → `mapShopifyPaymentStatus`**, then is written by **`upsertShopifyOrder`**. The UI is a faithful display of that stored enum.

---

## SECTION B — Observed Bug

| | Actual (PostBus) | Expected |
|---|---|---|
| Checkout Shopify paid order | PAID | PAID |
| Checkout Shopify COD order | COD | COD |
| Completed Draft marked paid | PENDING | PAID |
| Completed Draft with COD selected | PENDING | COD |

**UI wording (CONFIRMED):** the Orders table badge is `titleCase("PENDING")` → **“Pending”**, not the string “Pending Payment”. The filter label is **“Not paid yet”** (`PAYMENT_STATUS_LABELS.PENDING`). Merchants describing “Pending Payment” are referring to this `PENDING` enum.

**Do not treat Shopify pending as COD.** The current code already follows that rule; that is why Draft COD without a COD gateway string becomes PENDING instead of COD.

---

## SECTION C — Current Shopify Integration Architecture

Completed Draft Orders are Shopify **Orders**. PostBus never calls `draftOrders` APIs and never branches on `source_name`.

```
Shopify Admin completes Draft
        ↓
Shopify Order created (REST resource)
        ↓
A) Webhook orders/create | orders/updated | orders/cancelled
   POST /api/v1/webhooks/shopify
   handleInboundWebhook → importShopifyWebhookOrder → upsertShopifyOrder
OR
B) Manual / background REST GET /admin/api/2025-01/orders.json
   (status=open, fulfillment_status=unshipped)
   syncUnfulfilledShopifyOrders → upsertShopifyOrder
        ↓
orders.payment_status (+ amount_paid, cod_amount)
        ↓
GET orders API mapOrder()
        ↓
Orders page StatusBadge
```

| Piece | Path | Notes |
|---|---|---|
| REST client | `modules/shopify/orders.ts` `shopifyRequest` (~1222) | API version `SHOPIFY_API_VERSION = "2025-01"` (line 18) |
| GraphQL client | `shopifyGraphql` (~1236) | Version `2026-04` (line 19). Used for **fulfillment / variant shipping**, not order payment import |
| Order list fetch | `fetchUnfulfilledShopifyOrders` (~2362) | Full REST order objects; **no `fields=` filter**, so `financial_status` and `payment_gateway_names` are present when Shopify sends them |
| Webhooks registered | `ORDER_WEBHOOK_TOPICS` (lines 20–25), `registerShopifyOrderWebhooks` (~1948) | `orders/create`, `orders/updated`, `orders/cancelled`, `fulfillment_orders/progress_reported`. **Not** `orders/paid`, **not** draft-order topics |
| Webhook handler | `lib/api/v1/inbound-webhooks.ts` (~59–145) | HMAC verify → parse body as `ShopifyRemoteOrder` → `importShopifyWebhookOrder` |
| Sync job | `modules/shopify/sync-job.ts`, `workers/processor.ts` `shopifySync` (~797) | Same `upsertShopifyOrder` |
| Manual sync | Dashboard Shopify sync → same `syncUnfulfilledShopifyOrders` | Same mapper |

**Different code paths for Draft vs checkout:** **NOT APPLICABLE.** There is no Draft-specific import. The difference is only the **Shopify fields on the resulting Order**.

**GraphQL order payment query:** **NOT APPLICABLE** for import. GraphQL queries in this module are fulfillment/progress/tags/variant metafields.

---

## SECTION D — Payment Data Flow

### 1. Shopify

Shopify REST Order typically exposes `financial_status`, `payment_gateway_names`, `gateway` (legacy), `total_price`, `total_outstanding`. GraphQL equivalent is `displayFinancialStatus` / `paymentGatewayNames`.

Shopify Admin docs (`OrderDisplayFinancialStatus`, 2026-04):

- **PAID:** captured, or **marked as paid**.
- **PENDING:** payment provider delay, **or manual payment methods**.
- Draft complete (`draftOrderComplete` / REST `draft_orders/{id}/complete.json`): `payment_pending=false` → resulting order marked paid; `payment_pending=true` → unpaid / capturable later. Completing can also attach **payment terms** or a **paymentGatewayId**.

**Live Draft payloads for affected merchants:** **NOT VERIFIED** (not stored).

### 2. Shopify API / Webhook

Webhook body is `JSON.parse(raw) as ShopifyRemoteOrder` with **no camelCase normalization** (`inbound-webhooks.ts` 124–129).

REST `format: json` webhooks use `financial_status` (snake_case). If a shop ever delivered GraphQL-shaped payloads (`displayFinancialStatus`, `paymentGatewayNames`), both would be unread and the mapper would default to **PENDING**. That failure mode is **LIKELY** only if webhook format is GraphQL; with current REST registration it is **UNVERIFIED**.

Webhook import **does not re-fetch** the order. It only hydrates product weights/images (`importShopifyWebhookOrder` 2333–2346).

### 3. Order import

`upsertShopifyOrder` (2001+) maps payment once:

```
paymentStatus = mapShopifyPaymentStatus(
  remote.financial_status,
  remote.payment_gateway_names ?? remote.gateway
)
collect = mapShopifyCollectable(remote, paymentStatus)
orders.payment_status = collect.paymentStatus
```

Same function for create, update, webhook, and poll sync. **Classification is centralized.**

### 4. Payment normalization

`mapShopifyPaymentStatus` (506–526) then `mapShopifyCollectable` (528–551) then `settleOrderPayment` (`modules/orders/payment.ts`).

`total_outstanding` is applied **only when status is already PARTIAL**. For PENDING/PAID/COD it is ignored. A Draft that Shopify reports as pending with outstanding `0` would still be stored PENDING / `amount_paid = 0`.

### 5. Database

`orders.payment_status` enum default `'PENDING'` (`supabase/migrations/20260919090100_commerce_shipping.sql` line 62). Shopify insert always sets `payment_status` from `collect`. `metadata` is never written on Shopify upsert (**CONFIRMED** empty `{}` for all Shopify rows sampled by aggregate query).

No columns for Shopify financial status, gateway, `source_name`, or transactions.

### 6. Orders API

`listOrders` / `getOrder` → `mapOrder` copies `payment_status` → `paymentStatus` (`modules/orders/service.ts` 564–577). No remapping.

### 7. Orders page / badge

`app/dashboard/orders/page.tsx` ~614 and `app/dashboard/orders/[id]/page.tsx` ~202: `<StatusBadge value={row.paymentStatus ?? row.payment_status} />`.

`StatusBadge` (`components/dashboard/status-badge.tsx` 95–135) displays `titleCase(value)` except a few shipment/print labels. `PENDING` → “Pending”.

**First incorrect stage:** `mapShopifyPaymentStatus` when `financial_status` is not `"paid"` and gateway is not COD-like. **Not** the UI.

---

## SECTION E — Normal Order vs Draft Order Comparison

Shopify live payloads for representative orders were **not** available (metadata empty; no webhook inbox for Shopify). Values below are **code-expected** from the mapper plus Shopify public field semantics. Do not treat the Shopify columns as captured production samples.

| Field | A. Checkout paid | B. Checkout COD | C. Completed Draft marked paid | D. Completed Draft COD |
|---|---|---|---|---|
| Shopify `financial_status` (typical) | `paid` | `pending` | **UNVERIFIED.** Docs: mark-as-paid → `paid`. Lasting PostBus PENDING implies payload ≠ `paid` (often `pending` for pay-later / manual / terms) | **UNVERIFIED.** Often `pending` |
| Shopify gateway | card / UPI / Shopify Payments, etc. | `cash_on_delivery` / `Cash on Delivery (COD)` | typically `manual` or empty if unpaid complete | **UNVERIFIED.** COD only if `paymentGatewayId` / name matches regex; Admin draft COD often **manual/empty** |
| Transactions | **NOT USED** by PostBus | **NOT USED** | **NOT USED** | **NOT USED** |
| Raw imported fields used | `financial_status`, `payment_gateway_names`/`gateway`, prices, `total_outstanding` (PARTIAL only) | same | same | same |
| `mapShopifyPaymentStatus` | **PAID** | **COD** (pending + COD gateway) | **PAID** only if `paid`; else **PENDING** | **COD** only if gateway matches; else **PENDING** |
| DB `payment_status` | PAID (3,699 Shopify rows) | COD (677) | would be PAID or PENDING depending on Shopify | would be COD or PENDING |
| Displayed badge | “Paid” (`titleCase("PAID")`) | “Cod” | “Pending” when stored PENDING | “Pending” when stored PENDING |
| `source_name` / draft flag | **NOT READ** | **NOT READ** | **NOT READ** (`shopify_draft_order` never inspected) | **NOT READ** |

Unit tests **confirm** the mapping contract (`modules/shopify/orders.test.ts` 106–111):

- `"paid"` → `PAID`
- `"pending"` → `PENDING`
- `"pending", ["cash_on_delivery"]` → `COD`
- `"authorized", "Cash on Delivery (COD)"` → `COD`
- `"paid", ["cash_on_delivery"]` → **`PAID` (COD gateway does not win over paid)**

---

## SECTION F — Payment Mapping Findings

### Fields retrieved vs used

| Shopify field | Queried? | Used? |
|---|---|---|
| `financial_status` | Yes (REST body / list) | **Yes — primary** |
| `payment_gateway_names` | Yes if present | **Yes — COD only** |
| `gateway` | Yes if present | Fallback if names missing |
| `total_price` | Yes | Totals + settle |
| `total_outstanding` | Yes if present | **PARTIAL only** |
| `displayFinancialStatus` | No | No |
| `paymentGatewayNames` | No | No |
| `transactions` | No | No |
| `payment_terms` | No | No |
| `source_name` | No | No |
| `order source` / app id | No | No |

`ShopifyRemoteOrder` (`modules/shopify/orders.ts` 114–136) is the contract. Anything not on that type is dropped even if Shopify sent it.

### CONFIRMED mapping rules

```499:526:modules/shopify/orders.ts
const COD_GATEWAY = /cash[_\s-]*on[_\s-]*delivery|\bcod\b/i;

export function isShopifyCodGateway(gateways?: string[] | string | null) {
  const list = Array.isArray(gateways) ? gateways : gateways ? [gateways] : [];
  return list.some((gateway) => COD_GATEWAY.test(gateway));
}

export function mapShopifyPaymentStatus(
  value?: string | null,
  gateways?: string[] | string | null
): PaymentStatus {
  switch ((value || "").toLowerCase()) {
    case "paid":
      return "PAID";
    case "partially_paid":
      return "PARTIAL";
    case "refunded":
    case "partially_refunded":
      return "REFUNDED";
    case "voided":
      return "FAILED";
    case "pending":
    case "authorized":
    default:
      if (isShopifyCodGateway(gateways)) return "COD";
      return "PENDING";
  }
}
```

**Incorrect behavior relative to Draft business rules:**

1. Missing `financial_status` (`""` / `null`) hits `default` → PENDING unless COD gateway. **CONFIRMED.**
2. `pending` + `manual` / empty / Razorpay-without-COD-name → PENDING. **CONFIRMED.** This is the Draft-complete-as-unpaid and Draft-COD-without-COD-gateway path.
3. `paid` always wins, including over a COD gateway. Draft COD that Shopify later marks paid becomes **PAID**, not COD. **CONFIRMED** by tests. Opposite of Scenario B if merchants mark COD drafts paid in Shopify.
4. Case-insensitive status compare: **CONFIRMED** (`.toLowerCase()`). Gateway regex is case-insensitive. Not the bug.
5. No Draft handling, no `manual` → PAID heuristic, no transaction success → PAID. **CONFIRMED.**
6. Duplicated rules across import paths: **NOT APPLICABLE** — one function.

Hardcoded fallback to PENDING is intentional in tests. It is the **correct** behavior for true unpaid checkout, and the **wrong** outcome for merchants who believe a Draft is paid/COD without Shopify sending `paid` or a COD gateway string.

---

## SECTION G — Webhook and Background Sync Findings

| Topic | Status |
|---|---|
| `orders/create` | Subscribed. Imports/updates via same mapper |
| `orders/updated` | Subscribed. Existing rows **do** overwrite `payment_status` (2064–2065) |
| `orders/paid` | **Not subscribed.** `orders/updated` should still carry financial status; extra `orders/paid` is belt-and-suspenders **LIKELY** useful, not proven required |
| Draft complete events | **NOT APPLICABLE** — Shopify emits Order webhooks after complete |
| Idempotency | `idempotency_keys` key `shopify:{webhook-id}` (`inbound-webhooks.ts` 87–98). Per event, not per order. Later paid updates are **not** blocked by create idempotency |
| Auto-sync gate | If `autoShopifySync` is off, **webhook import is skipped** (`importShopifyWebhookOrder` 2329–2331). Poll/manual sync still uses the same mapper when run |
| Background sync overwrite | `fetchUnfulfilledShopifyOrders` + `upsertShopifyOrder` **will overwrite** payment on existing orders with current REST values. It will **not** invent PAID. If Shopify still says pending, PostBus stays PENDING |
| Existing-row update errors | `update(totals)` result is **not checked** (2065). Failed updates could leave stale PENDING. **LIKELY** operational risk; **UNVERIFIED** as the Draft cause |
| Shipment payment on update | Existing-order path updates **order** payment only. It does **not** refresh `shipments.payment_mode`. **CONFIRMED** |

Race (LIKELY, not proven): `orders/create` while still pending, then mark paid. `orders/updated` should fix the order row if Shopify sends `paid`. If the merchant still sees PENDING, either the paid webhook never applied or Shopify never sent `paid`.

---

## SECTION H — Database Findings

**Schema (CONFIRMED)** — `public.orders`:

| Column | Role |
|---|---|
| `source` | `SHOPIFY` / etc. |
| `source_order_id` | Shopify order id |
| `organization_id` | Tenant |
| `payment_status` | Enum; default `PENDING` |
| `amount_paid` | Settled prepaid amount |
| `cod_amount` | Collect-on-delivery amount |
| `total_amount` | Order total |
| `metadata` | JSONB default `{}`; **unused on Shopify import** |
| `updated_at` | Timestamp |

No `financial_status`, `payment_gateway`, `payment_method`, or outstanding-amount column.

**Read-only aggregates (sanitized, 2026-10-14):**

| source | payment_status | n | empty metadata | amount_paid=0 | cod_amount=0 |
|---|---|---|---|---|---|
| SHOPIFY | PENDING | 1084 | 1084 | 1084 | 1084 |
| SHOPIFY | PAID | 3699 | 3699 | 0 | 3699 |
| SHOPIFY | PARTIAL | 344 | 344 | 0 | 0 |
| SHOPIFY | COD | 677 | 677 | 677 | 0 |
| SHOPIFY | REFUNDED | 33 | 33 | 33 | 33 |
| SHOPIFY | FAILED | 80 | 80 | 80 | 80 |

These PENDING rows match `settleOrderPayment({ paymentStatus: "PENDING" })` exactly. They cannot be distinguished as Draft vs unpaid checkout because `source_name` was never stored.

Shopify PENDING × shipment:

| payment_status | shipment payment_mode | n |
|---|---|---|
| PENDING | (no shipment) | 967 |
| PENDING | PREPAID | 124 |

124 Shopify PENDING orders already have **PREPAID** shipments.

Draft-specific defaulting in SQL: **NOT APPLICABLE.** Default PENDING applies to all sources; Shopify writes an explicit status.

---

## SECTION I — Frontend Payment Badge Findings

**Problem location is not the frontend.**

- Table: `app/dashboard/orders/page.tsx` ~614  
- Detail: `app/dashboard/orders/[id]/page.tsx` ~202  
- Filter labels: `types/domain.ts` `PAYMENT_STATUS_LABELS` (`PENDING: "Not paid yet"`)  
- Badge text: `titleCase` → “Pending”, “Paid”, “Cod”

API `mapOrder` does not translate PENDING into another meaning.

If the backend stored PAID/COD, the badge would show Paid/Cod. Production PENDING counts show the wrong value **already in the database**.

---

## SECTION J — India Post COD Risk Assessment

Booking payload (`modules/india-post/booking-payload.ts` 82–83, 195–197):

- `codr_cod` = `"COD"` only when `paymentMode === "COD"`
- otherwise `codr_cod = ""` and `value_for_codr_cod` empty / unused
- `paymentMode` comes from shipment (`booking-run.ts` ~454), and shipment collect comes from **order** payment (`shipmentCollectFromOrder`)

`shipmentCollectFromOrder` (`modules/orders/payment.ts` 71–96):

- `COD` → `payment_mode: COD`, `cod_amount` = stored or total  
- `PARTIAL` with remainder → COD collect  
- **everything else, including PENDING and PAID** → **`PREPAID`, `cod_amount: 0`**

`indiaPostIsPrepaid` (`modules/india-post/endpoints.ts` 200–213): any mode other than COD / CASH_ON_DELIVERY is CONTRACT/`CO` and label “Prepaid”.

**Risks if Draft COD is stored as PENDING (CONFIRMED by code, not by a live CEPT call):**

| Risk | Outcome |
|---|---|
| COD booked as prepaid | **Yes** — `codr_cod` blank, `payment_mode` CO/PREPAID |
| Wrong COD collection amount | **Yes** — `value_for_codr_cod` empty, `cod_amount` 0 |
| Missing COD indicator on label | **Yes** — overlay “Prepaid” |
| Incorrect India Post booking for true unpaid PENDING | Intended as prepaid; may still be wrong commercially if the merchant will collect cash |

124 Shopify PENDING + PREPAID shipments in production show this path already executes.

**PAID Draft misclassified as PENDING:** India Post still books prepaid (empty COD). Operationally safer than the reverse, but the Orders badge is wrong.

**Reverse COD risk:** checkout COD later `financial_status: paid` becomes order PAID while an earlier shipment may remain COD (63 PAID orders with COD shipments in the aggregate). Separate inconsistency.

No India Post API calls were made for this audit.

---

## SECTION K — Root Cause with Evidence

### CONFIRMED

1. **Single classifier; pending/non-COD → PENDING**  
   File: `modules/shopify/orders.ts`  
   Function: `mapShopifyPaymentStatus`  
   Lines: 499–526  
   Pending/authorized/missing status without a COD-like gateway string is stored as `PENDING`. Unit tests lock this in (`modules/shopify/orders.test.ts` 107–109).

2. **That classifier writes the database on every Shopify upsert**  
   File: `modules/shopify/orders.ts`  
   Function: `upsertShopifyOrder`  
   Lines: 2028–2065, 2103–2116  
   `payment_status` is set from `mapShopifyCollectable` → `settleOrderPayment`. Existing orders are updated in place.

3. **COD detection is gateway-string-only**  
   Same file, `isShopifyCodGateway` 501–504. No Draft flag, no payment terms, no “manual”, no transactions.

4. **No Draft-specific path**  
   No `draft`, `source_name`, or `shopify_draft_order` in `modules/shopify`. Completed drafts use the same pipeline as checkout orders.

5. **UI is not the first failure**  
   `mapOrder` 577; Orders page ~614; `StatusBadge` 95–135. Badge reflects DB `PENDING`.

6. **Raw Shopify payment evidence is discarded**  
   `metadata` unused; 100% of Shopify orders have `metadata = {}`. Gateway and financial_status cannot be reconstructed from PostBus.

7. **India Post COD fields follow shipment/order payment, not Shopify**  
   PENDING → PREPAID → empty `codr_cod`.

8. **Shipment payment is not refreshed on later order payment updates**  
   `upsertShopifyOrder` existing branch only updates `orders`.

### LIKELY

1. **Scenario B:** Admin Draft complete with COD intent but without Shopify’s COD gateway name (`manual` / empty / custom) → `pending` + non-COD gateway → PostBus `PENDING`. Explains “checkout COD works, Draft COD does not” without contradicting working checkout COD (those carry `cash_on_delivery`).

2. **Scenario A:** Merchant “marks paid” in Admin using **Pay later / payment pending / payment terms / unpaid complete**, which Shopify still reports as `pending` (docs: PENDING includes manual methods). PostBus correctly maps Shopify pending → PENDING, which is **wrong for the merchant’s expectation** of PAID.

3. **Webhook create-before-paid** plus a missed/failed `orders/updated` could leave PENDING even after a later mark-as-paid. Update errors are ignored (2065). `orders/paid` is not subscribed.

4. **`total_outstanding` ignored for PENDING** could hide a fully collected Draft if Shopify left status pending with outstanding 0.

### UNVERIFIED

1. Actual `financial_status` / `payment_gateway_names` / `source_name` / transactions on a failing Draft. **Evidence gap: no stored payloads; no Shopify Admin sample in-repo.**
2. GraphQL-shaped webhooks causing unread `displayFinancialStatus`. REST registration makes this less likely.
3. That every one of the 1,084 Shopify PENDING rows is a Draft (many will be genuine unpaid checkouts).
4. Shopify sending `financial_status: paid` for affected Drafts and PostBus still showing PENDING (that would contradict the mapper unless the field is missing/renamed or the DB update failed).

### NOT APPLICABLE

- Separate Draft Order GraphQL import  
- Frontend-only badge bug as the primary cause  
- Assuming Shopify `pending` === COD  
- WooCommerce mapper (no `modules/woocommerce` payment classifier in this tree)

---

## SECTION L — Recommended Fix Plan

**Do not implement in this audit.** Smallest safe correction first.

### Smallest safe correction

Keep `mapShopifyPaymentStatus` as the single classifier. Expand **inputs**, not scattered UI hacks.

1. **Normalize Shopify payment fields** before mapping (REST snake_case and GraphQL camelCase): `financial_status` / `displayFinancialStatus`, `payment_gateway_names` / `paymentGatewayNames`.
2. **Do not treat pending as COD** unless a verified COD signal exists (current regex, plus explicit allow-list if merchants use named COD apps).
3. **Treat as PAID only with evidence:** `financial_status/displayFinancialStatus = paid`, **or** a successful sale/capture transaction, **or** (optional, gated) `total_outstanding = 0` with a successful recorded payment — never “Draft + pending + manual” blindly.
4. **On webhook:** after HMAC, **GET the Order** (REST `GET /orders/{id}.json` or GraphQL `order { displayFinancialStatus paymentGatewayNames transactions { kind status gateway } sourceName }`) so classification does not depend on a possibly early `orders/create` body. This is the smallest change that also covers mark-as-paid-after-complete.
5. Persist sanitised debug snapshot in `orders.metadata`: `financial_status`, `gateways`, `source_name`, `outstanding` (no PII).
6. When order payment changes, update open shipments’ `payment_mode` / `cod_amount` if not already booked.

### Follow-ups (still not in this change)

- Subscribe `orders/paid` as well as `orders/updated`.  
- Check `update()` errors on existing orders.  
- Do **not** map all Draft pending orders to COD.  
- Do **not** map `paid` + COD gateway to COD if the product rule is “paid means prepaid” — document that product choice; today paid wins.

---

## SECTION M — Regression Test Requirements

1. Checkout paid → PAID (existing).  
2. Checkout pending + `cash_on_delivery` → COD (existing).  
3. Checkout pending + empty gateway → PENDING (must remain; not COD).  
4. Draft complete `payment_pending=false` / `financial_status: paid` + `manual` → **PAID**.  
5. Draft complete `payment_pending=true` + `manual` → **PENDING** (not COD, not PAID).  
6. Draft complete pending + `Cash on Delivery (COD)` → **COD**.  
7. Draft complete pending + gateway `manual` only → **PENDING**, not COD.  
8. Create webhook pending then update/paid with `paid` → DB becomes PAID.  
9. GraphQL-shaped payload `displayFinancialStatus: PAID` still maps PAID after normalization.  
10. Open shipment payment_mode updates when order payment changes; booked shipments do not silently flip CEPT fields.  
11. India Post serializer: COD order → `codr_cod=COD` and `value_for_codr_cod`; PENDING/PAID → empty COD fields.  
12. Paid + COD gateway remains PAID unless product explicitly changes that rule.

---

## SECTION N — Production Safety Considerations

- Classification changes will rewrite `payment_status` on the next Shopify sync for **existing** unfulfilled orders. That can flip 1,084 PENDING rows — only some are Draft bugs.  
- Reclassify-to-COD without a real COD gateway would book cash collection incorrectly. Prefer re-fetch from Shopify over heuristics.  
- Do not backfill from empty `metadata`; re-pull from Shopify.  
- Do not change already-booked India Post articles automatically.  
- Store payment evidence for support without customer PII.  
- Keep webhook HMAC and idempotency. Re-fetch is read-only against Shopify.

---

## SECTION O — Final Audit Verdict

**ROOT CAUSE PARTIALLY CONFIRMED**

**Where the incorrect PostBus classification is produced**

`modules/shopify/orders.ts`, function `mapShopifyPaymentStatus` (lines 506–526), invoked from `upsertShopifyOrder` (lines 2028–2031).

Any Shopify order (including a completed Draft) whose `financial_status` is missing, `pending`, or `authorized`, and whose gateway string does not match the COD regex, is stored as `PENDING` and shown as “Pending”. Checkout paid/COD keep working because they send `paid` or a COD gateway name.

**What is not fully proven**

Whether a merchant’s Admin “Mark as paid” on a Draft is actually `financial_status: paid` in the payload PostBus receives. If it is `paid`, this mapper would already show PAID; the remaining causes would be a missing/renamed field or a failed update. PostBus does not retain the evidence needed to distinguish those cases.

**Smallest safe correction (not implemented)**

Normalize payment fields; optionally re-fetch the Order on webhook; classify PAID only from `paid` or successful transactions; classify COD only from verified COD gateway/method; persist those raw fields; refresh open shipment collect amounts. Do not map all Draft pendings to PAID or COD.
