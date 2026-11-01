# POSTBUS Safe Deployment Runbook

**Do not execute this runbook without explicit production authorization.**

Application version that writes address-normalization columns **must not** start until migration `20261030143000_shopify_address_normalization.sql` has succeeded.

## Expand and contract

1. **Expand schema** (this migration): add nullable columns. Existing app versions that do not write them keep working.
2. **Verify staging** with the new app.
3. **Contract** later only if columns are unused after rollback (do not DROP while this app is live).

## Sequence

1. Confirm PITR / backup on the target project.
2. Apply the migration **only** to an approved isolated staging database.
3. SQL checks after apply:
   - New columns exist on `public.addresses`.
   - Existing `booked_at` shipments unchanged.
   - `address_manual_override` is NULL on legacy rows without an original snapshot.
   - Rows with `audit_logs.action = 'order.shipping_address_updated'` are `true`.
4. Deploy the application and workers that contain these P0 fixes **after** the columns exist.
5. Smoke (staging, no live CEPT booking):
   - Import one clean Shopify order (expect `address_manual_override = false`, status READY or review as appropriate).
   - Simulate GraphQL-null merge (or replay a fixture): stored street remains.
   - Merchant edit + sync: street preserved.
   - Revalidate after edit: override remains true.
   - Restore original: stored fields match snapshot; status matches those fields.
   - Accept of too-long address: rejected.
   - Ship/book attempt on NULL or INVALID: no new barcode allocation.
6. Production migration approval (separate authorization).
7. Production migration.
8. Repeat column and booked-shipment checks.
9. Application + worker deploy (same build).
10. Limited merchant rollout.
11. Watch `shopify.address_refresh_failed`, booking `VALIDATION_ERROR`, barcode cursor.

## Rollback

- **App only:** previous build ignores extra columns. Booking gate in old build does not fail-close NULL status.
- **Migration:** keep columns. Do not DROP until no running app selects/writes them.
- **Data:** Shopify overwrites after this fix should be recoverable from `original_shipping` when that JSON exists. Pre-migration overwrites are backup/audit only.

## Feature notes

- OpenRouter address AI remains optional and is not used on webhooks.
- Historical orders stay unbookable until Revalidate (or a Shopify-managed refresh) writes `address_validation_status`. Tell merchants before cutover.
