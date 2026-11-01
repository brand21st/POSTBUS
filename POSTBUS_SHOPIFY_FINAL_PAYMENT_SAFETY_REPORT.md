# POSTBUS — Shopify Final Payment Safety Report

**Date:** 2026-10-14  
**Code-level verification:** executed locally  
**Mocked tests:** executed (161 passed / 0 failed / 0 skipped in targeted suites)  
**Staging verification:** NOT EXECUTED  
**Live Shopify verification:** NOT EXECUTED / UNVERIFIED  
**Production verification / writes:** NOT EXECUTED  

**Verdict:** **NO-GO for production deploy.** **GO to merge** the code for review if the targeted suites remain green.

## A. Executive Summary

The previous Draft payment implementation was re-audited against current code. Checkout PAID/COD mapping is preserved. Draft `pending` + `manual`/empty remains PENDING. COD auto-detect now also reads transaction `gateway` names through the same regex; `manual` is still never COD.

Confirmed defects that were **FIXED**:

- Historical prepaid risk false positive (`CONFIRMED_VALID_PREPAID` without paid evidence)
- `retryShipment` enqueue bypass of Shopify PENDING
- Silent booked-AWB vs Shopify collect mismatch (now recorded, AWB not rewritten)
- Merchant confirm shipment update errors ignored
- Merchant Prepaid UI implying captured Shopify funds

## B. Previously Reported Issues

| Claim | Status |
|---|---|
| Shared REST/GraphQL payment mapper | CONFIRMED present |
| Successful sale/capture → PAID | CONFIRMED |
| `orders/paid` topic | CONFIRMED |
| Incomplete webhook re-fetch | CONFIRMED |
| PENDING booking block at fulfill/bulk/CEPT | CONFIRMED |
| Merchant confirm API | CONFIRMED, then tightened |
| Historical prepaid = valid prepaid | CONFIRMED defect; FIXED |
| Live Draft COD/PAID payloads | UNVERIFIED |

## C. Root Cause Evidence

Classifier: [`modules/shopify/payment.ts`](modules/shopify/payment.ts). Persist: [`upsertShopifyOrder`](modules/shopify/orders.ts). UI reads stored `payment_status`. Drafts with `financial_status: pending` and gateway `manual` fall through to PENDING by contract.

## D. Draft COD Detection Findings

**PARTIALLY VERIFIED (code + mocks only).**

Reliable COD evidence in this codebase:

- `payment_gateway_names` / `gateway` matching `cash_on_delivery` / `\bcod\b`
- Transaction `gateway` matching the same regex (now merged into `shopifyPaymentGateways`)

Not used as COD (and must not be):

- Exact gateway `manual`
- Empty gateways
- `source_name = shopify_draft_order`
- `total_outstanding === 0` alone

No Draft Order API, `payment_terms`, or `note_attributes` fetch. Live A–F store scenarios: **UNVERIFIED**. Automatic Draft COD is **not** claimed solved for generic manual drafts.

## E. Draft Paid Detection Findings

**PARTIALLY VERIFIED.**

PAID when `financial_status`/`displayFinancialStatus` is `paid`, or a successful sale/capture covers the total. Outstanding 0 without a successful transaction stays PENDING.

## F. Historical Risk Classification Fix

**FIXED** in [`modules/shopify/reconcile.ts`](modules/shopify/reconcile.ts).

| Scenario | Category |
|---|---|
| Unbooked PREPAID | `UNBOOKED_REQUIRES_REVIEW` |
| Booked PREPAID + Shopify paid/capture | `CONFIRMED_VALID_PREPAID` |
| Booked PREPAID + COD gateway | `CONFIRMED_COD_BOOKED_PREPAID` |
| Booked PREPAID + pending/manual/no body | `INSUFFICIENT_EVIDENCE` |
| Merchant prepaid override only | `INSUFFICIENT_EVIDENCE` (collection mode, not captured payment) |

Historical 1,084 / 124 counts were **not** re-queried. Dry-run script still makes **no** DB or Shopify calls.

## G. Merchant Confirmation Security Review

**PARTIALLY VERIFIED (mocked).**

- Route: `POST /api/v1/orders/:id/shopify-payment` via [`lib/api/v1/commerce.ts`](lib/api/v1/commerce.ts)
- Permission: `orders.write` (same as WhatsApp confirm)
- Tenant: `organization_id` + `source=SHOPIFY` + CAS `payment_status=PENDING`
- Amounts: `settleOrderPayment` on server `total_amount`
- Shipments: DRAFT/FAILED and `booked_at` null only; update errors now thrown
- Does not call Shopify Admin mutations or enqueue India Post booking
- Duplicate confirm → CONFLICT
- RLS remains membership-based (existing); VIEWER blocked at API, not at SQL. No new migration.

## H. Authorization and Tenant Isolation

Confirm and retry load orders with `organization_id`. Upsert payment updates use `.eq("organization_id", …)`. Cross-org confirm returns not found. **Mocked.** Live multi-tenant probe: **NOT EXECUTED**.

## I. COD Amount Integrity

`shipmentCollectFromOrder` remains the booking collect function. Article validator rejects COD amount ≤ 0, NaN, and negative. Prepaid CEPT `codr_cod` / `value_for_codr_cod` stay empty even if a stray `codAmount` is present. PARTIAL remainder still books as COD collect.

## J. India Post Booking Safety

`shopifyPendingBookingBlocked` on fulfill enqueue, bulk validate, CEPT `runIndiaPostBooking`, and now `retryShipment`. Processing without booking remains allowed. Manual PENDING is not globally blocked. Booked AWBs are not rewritten on confirm or sync.

## K. Webhook and Synchronization

`orders/paid` remains in `ORDER_WEBHOOK_TOPICS`. Incomplete financial status re-fetches REST order + transactions; fetch failure keeps the webhook body. Stale `updated_at` does not overwrite newer stored payment. Duplicate webhook id does not create a second order. **Do not register webhooks on production during this task** — not done.

Shopify `paid` supersedes a local COD/Prepaid override on the **order**. If an AWB is already booked with a conflicting collect mode, `metadata.shopifyPayment.bookingConflict` is set and audited (`order.shopify_booking_conflict`); the AWB is unchanged.

## L. Files Changed

- `modules/shopify/payment.ts`
- `modules/shopify/orders.ts`
- `modules/shopify/reconcile.ts`
- `modules/shopify/PAYMENT.md`
- `scripts/shopify-payment-reconcile.ts`
- `modules/orders/service.ts`
- `modules/shipments/service.ts`
- `app/dashboard/orders/[id]/page.tsx`
- Tests listed in section N
- This report

## M. Database Changes

None. No migrations. Evidence and conflicts stay on `orders.metadata.shopifyPayment`.

## N. Tests Executed

Targeted Vitest (mocked Shopify / CEPT):

- `modules/shopify/payment.test.ts`
- `modules/shopify/orders.test.ts`
- `modules/shopify/reconcile.test.ts`
- `modules/orders/shopify-payment-confirm.test.ts`
- `modules/orders/payment.test.ts`
- `lib/dashboard/records.test.ts`
- `modules/india-post/booking-idempotency.test.ts`
- `modules/india-post/article-validator.test.ts`
- `modules/shipments/shopify-retry.test.ts`
- `lib/api/v1-permissions.test.ts`

Coverage of prompt items 01–36 is **mocked unit coverage**, not live Shopify/CEPT.

## O. Tests Passed / Failed / Skipped

**161 passed, 0 failed, 0 skipped** (last targeted run).

Staging, live Shopify, and production recon: **skipped / NOT EXECUTED**.

## P. Remaining Unverified Scenarios

- Live checkout PAID / COD / Draft marked paid / Draft COD / bank transfer / generic manual
- Draft-to-Order payment field preservation on real shops
- Production webhook `orders/paid` registration on existing stores
- Concurrent confirm vs booking under real DB load
- Staging end-to-end

## Q. Historical Reconciliation Status

**NOT EXECUTED** against production. Helpers and dry-run script are read-only. Do not invent mismatch counts. An authorized operator may later GET Shopify orders and print bucket counts only.

## R. Production Deployment Prerequisites

1. Code review / merge (this change set)
2. Separate authorized deploy (not this task)
3. Existing shops re-register webhooks on next sync for `orders/paid`
4. Optional authorized dry-run GET reconcile
5. No automatic historical PENDING remediations
6. Operational review process for `bookingConflict` metadata

## S. Rollback Plan

Revert the git commit. No schema rollback. Metadata keys are additive.

## T. Final GO / NO-GO Verdict

| Gate | Verdict |
|---|---|
| Production deploy / Coolify / DB writes | **NO-GO** |
| Merge for review | **GO** (targeted tests passed) |
| Claim live Draft COD automation solved | **NO-GO** (UNVERIFIED; manual/empty stays PENDING) |
