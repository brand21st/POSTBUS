# Production Deployment Runbook — Shopify safety hardening

**DO NOT EXECUTE without explicit approval.**

Production project: `hgacoeoovjxkzfbesmvl`.

## Prerequisites

1. Confirm PITR / backup on production.
2. Confirm staging RPC results still hold.
3. Confirm this commit/deploy includes `currentQuantity` filter + RPC caller.
4. Do **not** run historical repair in the same change.

## Order of operations

1. **Database first** (additive):
   - Apply `20261029120001_shopify_fulfillment_eligibility.sql` if allocations/FO are required.
   - Apply `20261101090000_replace_shopify_order_line_items.sql` (columns IF NOT EXISTS + RPC).
2. **Reload PostgREST schema cache** (Supabase dashboard notify or `NOTIFY pgrst, 'reload schema'`).
3. Smoke SQL (read-only): `information_schema` for the three columns; `pg_proc` for the RPC.
4. **Deploy application** (web + background workers together preferred).
5. Old workers without RPC: line refresh will **fail closed** (`rpc` error) rather than non-atomic delete/insert. Keep worker/app versions aligned.
6. Monitor: `shopify.line_items.current_quantity_missing`, Postgres `PGRST204`, Shopify import errors, duplicate title+SKU on **new** PARTIAL orders.

## Webhooks during rollout

Shopify may retry failed updates. After RPC exists, retries are idempotent per order lock.

## Rollback

1. Redeploy previous application revision.
2. **Do not drop** the new columns or function immediately (old app ignores extra columns; leftover function is unused).
3. Do not delete `order_line_items`.
4. Rollback trigger: line-item insert/RPC error spike, missing products on new imports, PGRST204.

## After deploy

Unbooked historical PARTIAL duplicates may self-correct on next sync. Booked ones stay locked with reconciliation metadata. No invoice regen.
