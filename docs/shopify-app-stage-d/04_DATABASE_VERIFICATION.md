# 04 Database verification

**Classification:** FAIL — current `.env.local` targets production. **No migration run.**

## Forbidden production ref

`hgacoeoovjxkzfbesmvl` ([`PRODUCTION_SUPABASE_REF`](../../lib/env/staging-isolation.ts)).

## Observed

`NEXT_PUBLIC_SUPABASE_URL` in `.env.local` resolves to host `hgacoeoovjxkzfbesmvl.supabase.co`, `supabaseIsProductionRef: true`, `supabaseIsLoopback: false`.

Local CLI config ([`supabase/config.toml`](../../supabase/config.toml)): `project_id = "POST_BUS_APP"`, API port **54321**. That local stack is **not** what the running Next env is using.

## Migration file (not applied)

[`supabase/migrations/20261020120000_shopify_public_app_foundation.sql`](../../supabase/migrations/20261020120000_shopify_public_app_foundation.sql)

PGlite unit tests already cover the SQL. Hosted/production apply: **forbidden**.

## Gate for a later local migrate

1. Point `.env.local` `NEXT_PUBLIC_SUPABASE_URL` at `http://127.0.0.1:54321` (or localhost).
2. Re-run `npx tsx scripts/stage-d-env-preflight.mts` until `supabaseIsProductionRef` is false and `supabaseIsLoopback` is true.
3. `npx supabase status` showing local, not cloud.
4. Explicit approval of the migrate command.

Until then: **no** `supabase db push`, **no** SQL against the URL in `.env.local`.
