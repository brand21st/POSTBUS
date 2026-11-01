# Webhook lifecycle

Endpoint: `POST /api/shopify/webhooks`  
Secret: `SHOPIFY_PUBLIC_APP_CLIENT_SECRET` only. No fallback to `SHOPIFY_API_SECRET`.  
BYO path remains `POST /api/v1/webhooks/shopify`.

Subscriptions are declared in `shopify.app.toml` for documentation. They are **not** registered live on production in this phase.

## Topics

| Topic | Handler |
|-------|---------|
| `app/uninstalled` | Set install `DISCONNECTED`, null encrypted tokens and expiry, set `uninstalled_at`. Do not delete the org. Do not touch `shopify_connections`, bookings, or Razorpay. |
| `customers/data_request` | Persist compliance row `RECEIVED`. |
| `customers/redact` | Persist `PENDING_REVIEW`. Shared SaaS org deletion is **blocked pending legal**. |
| `shop/redact` | Persist `PENDING_REVIEW`. After uninstall, public-app PII/tokens may already be cleared; SaaS org data is not deleted. |

Unknown topics after a valid HMAC are ignored (`{ ignored: true }`).

## Idempotency

Key = `X-Shopify-Webhook-Id` (body hash fallback). If a delivery row is already `SUCCEEDED`, return `{ duplicate: true }` without re-running side effects. The delivery row is upserted **after** the handler succeeds.

## Reinstall

Provision finds the existing install for the shop + public client id. If status is `DISCONNECTED`, it is set back to `PENDING` and token exchange can run again on bootstrap.
