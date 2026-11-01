# PostBus migration history (final)

Date: 2026-10-31  
Production project `hgacoeoovjxkzfbesmvl` (read-only, prior check). Latest applied: `20261030052920`.

## Ship

`supabase/migrations/20261030143000_shopify_address_normalization.sql` only.

Additive columns and CHECK on `addresses`. Existing booked rows are not reclassified. `address_manual_override` NULL stays protected from Shopify overwrite.

Applied on local Docker `postbuslocal` during the recovered start. **Not** applied on production. Production `information_schema` lacked those columns on the last read-only check.

## Do not ship as new versions

| Local file | Why |
| --- | --- |
| `20261007140001_whatsapp_order_payment.sql` | Production already has `whatsapp_order_payment` as `20261007091614` |
| `20261029120001_shopify_fulfillment_eligibility.sql` | Must not replay under a new timestamp |

Do not `supabase db push` or `db reset` against production.

## Future execution (do not run)

1. Approved isolated git SHA that contains only `20261030143000` plus matching app/worker code.  
2. Confirmed PITR/backup recovery point.  
3. Apply that one file.  
4. Verify columns and CHECK.  
5. Deploy app. Do not bulk-READY or bulk-book historical orders.
