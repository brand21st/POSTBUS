# PostBus Merchant API v1 reference

Base URL: `https://www.postbus.in/api/merchant/v1`

Authentication: `Authorization: Bearer pb_live_<lookup>_<secret>`

The key belongs to one organization. Do not send `organization_id`. Tenant identity comes from the key.

Dashboard `/api/v1` is session-only and is not this API.

## Scopes

| Scope | Allows |
|---|---|
| `orders:read` | List/get orders |
| `orders:write` | Create, bulk import, patch orders. Does **not** book |
| `shipments:read` | List/get shipments |
| `shipments:book` | `POST /orders/{id}/book` |
| `tracking:read` | Tracking events |
| `labels:read` | Label PDF download |
| `webhooks:read` | List subscriptions and deliveries |
| `webhooks:manage` | Create, update, disable, rotate, test, retry |

## Success envelope

```json
{
  "success": true,
  "data": {},
  "meta": { "request_id": "uuid", "api_version": "v1" }
}
```

Label download returns `application/pdf` instead of JSON.

## Error envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "shipping_address.pincode", "message": "Invalid" }]
  },
  "meta": { "request_id": "uuid", "api_version": "v1" }
}
```

Codes: `INVALID_API_KEY`, `API_KEY_REVOKED`, `API_KEY_EXPIRED`, `INSUFFICIENT_SCOPE`, `MERCHANT_API_DISABLED`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`, `DUPLICATE_ORDER`, `IDEMPOTENCY_CONFLICT`, `BOOKING_NOT_ALLOWED`, `RATE_LIMIT_EXCEEDED`, `UPSTREAM_SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`.

`MERCHANT_API_DISABLED` (403) means the workspace is not on `MERCHANT_API_ORG_ALLOWLIST`, or `MERCHANT_API_ENABLED=false`.

## Idempotency

`Idempotency-Key` is required on `POST /orders`, `POST /orders/bulk`, and `POST /orders/{id}/book`. Retention is 72 hours. The same key with a different body returns `IDEMPOTENCY_CONFLICT`.

`external_order_id` is unique per organization for source `API`. A repeat returns the original order and does not create a second booking.

## Endpoints

### GET /me

Requires a valid key (any scope). Returns key prefix, organization name, scopes, API version, capabilities. Never returns the secret.

### GET /meta/schema

Curated field contract, limits, and allowed values. Not the PostgreSQL schema.

### POST /orders

Scope `orders:write`. Creates a PostBus order with `source=API`. Status after create is typically `READY`. Does not create an India Post booking.

Required: `customer.name`, `customer.phone` (Indian 10-digit mobile), `shipping_address.line1`, `city`, `state`, `pincode` (6 digits), `line_items` (each needs `quantity` and `title` or `product_id`).

Optional: `external_order_id`, email, billing address, `payment_status`, `amount_paid`, `extra_cod_charge`, `metadata`, `india_post_service`.

Writable later (before booking): shipping address, parcel/line weights.

Read-only: `id`, `order_number`, `source`, `status`, AWB, tracking URL.

### POST /orders/bulk

Scope `orders:write`. Max **25** rows per request (documented safety cap). Returns per-row `success` / `error`. Failed rows are included.

### GET /orders

Scope `orders:read`. Query: `updated_since`, `status`, `limit` (max 100), `cursor`. Stable order `(updated_at, id)`.

### GET /orders/{orderId}

Scope `orders:read`. 404 if the order is not in the key’s organization.

### PATCH /orders/{orderId}

Scope `orders:write`. Address and weights only. After India Post booking those fields are locked (`409`).

### POST /orders/{orderId}/book

Scope `shipments:book`. Reuses PostBus booking (contracts, barcodes, COD, locks). HTTP 202 with `state: "queued"` means a background job was accepted. `BOOKED` only after India Post confirmation. Duplicate book returns the existing shipment.

Optional body: `weight_grams`, `length_cm`, `width_cm`, `height_cm`, `service_code`.

### GET /shipments and GET /shipments/{shipmentId}

Scope `shipments:read`.

### GET /shipments/{shipmentId}/tracking

Scope `tracking:read`. Uses cached PostBus events. May enqueue a refresh if data is older than 15 minutes. Does not call India Post on every request.

### GET /shipments/{shipmentId}/label

Scope `labels:read`. Authenticated PDF. 404 if no label file exists yet.

## Workflows

1. Create order → store `id` and `order_number`.
2. Optionally PATCH address/weight while unbooked.
3. POST book → poll GET order/shipment until barcode/`BOOKED`.
4. GET tracking; GET label when available.
5. Incremental sync with `updated_since` + `cursor`.

## Limits

- 120 requests/minute per API key
- 300 requests/minute per organization
- 30 booking posts/minute per key
- 100 bulk rows counted per minute toward bulk quota
- 20 invalid-key attempts/minute per IP
- Payload 256 KB (512 KB bulk)

HTTP 429 includes `Retry-After`.

## Status enums (actual PostBus)

Orders: `IMPORTED`, `READY`, `PROCESSING`, `BOOKED`, `SHIPPED`, `IN_TRANSIT`, `DELIVERED`, `FAILED`, `CANCELLED`.

Shipment booking requested: typically `QUEUED` or `BOOKING`. Physical booking: `BOOKED` after India Post confirmation.

## Webhooks

Outbound webhooks are delivered only when `MERCHANT_WEBHOOKS_ORG_ALLOWLIST` includes the organization. Delivery is at-least-once. Deduplicate on `id`.

Envelope `api_version` is `2026-10-18`. REST responses still use `api_version: v1`.

Events: `order.created`, `order.updated`, `shipment.booking_requested` (alias `shipment.created`), `shipment.booked`, `shipment.booking_failed` (alias `shipment.failed`), `tracking.updated`, `shipment.out_for_delivery`, `shipment.delivered`, `shipment.exception` (`data.status` is `NDR` or `RTO`), `webhook.test`.

`shipment.exception` is not a database status. `RTO_DELIVERED` does not emit `shipment.delivered`.

Signature:

```
canonical = timestamp + "." + event_id + "." + raw_body
X-PostBus-Signature: v1=<hex hmac-sha256(secret, canonical)>
```

Headers: `X-PostBus-Event-Id`, `X-PostBus-Event-Type`, `X-PostBus-Timestamp`, `X-PostBus-Signature`. Reject timestamps older than 5 minutes. Compare signatures in constant time. Redirects are not followed. HTTPS public destinations only.

Management:

- `GET/POST /webhook-subscriptions`
- `GET/PATCH/DELETE /webhook-subscriptions/{id}` (DELETE disables, keeps history)
- `GET /webhook-subscriptions/{id}/deliveries`
- `POST /webhook-subscriptions/{id}/test`
- `POST /webhook-subscriptions/{id}/rotate-secret`
- `POST /webhook-subscriptions/{id}/deliveries/{deliveryId}/retry`
