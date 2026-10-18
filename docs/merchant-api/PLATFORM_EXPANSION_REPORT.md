# Merchant API platform expansion — implementation report

Status of this workstream: **IMPLEMENTED** in the repository. **TESTED** via automated unit tests in this pass. **DEPLOYED: NOT VERIFIED**. Production migrate/deploy was not executed.

## A. Existing APIs reused

- `/api/merchant/v1` catch-all and REST order/shipment/tracking/label handlers
- HMAC merchant API keys, scopes, idempotency, Postgres rate limits, request logs
- `webhook_endpoints` / `webhook_deliveries` tables
- `webhook-processing` job type and Coolify database drain
- Developer Portal at Dashboard → Integrations → Developer API
- Booking, tracking apply, and Shopify import services (emit after successful writes)

## B. New API endpoints

Under `/api/merchant/v1`, scoped `webhooks:read` / `webhooks:manage`:

- GET/POST `/webhook-subscriptions`
- GET/PATCH/DELETE `/webhook-subscriptions/{id}`
- GET `/webhook-subscriptions/{id}/deliveries`
- POST `/webhook-subscriptions/{id}/test`
- POST `/webhook-subscriptions/{id}/rotate-secret`
- POST `/webhook-subscriptions/{id}/deliveries/{deliveryId}/retry`

Session dashboard reuses `/api/v1/webhooks` with the same service functions.

## C. Developer documentation URLs

Public (no login): `/developers`, `/developers/quickstart`, `/developers/authentication`, `/developers/api-reference`, `/developers/orders`, `/developers/shipments`, `/developers/tracking`, `/developers/webhooks`, `/developers/integrations`, `/developers/build-with-ai`, `/developers/changelog`, `/developers/openapi.json`, `/developers/openapi.yaml`.

## D. Webhook event types

`order.created`, `order.updated`, `shipment.booking_requested` (alias `shipment.created`), `shipment.booked`, `shipment.booking_failed` (alias `shipment.failed`), `tracking.updated`, `shipment.out_for_delivery`, `shipment.delivered`, `shipment.exception` (`NDR`/`RTO`), `webhook.test`.

## E. Webhook security

HMAC-SHA256 of `timestamp.event_id.raw_body`, header `X-PostBus-Signature: v1=<hex>`, 5-minute timestamp window, HTTPS-only SSRF checks, DNS rebinding rejection, no redirects, 10s timeout, org isolation from the API key, allowlist flag default closed.

## F. Database migrations created

`supabase/migrations/20261018200000_merchant_webhook_platform.sql` — applied on production as `schema_migrations` name `merchant_webhook_platform` version `20261018191255`. Application code for webhooks/docs is **not** on Coolify SHA `fd90212`.

## G. Dashboard changes

Developer API tabs: Overview, API keys, API reference, Webhooks, API logs, Integration guides, AI integration.

## H. Integration examples

cURL, Node.js, Python, Google Apps Script, CRM/ERP/Sheets/custom AI prompts. n8n/Make/Zapier documented as generic HTTPS.

## I. Automated tests

Added/updated: webhook SSRF, signing, catalog mapping, delivery skip when closed, OpenAPI contract, flags, handle webhook scope, outgoing signature canonical string.

## J. Production verification status

REST canary was smoked 2026-10-18 (see PRODUCTION_SMOKE_REPORT.md). Public `/developers` and webhook handlers are **not** on production as of 2026-10-19 (`404` / missing SHA files). See PRODUCTION_LAUNCH_REPORT.md.

## K. Known issues and limitations

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## L. Remaining deployment steps

Backup, apply three additive migrations, deploy app, allowlist a canary org for REST and webhooks separately, no live CEPT smoke tests on customer data, explicit deploy approval.
