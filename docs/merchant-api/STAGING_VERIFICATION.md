# Merchant API v1 — staging verification

Do not apply `supabase/migrations/20261018180000_merchant_public_api.sql` to production from a developer workstation.

## Before traffic

1. Apply the migration on **staging** only.
2. Confirm `merchant_api_consume_rate` is executable by `service_role` only.
3. Confirm `INTEGRATION_ENCRYPTION_KEY` is set (HMAC for keys).
4. Confirm `SUPABASE_SERVICE_ROLE_KEY` is present on the API process and never exposed to browsers.

## Checks

1. OWNER/ADMIN opens Dashboard → Integrations → Developer API.
2. Create a key with `orders:read` only. `POST /api/merchant/v1/orders` returns `INSUFFICIENT_SCOPE`.
3. Create a key with `orders:write` (no `shipments:book`). Order create succeeds; book returns `INSUFFICIENT_SCOPE`.
4. Repeat create with the same `Idempotency-Key` and body → same order id, no duplicate.
5. Change body, same idempotency key → `IDEMPOTENCY_CONFLICT`.
6. Use org B key against org A order UUID → `RESOURCE_NOT_FOUND`.
7. Book with `shipments:book` on staging India Post **UAT** (or worker stub). Response `state` is `queued`, not `BOOKED`, until the worker confirms.
8. Tracking returns cached events; label 404 until a PDF exists.
9. Revoke key → subsequent calls `API_KEY_REVOKED`.
10. Shopify store still imports orders; API-created orders have `source=API` and do not fulfill Shopify.

Do not send live India Post production bookings from staging keys.
