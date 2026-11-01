# Database Compatibility Validation

**Date:** 2026-11-01  
**Production writes:** none. **Production migrations:** none.

## Targets

| Environment | Identity | Writes this session |
|---|---|---|
| Production | `hgacoeoovjxkzfbesmvl` | **None** (blocked) |
| Isolated staging Postgres | `127.0.0.1:55432` / `postbus_staging` | Schema + fixture RPC insert |
| Local Docker API `127.0.0.1:54321` | not running | None |

Isolation: `scripts/staging/assert-not-production.mjs` rejected production hosts. `npm run staging:up` printed `Production project hgacoeoovjxkzfbesmvl was not used.`

## Existing migration (not duplicated)

`supabase/migrations/20261029120001_shopify_fulfillment_eligibility.sql`

Adds nullable `unfulfilled_quantity integer`, `source_line_item_id text`, `requires_shipping boolean`, check `unfulfilled_quantity >= 0`, and `shopify_shipment_allocations`. No unique index on line-item identity. Compatible with old app (omits keys) after apply.

**Production:** still **not applied** (prior read-only audit; not re-applied here).

**Staging slim cluster:** not applied as a whole (depends on `set_updated_at` and full FK graph). Column adds were covered by the new additive migration instead.

## New migration (local file only; applied on staging)

`supabase/migrations/20261101090000_replace_shopify_order_line_items.sql`

- `ADD COLUMN IF NOT EXISTS` for the three fulfillment columns plus `variant`, `weight_edited`, `image_url`
- Function `replace_shopify_order_line_items(uuid, uuid, timestamptz, jsonb)`
- `SECURITY INVOKER`, `search_path = public`
- Per-order `FOR UPDATE` + `pg_advisory_xact_lock(87251411, hashtext(org:order))`
- Grants: execute to `authenticated` / `service_role`; revoked from `public` / `anon` when those roles exist

## Staging `information_schema` (after apply)

```
source_line_item_id: true
unfulfilled_quantity: true
requires_shipping: true
rpc replace_shopify_order_line_items: true
```

## Staging write path

Not PostgREST (no Kong/`54321`). Direct `psql` as `postbus_staging@127.0.0.1:55432`.

| Step | Result |
|---|---|
| Insert staging order `STG-PARTIAL-1` | **PASS** |
| RPC replace two active same-SKU lines | **PASS** `{"ok": true, "count": 2, "action": "replaced"}` |
| Older snapshot | **PASS** `{"ok": true, "action": "skipped_stale"}` |
| Remaining rows | LineItem/2 @ ₹1049 and LineItem/3 @ ₹1049; deposit GID not stored |
| PGRST204 | **NOT EXECUTED** (no PostgREST) |

## Application insert path

`shopifyLineItemRows` still sends the three extra keys. **Production remains incompatible until `20261029120001` and/or `20261101090000` are applied there after approval.** After those additive columns exist, current app inserts and the RPC are compatible. Old workers that omit the keys remain compatible (nulls).

## Rollout recommendation (not executed)

1. Backup production.
2. Apply `20261029120001` then `20261101090000` (or `20261101090000` alone for columns+RPC; still apply allocations migration before FO features).
3. Reload PostgREST schema cache.
4. Deploy application (web + workers).
5. Do not unique-index `source_line_item_id`.
