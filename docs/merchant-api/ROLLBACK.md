# Merchant API v1 — rollback

## Application

Redeploy the previous application release. `/api/merchant/v1` will 404. Dashboard Developer Portal routes should be removed with that rollback. Existing session `/api/v1` is unchanged by Merchant API handlers.

## Database

The migration is additive. Leaving new columns/tables in place is safe for older app versions.

Do **not** drop `api_keys.scopes` / `lookup_id` if any production keys were issued.

If keys were issued and must be invalidated: set `status='REVOKED'` and `revoked_at=now()` on rows with `hash_version='hmac-v1'`.

## Jobs

No new job types. Booking still uses `shipment-booking`. Rolling back the app does not cancel in-flight India Post jobs; those follow existing booking rollback practice.
