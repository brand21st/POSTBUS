# Shopify Booked Order Protection

**Date:** 2026-11-01

## Problem

After India Post booking, Shopify can still send `orders/updated`. Line items were already locked (`SHOPIFY_WEIGHT_LOCKED_*`), but `orders.total_amount` / `amount_paid` / `cod_amount` could still be rewritten → header vs packing-slip mismatch.

## Policy implemented

**Immutable booking snapshot (never auto-changed):** AWB/barcode, booked parcel weight/dims, booked shipment COD/`payment_mode`, shipment declaration, existing invoices.

**May still change on locked orders:** `payment_status` (e.g. PAID after capture), `fulfillment_status`, order `status` from Shopify cancel/fulfillment mapping.

**Frozen operational money when booking snapshot locked:** `total_amount`, `subtotal`, `discount`, `shipping_amount`, `tax_amount`, `amount_paid`, `cod_amount`.

**Audit:** `metadata.shopifyTotals` (current Shopify money) and `metadata.shopifyLockedReconciliation` (`reason: booking_snapshot_locked`).

**Collect conflict:** still recorded for booked COD vs Shopify PAID; shipment row is not updated (`refreshUnbookedShopifyShipmentCollect` skips booked rows).

## Lock sets (unchanged)

Orders: BOOKED, SHIPPED, IN_TRANSIT, DELIVERED, CANCELLED.

Shipments: VALIDATING, QUEUED, BOOKING, BOOKED, LABEL_PENDING, LABEL_READY, MANIFEST_PENDING, MANIFEST_READY, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, NDR.

## Tests

- Unit: booked AWB conflict — `payment_status` PAID, `total_amount`/`amount_paid`/`cod_amount` **undefined**, `shopifyLockedReconciliation` present, no shipment update — **PASS**
- Unit: queued/booked skip line delete — **PASS**
- PGlite C10 `skipped_locked` — **PASS**
- Live booked India Post — **NOT EXECUTED**
