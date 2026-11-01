# 05 Database migration verification

**Scope:** [`supabase/migrations/20261020120000_shopify_public_app_foundation.sql`](../../supabase/migrations/20261020120000_shopify_public_app_foundation.sql)

**Classification:** PASS on PGlite. NOT TESTED on hosted/production (forbidden).

## Structure verified in isolated PGlite

- `organizations.origin` `WEB | SHOPIFY_PUBLIC_APP`
- `shopify_app_installations` unique `(app_client_id, shop_domain)` and unique `shop_domain`
- Status check, encrypted token columns, `claimed_at` unused
- `provision_shopify_app_organization` service-role intent (grants skipped in PGlite because roles `anon`/`authenticated` do not exist)
- Compliance + webhook delivery tables

## Repeatability

`create table if not exists` / `add column if not exists` are additive. Full reverse DROP is **not** shipped (rollback = leave tables unused, flag off).

## Compatibility

Does not alter `shopify_connections`. FK `organization_id` restrict delete.

## Hosted

Production ref `hgacoeoovjxkzfbesmvl`: **not applied**. Hosted staging: **not authorized**.
