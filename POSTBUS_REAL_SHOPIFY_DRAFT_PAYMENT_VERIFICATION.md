# POSTBUS — Real Shopify Draft Payment Verification

**Date:** 2026-10-14  
**Task:** Read-only live Shopify Draft Order payment verification  
**Live Shopify Admin API:** NOT EXECUTED  
**PostBus production/staging DB:** NOT EXECUTED  
**Source code changes:** none (this report only)  
**India Post / CEPT:** NOT EXECUTED  
**Webhook register/modify:** NOT EXECUTED  

**Authorization:** Operator selected **no live Shopify and no production DB**. Credentials in environment or `shopify_connections` were **not** used. Permission was **not** inferred from the presence of tokens.

**Verdict:** `LIVE_VERIFICATION_BLOCKED`  
**Access:** `LIVE_ACCESS_NOT_AUTHORIZED`

The original merchant-reported Draft PENDING bug is **not** claimed fully fixed. Mocked tests and code review do not substitute for live Draft payloads.

---

## A. Executive Summary

Live verification did not run. Scenarios A–F (checkout PAID, checkout COD, Draft marked paid, Draft COD, Draft manual pending, Draft bank transfer) have **no verified live examples**.

Code-level (not live) behavior still matches [`modules/shopify/PAYMENT.md`](modules/shopify/PAYMENT.md):

- Checkout `financial_status: paid` → PAID
- Pending + COD gateway / COD transaction gateway → COD
- Pending + `manual` or empty → PENDING
- Successful sale/capture covering the total → PAID
- Outstanding `0` alone is not PAID
- `manual` is never COD

If live Shopify returns `pending` + `manual` for a Draft the merchant believes is paid or COD, the current classifier will keep PENDING. That cannot be confirmed or refuted without an authorized GET of real orders.

## B. Authorized Shopify Access Scope

**LIVE_ACCESS_NOT_AUTHORIZED**

| Check | Result |
|---|---|
| Named shop authorized for this run | No |
| Read-only GET approved | No |
| Production PostBus DB read approved | No |
| Token used | No |
| Another merchant’s store accessed | No |

STOP condition from the verification prompt was applied: do not proceed because live reads were not established.

## C. Shopify API Version

**Code-level CONFIRMED** (not live-confirmed on a shop):

- REST orders/webhooks: `2025-01` (`SHOPIFY_API_VERSION` in [`modules/shopify/orders.ts`](modules/shopify/orders.ts))
- GraphQL: `2026-04` for fulfillment/tags only, not payment classification
- Payment path: REST `GET /orders/{id}.json` and, when financial status is missing/pending/authorized, `GET /orders/{id}/transactions.json`
- Requested OAuth scopes in app code include `read_orders` (see [`modules/shopify/oauth.test.ts`](modules/shopify/oauth.test.ts)). **Live granted scopes for any connected shop: UNVERIFIED**

## D. Selected Sample Orders

**NOT AVAILABLE / UNVERIFIED**

| Category | Status |
|---|---|
| A. Normal Shopify PAID | NOT AVAILABLE |
| B. Normal Shopify COD | NOT AVAILABLE |
| C. Completed Draft marked PAID | NOT AVAILABLE |
| D. Completed Draft COD | NOT AVAILABLE |
| E. Completed Draft manual pending | NOT AVAILABLE |
| F. Completed Draft bank transfer | NOT AVAILABLE |

No Shopify order IDs were fetched. Historical 1,084 PENDING / 124 prepaid shipment counts from an earlier audit were **not** re-queried and are not used as live samples.

## E. Draft Paid Verification

**UNVERIFIED** (live). **PARTIALLY VERIFIED** (code + mocks).

If Shopify reports `financial_status: paid` or a successful sale/capture covering the total, [`classifyShopifyRemotePayment`](modules/shopify/payment.ts) returns PAID. Whether Admin “Mark as paid” on a completed Draft actually sends those fields is **UNVERIFIED**.

If Shopify still reports `pending` with no successful transaction, PostBus correctly stays PENDING. That would be a Shopify-evidence gap, not a badge bug — **ROOT_CAUSE_NOT_CONFIRMED** without a live body.

## F. Draft COD Verification

**UNVERIFIED** (live). **AUTOMATIC_COD_NOT_DETERMINABLE** until a machine-readable COD gateway appears.

Code COD signals: `cash_on_delivery` / `\bcod\b` on `payment_gateway_names`, `gateway`, or transaction `gateway`. Exact `manual`, empty gateways, `shopify_draft_order`, and pending-alone are **not** COD.

If live Draft COD only yields `pending` + `manual`/empty: keep merchant collection confirm. Do not invent COD rules.

## G. Manual Pending Verification

**UNVERIFIED** (live). **CONFIRMED** in code/tests: pending + `manual` or empty → PENDING.

## H. Shopify Payment Field Comparison

No live rows. Template only:

| Order category | Shopify financial status | Shopify payment gateways | Transaction gateway | Transaction status | Outstanding | PostBus payment status | Expected | Classification source | Verified | Root cause |
|---|---|---|---|---|---|---|---|---|---|---|
| A–F | — | — | — | — | — | — | — | — | UNVERIFIED | LIVE_ACCESS_NOT_AUTHORIZED |

## I. PostBus Database Comparison

**BLOCKED**

No `orders.payment_status`, `orders.metadata.shopifyPayment`, or shipment/AWB rows were read. First point of divergence (Shopify vs import vs classifier vs persist vs UI) is **UNVERIFIED**.

UI path (code-level): Orders badge reads stored `payment_status` / `paymentStatus`. It does not invent PENDING independently of the DB.

## J. Payment Normalization Results

**Code-level CONFIRMED** via [`normalizeShopifyPaymentFields`](modules/shopify/payment.ts) + [`classifyShopifyRemotePayment`](modules/shopify/payment.ts). **Not run on live bodies.**

| Evidence (sanitized / hypothetical from tests, not live) | Classifier output |
|---|---|
| `financial_status: paid`, gateway `manual` | PAID |
| `pending` + `cash_on_delivery` | COD |
| `pending` + transaction gateway `cash_on_delivery` | COD |
| `pending` + `manual` or empty | PENDING |
| `pending` + successful sale/capture covering total | PAID |
| `pending` + outstanding `0`, no capture | PENDING |

These are mocked fixtures, not live verification.

## K. Webhook and Synchronization Findings

**Code CONFIRMED; live UNVERIFIED.**

Topics in `ORDER_WEBHOOK_TOPICS`: `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`. Whether the intended shop is subscribed: **UNVERIFIED** (no webhook list GET). HMAC/dedup/stale `updated_at` guards exist in code. Missed `orders/paid` as a cause of Draft PENDING: **UNVERIFIED**.

## L. India Post Financial Exposure

**UNVERIFIED** (no shipment reads). **Code CONFIRMED:** Shopify PENDING cannot be booked until Prepaid/COD confirm; booked AWBs are not rewritten; booked collect vs later Shopify PAID/COD is stored as `bookingConflict`.

No incident of COD booked as PREPAID can be confirmed without DB evidence.

## M. Current Fix Effectiveness

**Cannot be scored against live Drafts.**

The existing fix may already classify a Draft as PAID/COD **if** live Shopify returns paid/capture or a COD gateway. It will **not** auto-fix Drafts that Shopify leaves as `pending` + `manual`. Mocked 161-test pass does not prove merchant cases.

## N. Missing Payment Evidence

- Live REST order + transaction JSON for categories A–F
- Live `source_name` / Draft linkage on completed orders
- Live webhook subscription list and delivery times
- Live PostBus `payment_status` vs Shopify for the same `source_order_id`
- Live booked AWB payment_mode for PENDING Shopify orders

## O. Recommended Minimal Fix

**No application code change in this run.**

Next authorized step (human-gated):

1. Name one shop + organization.
2. Read-only PostBus: Shopify PENDING orders (`source`, `source_order_id`, `payment_status`, `metadata.shopifyPayment`, shipment status / AWB / `payment_mode`).
3. GET-only Shopify: `/admin/api/2025-01/orders/{id}.json` and `/orders/{id}/transactions.json`.
4. Run `classifyShopifyRemotePayment` locally on sanitized copies.
5. If Shopify is `paid` or capture-success and PostBus is PENDING → sync/classifier defect (then implement).
6. If Shopify is `pending` + COD gateway and PostBus is PENDING → mapper/sync defect (then implement).
7. If Shopify is `pending` + `manual`/empty for both “paid” and “COD” drafts → `AUTOMATIC_COD_NOT_DETERMINABLE` / unpaid-without-capture; keep merchant confirm; do not auto-COD.

Database impact of that next step: read-only. Webhook impact: inspect only. India Post: inspect only.

## P. Production Deployment Risks

Deploying the current classifier without live Draft proof risks:

- Leaving genuine Draft-paid orders PENDING if Shopify omits `paid`/capture
- Leaving genuine Draft COD PENDING if Shopify only sends `manual`
- Operators assuming mocked tests closed the merchant bug

**Production deploy remains NO-GO** until live evidence exists.

## Q. Remaining Unverified Scenarios

All of A–F. Staging. Production webhook registration on existing stores. Historical 1,084/124 recomputation. Draft Order API linkage (not in current scopes/path).

## R. Final Verification Verdict

**`LIVE_VERIFICATION_BLOCKED`**

| Item | Status |
|---|---|
| Draft PAID detection | UNVERIFIED live / PARTIALLY VERIFIED in code |
| Draft COD detection | UNVERIFIED live / AUTOMATIC_COD_NOT_DETERMINABLE until COD gateway |
| Webhook synchronization | Code CONFIRMED / live UNVERIFIED |
| India Post financial safety | Code CONFIRMED / live exposure UNVERIFIED |
| Production deployment readiness | **NO-GO** |

The original bug is **not** fully fixed on the evidence available in this run.
