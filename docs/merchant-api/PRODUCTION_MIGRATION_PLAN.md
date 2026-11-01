# Merchant Developer Platform — production migration plan

Status: **APPLIED**. Do **not** re-run these migrations. Filename timestamps and `schema_migrations.version` differ; identity is the **name**.

Production database: Supabase project `hgacoeoovjxkzfbesmvl` (`https://hgacoeoovjxkzfbesmvl.supabase.co`).

## Exact order (repository files)

| Order | Repository file | Applied `schema_migrations` row |
|---|---|---|
| 1 | `supabase/migrations/20261018180000_merchant_public_api.sql` | `version=20261018133307` `name=merchant_public_api` |
| 2 | `supabase/migrations/20261018190000_merchant_api_consume_rate_service_role_only.sql` | `version=20261018133359` `name=merchant_api_consume_rate_service_role_only` |
| 3 | `supabase/migrations/20261018200000_merchant_webhook_platform.sql` | `version=20261018191255` `name=merchant_webhook_platform` |

The third file is **not** guessed: it is the only remaining Merchant Public API additive migration after the two REST migrations.

## Expected schema (already present)

1. `api_keys`: `scopes`, `lookup_id` (unique when not null), `hash_version`, `expires_at`, `revoked_at`.
2. `idempotency_keys`: `operation`, `processing_state` (`processing|completed|failed`), `expires_at`.
3. `orders_org_updated_id_idx` on `(organization_id, updated_at, id)`.
4. `merchant_api_request_logs` (RLS on; OWNER/ADMIN select).
5. `merchant_api_rate_buckets` (RLS on; **no** authenticated policies; service-role only).
6. `merchant_api_consume_rate(text, timestamptz, integer)` SECURITY DEFINER; EXECUTE **service_role only** (`anon`/`authenticated` false).
7. `webhook_events` outbox (`PENDING|DISPATCHED|SKIPPED`, unique `dedupe_key`, RLS on, OWNER/ADMIN select).
8. `webhook_endpoints`: additive `description`, `disabled_at`.
9. `webhook_deliveries`: additive `event_id`, `next_attempt_at`, `response_excerpt`; due index for `PENDING|RETRYING`.

## Preconditions (satisfied)

- Additive SQL only (`create table if not exists`, `add column if not exists`, `create index if not exists`).
- No drops of orders, shipments, Shopify, billing, or Razorpay tables.
- Existing `webhook_endpoints` / `webhook_deliveries` / `webhook-processing` jobs remain.
- Rollback is **forward-compatible**: older app versions ignore new columns; do not `DROP`.

## Backup and recovery checkpoint

- Postgres `archive_mode=on`, `wal_level=logical` (prior production smoke).
- If a future migration fails: stop applying further SQL; do not drop tables; restore from PITR only with explicit operator approval.

## Execution procedure

**Do not execute.** All three names exist in `supabase_migrations.schema_migrations`.

If a tool offers to apply `20261018180000_*` again, refuse. Duplicate execution is prevented by the recorded **name**.

## Post-migration verification (read-only, 2026-10-19)

- Three named rows present.
- `webhook_events` exists, RLS enabled, **0** rows, **0** pending.
- Rate RPC grants: service_role true, anon/authenticated false.

## Failure handling

If a named row is missing: apply **only** that file via an authorized migration path after a backup checkpoint. Never apply from a developer workstation “db push” of the dirty tree.

## Rollback / forward recovery

See [ROLLBACK.md](ROLLBACK.md). Leave schema in place. Disable traffic with `MERCHANT_API_ENABLED=false` and/or empty allowlists. Do not reverse shared additive columns if HMAC keys already exist.
