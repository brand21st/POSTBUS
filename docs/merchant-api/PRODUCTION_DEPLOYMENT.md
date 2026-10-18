# Merchant API v1 — production deployment checklist

Requires explicit approval. This workstream does **not** deploy.

1. Staging verification signed off.
2. Backup / migration window.
3. Apply `20261018180000_merchant_public_api.sql` with the standard production migration process.
4. Deploy application code that includes `/api/merchant/v1` **after** the migration is on the target database (or in the same release if the migrator runs first).
5. HMAC depends on `INTEGRATION_ENCRYPTION_KEY`. Rotating that key invalidates Merchant API secrets.
6. Monitor `merchant_api_request_logs` 4xx/5xx and booking job failures.
7. Create no `pb_test_` keys.
8. Keep `/api/v1` session-only.

## Rollback

See [ROLLBACK.md](ROLLBACK.md).
