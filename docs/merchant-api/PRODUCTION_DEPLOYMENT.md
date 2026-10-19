# Merchant API v1 — production deployment checklist

Requires explicit approval. This workstream does **not** deploy.

1. Confirm a current database backup.
2. Staging or isolated verification signed off (`STAGING_VERIFICATION.md`).
3. Apply additive migrations in order:
   - `20261018180000_merchant_public_api.sql`
   - `20261018190000_merchant_api_consume_rate_service_role_only.sql`
   - `20261018200000_merchant_webhook_platform.sql`
4. Deploy application code after those migrations (or in the same release if the migrator runs first).
5. HMAC for API keys and webhook secrets depends on `INTEGRATION_ENCRYPTION_KEY`. Rotating that key invalidates stored secrets.
6. `MERCHANT_API_ORG_ALLOWLIST`: empty denies every workspace; comma-separated org UUIDs for canary; `*` or `all` opens REST for every merchant. `MERCHANT_WEBHOOKS_ORG_ALLOWLIST` stays independent (empty still delivers nothing).
7. Do not smoke-test by booking live India Post articles or modifying customer orders.
8. Monitor `merchant_api_request_logs` and `webhook_deliveries`.
9. Create no `pb_test_` keys. Keep `/api/v1` session-only.

## Rollback

See [ROLLBACK.md](ROLLBACK.md).
