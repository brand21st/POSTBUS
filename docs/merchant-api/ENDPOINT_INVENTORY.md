# Merchant API v1 endpoint inventory

Audit date: 2026-10-18. Source of truth is the repository, not the product brief.

Dispatch: `app/api/merchant/v1/[...slug]/route.ts` calls `handleMerchantV1`. Session `/api/v1` is a different API.

Production migration and production traffic for this API were not executed by this workstream. Treat every row as **NOT VERIFIED** in production until an approved deploy.

## Implemented routes

| Method | Path | Scope | Automated coverage | Classification |
|---|---|---|---|---|
| GET | `/me` | any valid key | `handle.test.ts` envelope, no secret, allowlist denial | IMPLEMENTED, TESTED |
| GET | `/meta/schema` | any valid key | no route test | IMPLEMENTED, UNVERIFIED |
| POST | `/orders` | `orders:write` | scope denial, idempotent replay, body mismatch | IMPLEMENTED, TESTED (not live DB) |
| POST | `/orders/bulk` | `orders:write` | per-row success and failure | IMPLEMENTED, TESTED |
| GET | `/orders` | `orders:read` | no route test | IMPLEMENTED, UNVERIFIED |
| GET | `/orders/{id}` | `orders:read` | cross-organization 404 | IMPLEMENTED, TESTED |
| PATCH | `/orders/{id}` | `orders:write` | no route test | IMPLEMENTED, UNVERIFIED |
| POST | `/orders/{id}/book` | `shipments:book` | scope denial; enqueues booking, does not call India Post inline | IMPLEMENTED, TESTED |
| GET | `/shipments` | `shipments:read` | no route test | IMPLEMENTED, UNVERIFIED |
| GET | `/shipments/{id}` | `shipments:read` | no route test | IMPLEMENTED, UNVERIFIED |
| GET | `/shipments/{id}/tracking` | `tracking:read` | no route test | IMPLEMENTED, UNVERIFIED |
| GET | `/shipments/{id}/label` | `labels:read` | scope denial only | IMPLEMENTED, TESTED (scope) |

`POST /orders/{id}/book` returns a queued shipment. `BOOKED` exists only after India Post confirmation is stored.

## Not implemented

- `DELETE /orders/{id}` — not routed. Do not document it as available.
- Merchant webhook routes were missing at the start of the platform expansion. See the webhook section of the API reference after this release.

## Documentation mismatches found in the audit

- `POSTBUS_API_REFERENCE.md` omitted error code `MERCHANT_API_DISABLED` (HTTP 403). The handler returns it when the org allowlist or kill switch is closed.
- OpenAPI and the reference described the REST routes above and correctly omitted webhooks at audit time, because no merchant webhook routes existed.
- There was no public `/developers` site. Documentation lived in the signed-in Developer Portal and `docs/merchant-api/`.
- `KNOWN_LIMITATIONS.md` stated outbound merchant webhooks were not in the Merchant API release. That was accurate. Existing `webhook_endpoints` delivery had no SSRF blocking, no retry schedule, and emitted only `tracking.updated` from the India Post webhook path.

## Auth and safety already in place

- Bearer `pb_live_<lookup>_<secret>`, HMAC-SHA256 (`hmac-v1`), constant-time compare.
- Scopes do not imply each other. `orders:write` does not book.
- Empty `MERCHANT_API_ORG_ALLOWLIST` closes every organization. `MERCHANT_API_ENABLED=false` is the kill switch.
- Organization id comes from the key. Clients cannot pass another tenant id.
