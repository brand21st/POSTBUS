# PostBus historical order safety

Date: 2026-10-31

## Risk

After `20261030143000_shopify_address_normalization.sql`, existing production addresses have **no** `address_validation_status` (column does not exist today). The booking gate blocks NULL.

Read-only production snapshot this session:

| Metric | Count |
| --- | ---: |
| orders | 15,287 |
| addresses | 33,706 |
| shipments | 2,932 |
| posted / in-transit (`MANIFEST_READY`, `LABEL_READY`, `IN_TRANSIT`, `DELIVERED`, `LABEL_PENDING`) | 1,626 |
| draft/queued/failed/cancelled-like | 1,306 |
| **orders without a posted shipment** | **13,661** |

Those 13,661 orders are the operational set that could hit a NULL booking dead-end if the app is deployed with a fail-closed gate and no transition.

Do **not** bulk-update production to READY.

## Strategy implemented (code, not production apply)

On booking of an unbooked shipment, `ensureLegacyAddressValidation`:

1. If status is already READY / NEEDS_REVIEW / INVALID → leave it.
2. If NULL/empty → `classifyStoredShippingAddress` on **stored** fields only.
3. Persist **only** validation columns (`legacy-on-demand`). No street/city/PIN/phone rewrite. No override rewrite.
4. Then `shippingAddressBookingBlock` still runs (READY + live fields must still pass).
5. INVALID / NEEDS_REVIEW → no barcode, no CEPT.
6. Valid stored fields → READY, then booking may proceed to the stub/CEPT path.

Merchant UI `revalidateOrderShippingAddress` remains the explicit review path. Historical dry-run `classifyHistoricalOrganizationAddresses` is org-scoped, skips booked rows, never books.

## Tests

`modules/orders/historical-classify.test.ts` and booking-idempotency:

- NULL + valid PIN → READY, CEPT called
- NULL + PIN `12` → INVALID, CEPT not called
- Already READY → no extra write

## Production action

Do **not** run a bulk classify job on production at deploy. On-demand is the transition. Optional later: org-scoped dry-run of `classifyHistoricalOrganizationAddresses` after approval.
