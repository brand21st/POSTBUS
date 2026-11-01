# Known limitations and unverified items

- Bulk import is synchronous, max 25 rows. The cap is a safety limit, not a measured production benchmark.
- Rate limits use Postgres counters; they were not load-tested at multi-region scale.
- Cursor pagination uses `updated_at,id`. Clock skew is possible but ordering is stable per database timestamps.
- Tracking freshness is 15 minutes plus an async enqueue; clients must poll if webhooks are not enabled.
- Official labels exist only after PostBus has stored a PDF.
- Outbound merchant webhooks are implemented in this expansion but **default closed**. Empty `MERCHANT_WEBHOOKS_ORG_ALLOWLIST` delivers nothing.
- Webhook delivery is at-least-once. Merchants must deduplicate on event `id`.
- `label.generated` and `manifest.generated` remain catalog leftovers and are not emitted.
- `shipment.exception` is not a database status; payloads use `NDR` or `RTO`.
- Legacy `api_keys` rows (SHA-256, no `lookup_id`) cannot call Merchant API.
- `createManualOrder` may leave an orphan order if `external_order_id` unique insert races; sequential retries return the winner.
- Google Apps Script is a documented example, not a hosted integration.
- There are no native Zapier, Make, or n8n plugins.
- Browser verification of the Developer Portal may be incomplete without a logged-in merchant session.
- All three additive Merchant API migrations are on production. REST v1 is live for one allowlisted org. Webhook handlers and `/developers` are **not** on the running Coolify SHA (`fd90212`). Do not treat local docs as production.
