# POSTBUS P0 Fix Implementation Report

**Date:** 30 October 2026  
**Branch:** `fix/auth-session-stability`  
**Constraint:** Local source and unshipped migration only. No production writes, no commit, no deploy.

## Summary

All eight audit P0 defects were verified against current code, then fixed locally. Shared booking eligibility now fail-closes unless `address_validation_status` is `READY` **and** the live fields still pass `assessShopifyShippingFields`.

## P0 status

| ID | Status | Files |
| --- | --- | --- |
| P0-01 Accept bypass | FIXED AND VERIFIED | `modules/orders/service.ts` `acceptOrderShippingAddress` |
| P0-02 Legacy overwrite | FIXED BUT NOT FULLY VERIFIED | `supabase/migrations/20261030143000_shopify_address_normalization.sql`, `shopifyMayRefreshStoredAddress` |
| P0-03 GraphQL wipe | FIXED AND VERIFIED | `modules/shopify/orders.ts` `mergeShopifyRemoteOrder`, `importShopifyWebhookOrder` |
| P0-04 Barcode before gate | FIXED AND VERIFIED | `modules/india-post/booking-run.ts`, `modules/shipments/service.ts` |
| P0-05 Revalidate clears override | FIXED AND VERIFIED | `revalidateOrderShippingAddress` |
| P0-06 Restore status mismatch | FIXED AND VERIFIED | `restoreOrderShippingAddress` |
| P0-07 NULL bookable | FIXED AND VERIFIED | `shippingAddressBookingBlock` |
| P0-08 App before migration | FIXED BUT NOT FULLY VERIFIED | insert contract + `POSTBUS_SAFE_DEPLOYMENT_RUNBOOK.md` |

## Changes by defect

### P0-01

`acceptOrderShippingAddress` classifies the stored fields with `classifyStoredShippingAddress`. READY is persisted only when that result is READY. Invalid or review-required suggestions throw. Concurrent edits are rejected when `address_normalized_at` no longer matches.

### P0-02

The unshipped migration no longer applies `NOT NULL DEFAULT false` to existing rows. `address_manual_override` is tri-state:

- `NULL` — unknown/legacy, Shopify refresh skipped
- `true` — merchant override (also backfilled from `order.shipping_address_updated` audit logs)
- `false` — Shopify-managed new imports

`refreshStoredShopifyShipping` uses `shopifyMayRefreshStoredAddress` and optimistic `.eq("address_manual_override", false)`.

### P0-03

App Store webhooks merge GraphQL onto the webhook body. Empty mailingAddress objects and blank fields do not replace populated webhook shipping, billing, customer, phone, or email.

Refresh also refuses an unusable incoming contact when the stored row still has name/street/city/PIN/phone.

### P0-04

`runIndiaPostBooking` now: Shopify guard → payment pending → address gate → allocate barcode → claim. `createShipmentsForOrders` skips enqueue when the address is not booking-eligible (drafts without enqueue still create). Bulk validate already gated before article build.

### P0-05

If override is true or unknown (`NULL`), revalidate classifies current fields only and keeps override. It does not restore Shopify original or call OpenRouter. Shopify-managed rows (`false`) may still re-normalize from `original_shipping`.

### P0-06

Restore writes the original snapshot fields, then classifies **those** fields. Status matches stored data. Booked shipments remain locked via `editableShippingAddress`.

### P0-07

`shippingAddressBookingBlock` requires stored status `READY` plus a live READY classification. NULL, UNKNOWN, NEEDS_REVIEW, INVALID, missing address, and stale READY are blocked.

### P0-08

Inserts still write the new columns and fail loudly if they are missing. Deployment must apply the migration before this application version. See the runbook.

## Remaining risks

- Staging/production migration not applied (P0-02/P0-08 verification incomplete).
- P1 items from the original audit (AI cost, sync latency, custom label line3, PIN `000000` in article validator) are unchanged.
- After migration, historical Shopify orders cannot book until Revalidate (or a permitted refresh) writes a status. That is intentional fail-closed behavior.
- Full `tsc --noEmit` OOM in this environment; ESLint on touched files passed.
