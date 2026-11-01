# POSTBUS Production Release Runbook

**Do not execute steps 12–19 without a separate, explicit production approval.**

Application that writes address-normalization columns must not start until  
`supabase/migrations/20261030143000_shopify_address_normalization.sql` has succeeded on that environment.

## Preconditions (currently incomplete)

- [ ] Isolated staging Postgres is **running** and is not `hgacoeoovjxkzfbesmvl`
- [ ] Staging contains only approved test data
- [ ] Staging India Post hosts are loopback / mock (not `indiapost.gov.in` / `cept.gov.in`)
- [ ] Staging Shopify credentials are empty or a dedicated dev store
- [ ] PITR / backup confirmed on the **target** project
- [ ] Release branch contains **only** this changeset (split the dirty tree)

## Expand / contract

1. Expand schema (this migration): additive nullable columns.
2. Verify new app on staging.
3. Do not DROP columns while any running app selects them.

## Sequence after staging is actually up

1. Snapshot counts (orgs, orders, booked shipments, barcodes, override distribution). No PII in reports.
2. Apply migration to **staging only**.
3. Re-check counts; booked `line1` / barcodes unchanged; legacy override NULL; audit-edited override true.
4. Deploy matching web + workers to staging.
5. Smoke (no live CEPT booking):
   - One clean Shopify **dev-store** import (`override = false`).
   - GraphQL-null merge: street remains.
   - Merchant edit + sync: street remains.
   - Revalidate: override stays true/NULL as designed.
   - Restore original.
   - Book attempt on NULL/INVALID: **no** new barcode.
6. Separate production approval.
7. Production backup.
8. Production migration.
9. Repeat column and booked-shipment checks.
10. Deploy the same build of app + workers.
11. Limited merchant flag / watch `shopify.address_refresh_failed` and booking `VALIDATION_ERROR`.

## Rollback

- **App only:** previous build ignores extra columns; old booking does not fail-close NULL.
- **Migration:** keep columns.
- **Data:** `original_shipping` recovers post-migration Shopify overwrites when that JSON exists. Pre-migration overwrites need backup/audit.

## This session

Steps 12–19 **not executed.** No production SQL, deploy, booking, or barcode allocation.
