# Merchant API v1 — rollback

## Application

Redeploy the previous application release. `/api/merchant/v1` webhook routes disappear with that rollback. Existing session `/api/v1` order flows are unchanged by Merchant API handlers.

Set `MERCHANT_WEBHOOKS_ENABLED=false` (and optionally `MERCHANT_API_ENABLED=false`) to stop fan-out without a database rollback.

## Database

Migrations are additive. Leave new columns and `webhook_events` in place for older app versions.

Do **not** drop tables in rollback.

Do **not** drop `api_keys.scopes` / `lookup_id` if any production keys were issued.

If keys were issued and must be invalidated: set `status='REVOKED'` and `revoked_at=now()` on rows with `hash_version='hmac-v1'`.

## Jobs

Webhook delivery uses existing `webhook-processing`. Rolling back the app does not cancel in-flight India Post jobs.
