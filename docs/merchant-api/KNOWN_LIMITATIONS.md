# Known limitations and unverified items

- Bulk import is synchronous, max 25 rows. The cap is a safety limit, not a measured production benchmark.
- Rate limits use Postgres counters; they were not load-tested at multi-region scale.
- Cursor pagination uses `updated_at,id`. Clock skew is possible but ordering is stable per database timestamps.
- Tracking freshness is 15 minutes plus an async enqueue; clients must poll.
- Official labels exist only after PostBus has stored a PDF.
- Outbound merchant webhooks are **not** in this release. Existing `webhook_endpoints` delivery still lacks SSRF URL blocking.
- Legacy `api_keys` rows (SHA-256, no `lookup_id`) cannot call Merchant API.
- `createManualOrder` may leave an orphan order if `external_order_id` unique insert races; sequential retries return the winner.
- Google Apps Script is a documented example, not a hosted integration.
- Browser verification of the Developer Portal was not completed in this implementation pass if a logged-in merchant session was unavailable.
- Production migration and production traffic were not executed.
