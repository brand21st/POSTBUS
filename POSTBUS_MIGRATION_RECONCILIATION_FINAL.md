# PostBus migration reconciliation (final)

Date: 2026-10-31  
Production identity (read-only): project `hgacoeoovjxkzfbesmvl`. Latest applied version: **`20261030052920_realtime_org_filter_replica_identity`**.

## Intended production change

File: `supabase/migrations/20261030143000_shopify_address_normalization.sql`  
Additive only:

- `addresses.line3`, `original_phone`, `phone_source`, `original_shipping`, `normalized_shipping`
- `address_validation_status` (nullable + CHECK READY/NEEDS_REVIEW/INVALID)
- `address_normalization_source`, `address_normalized_at`, `address_review_required`
- `address_manual_override` nullable (NULL = legacy/unknown, do not Shopify-overwrite)
- indexes on validation status and manual override

Read-only production `information_schema` for those columns: **empty**. Migration is **not applied**.

Local Docker start on 2026-10-31 **did** apply `20261030143000` on `postbuslocal` only.

## Local filename renames — do not push

| Local filename | Do not treat as new production version |
| --- | --- |
| `20261007140001_whatsapp_order_payment.sql` | Production already has `whatsapp_order_payment` as `20261007091614` |
| `20261029120001_shopify_fulfillment_eligibility.sql` | Must not replay as a new timestamp |

Production timestamps and local filenames differ for many historical files (CLI vs repo). **Never** `supabase db push` the dirty directory.

## Production-safe plan (DO NOT EXECUTE)

1. Isolated commit containing **only** `20261030143000_shopify_address_normalization.sql` plus compatible app/worker code.  
2. Confirm PITR/backup recovery point.  
3. Apply that **one** additive file on production after owner approval.  
4. Verify columns and CHECK constraint.  
5. Deploy app/workers that classify NULL on demand — do **not** bulk-READY 13,661 unposted orders.

Do not run `supabase db reset` or `supabase db push`.
