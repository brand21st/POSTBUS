# PostBus migration reconciliation

Date: 2026-10-31

Production project: `hgacoeoovjxkzfbesmvl`  
Latest production version (read-only earlier): `20261030052920_realtime_org_filter_replica_identity`

## Required production schema change

**Only** `supabase/migrations/20261030143000_shopify_address_normalization.sql`

Additive: `line3`, provenance JSON, `address_validation_status`, `address_manual_override` (nullable), check constraint, indexes. Existing rows stay NULL override unless audit `order.shipping_address_updated` marks TRUE. Does not rewrite booked street or barcodes.

This file is **not** on production. Do not apply without backup + explicit approval.

## Local-only version renames — do NOT push

| Local file now | Why |
| --- | --- |
| `20261007140001_whatsapp_order_payment.sql` | Duplicate local version `20261007140000` with `product_return_available`. Production already has `20261007091614_whatsapp_order_payment` / `20261007000753_product_return_available`. |
| `20261029120001_shopify_fulfillment_eligibility.sql` | Duplicate local `20261029120000` with label sort. Production has `20261029060400_label_shipment_groups_order_sort`. |

Pushing these renamed files would try to **replay** features production already has, under new version keys. That is a conflict, not a fix.

`supabase db push` and `supabase db reset` remain forbidden against production.

## Local Docker

`supabase start` applied the full local migration directory including `20261030143000` to an **empty** Docker database. That is not a production clone.

## Old vs new app

- Old app ignores unknown columns (additive).
- New app requires the columns for the booking gate and address review.
- Deploy order: schema first, then app.

## `supabase/config.toml`

`project_id` changed to `postbuslocal` and DB port `54332` for **local Docker only**. Do not treat as a production config change.
