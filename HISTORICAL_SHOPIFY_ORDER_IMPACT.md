# Historical Shopify Order Impact

**Date:** 2026-11-01  
**No production repair. Counts from 2026-10-31 read-only audit (not re-queried this session).**

Prior snapshot: 249 PARTIAL title/SKU duplicate Shopify orders; 234 unbooked; 15 booked-class; 0 sales invoices on that set.

## After this code is deployed (once schema is compatible)

### Unbooked (≈234)

Normal webhook or `shopify-sync` will call `replace_shopify_order_line_items` with **active** currentQuantity lines.

**Expected automatic changes:**

- Deposit `currentQuantity = 0` rows dropped
- Replacement GIDs remain
- `total_amount` / `amount_paid` / `cod_amount` move to current Shopify totals (PARTIAL: current − outstanding)

**Documents:** none invoiced on the last count. Packing UI will follow new lines.

This is **not** a backfill job; it happens only if Shopify sync runs for that order.

### Booked (≈15)

- Lines **not** replaced (`skipped_locked`)
- Operational money **not** overwritten
- `payment_status` may still update
- `shopifyLockedReconciliation` records Shopify current vs locked total

Display: locked products/totals vs Shopify current in metadata until a separate approved recovery.

## Protected fields

AWB, barcode, booked COD, booked weight/dims, invoices.

## Recovery (separate approval)

Dry-run GID/`currentQuantity` compare; tenant approval; backup; apply only unbooked; never rebook; never rewrite invoices.

## Recommendation

Communicate to affected tenants that unbooked PARTIAL duplicates will self-correct on next successful sync after production migrate+deploy.
