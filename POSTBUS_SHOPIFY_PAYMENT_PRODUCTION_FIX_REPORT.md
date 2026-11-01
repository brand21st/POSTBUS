# POSTBUS — Shopify Draft Payment Production Fix Report

**Date:** 2026-10-14  
**Deploy:** NO-GO (code/tests only; no production writes, migrations, or Coolify deploy)  
**Merge:** GO if local tests for the touched suites pass  

## A. Executive Summary

PostBus now normalizes REST and GraphQL Shopify payment aliases, classifies completed Drafts with the same mapper as checkout orders, stores a non-PII evidence snapshot on `orders.metadata.shopifyPayment`, re-fetches incomplete payment webhooks, and **blocks India Post booking for Shopify PENDING** until the merchant confirms Prepaid or COD.

Checkout paid and COD mapping is unchanged. Generic `manual` pending is still PENDING. Live merchant Draft payloads remain unverified in production; representative REST bodies are covered by unit tests.

## B. Root Cause

`mapShopifyPaymentStatus` treated any non-paid, non-COD-gateway order as PENDING. Completed Drafts often arrive as `financial_status: pending` with gateway `manual` or empty. The Orders page displayed the stored enum. India Post booked PENDING as PREPAID.

## C. Confirmed vs Unverified

**Confirmed:** mapper fall-through; centralized upsert; UI reads DB; COD regex; `manual` ≠ COD; REST import path.

**Unverified:** actual Admin “Mark as paid” payloads for affected shops (metadata was empty historically). Transaction-based PAID is implemented for when Shopify still says pending but a successful sale/capture exists after refresh.

## D. Files Modified

- `modules/shopify/payment.ts` (new)
- `modules/shopify/orders.ts`
- `modules/shopify/PAYMENT.md` (new)
- `modules/shopify/reconcile.ts` (new, dry-run helpers)
- `scripts/shopify-payment-reconcile.ts` (dry-run entry; no live writes)
- `lib/dashboard/records.ts`
- `modules/shipments/service.ts`
- `modules/india-post/bulk-booking.ts`
- `modules/india-post/booking-run.ts`
- `modules/orders/service.ts`, `modules/orders/schema.ts`
- `lib/api/v1/commerce.ts`
- `app/dashboard/orders/[id]/page.tsx`
- Tests listed in section I

## E. Payment Normalization Changes

- `displayFinancialStatus` → `financial_status`
- `paymentGatewayNames` → `payment_gateway_names`
- GID order ids, `sourceName`, `updatedAt`, `totalOutstandingSet`
- Successful sale/capture transactions can confirm PAID
- Outstanding 0 alone is **not** PAID
- Stale `updated_at` does not overwrite newer stored payment fields
- Merchant override applies only while Shopify is still pending

## F. Shopify Sync and Webhook Changes

- Subscribed topic: `orders/paid` (in addition to create/updated/cancelled)
- Incomplete payment webhooks re-fetch `GET /orders/{id}.json` and transactions
- Auto-booking is not enqueued for PENDING
- No new Shopify scopes

## G. India Post COD Safety Changes

- `shopifyPendingBookingBlocked` on fulfill, bulk status, bulk booking, and CEPT `runIndiaPostBooking`
- Processing without booking remains allowed
- PAID → empty `codr_cod`; COD still requires `value_for_codr_cod` > 0
- Unbooked DRAFT/FAILED shipment collect updates on **payment_status change** only
- Booked AWBs are not rewritten

## H. Database Changes

None. No migrations. Evidence lives in existing `orders.metadata`.

## I. Automated Test Results

Targeted suites (vitest): shopify payment/orders/reconcile, records, Shopify confirm, India Post booking-idempotency, article-validator, endpoints, orders/payment — **passed** after fixes for `.in()` mocks and CEPT empty-prepared return.

## J. Existing Workflow Regression Results

- Checkout paid → PAID
- Checkout COD gateway → COD
- Manual pending → PENDING (not COD)
- WhatsApp READY/IMPORTED booking rules unchanged
- Manual PENDING still fulfillable (not Shopify)

## K. Historical 1,084 Order Analysis

Not executed against production. Dry-run helper: `categorizePendingShopifyOrder` in `modules/shopify/reconcile.ts`. Categories: CONFIRMED_PAID_MISMATCH, CONFIRMED_COD_MISMATCH, GENUINE_PENDING, INSUFFICIENT_EVIDENCE, OTHER_PAYMENT_STATE.

Authorized later: read PostBus PENDING Shopify rows, GET Shopify orders, print counts. No UPDATE.

## L. Historical 124 Shipment Risk Analysis

Not executed against production. Helper: `categorizePrepaidShipmentRisk`. Booked prepaid PENDING without Shopify COD evidence is **CONFIRMED_VALID_PREPAID** (not assumed mis-booked COD). Unbooked DRAFT prepaid PENDING is **UNBOOKED_REQUIRES_REVIEW**.

## M. Remaining Financial Risks

- Live Draft “mark as paid” still unverified until dry-run GET against Shopify
- Already-booked prepaid AWBs on PENDING orders are not auto-corrected
- Merchant confirm is an explicit local override; Shopify `paid` later wins

## N. Production Deployment Prerequisites

1. Merge and deploy this code (separate authorized change)
2. Existing shops re-register webhooks on next sync (`orders/paid`)
3. Optional authorized dry-run reconcile
4. Do not bulk-update historical PENDING rows automatically

## O. Rollback Strategy

Revert the git commit. No schema rollback. Metadata keys are additive.

## P. Final GO / NO-GO

**NO-GO for production deploy / DB writes / Coolify.**  
**GO to merge** the implementation for staging/review.

Unverified live Draft payloads are **not** declared fully fixed in the wild.
