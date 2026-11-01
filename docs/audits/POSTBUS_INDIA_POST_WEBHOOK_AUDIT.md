# India Post webhook audit

Read-only production inspection plus local tests. No request was sent to `www.postbus.in` or the India Post portal. No production row was written.

Customer `1392911671`, production connection. Portal URLs match the code that builds the dashboard links.

## Routes

There is no separate route file. `POST /api/v1/webhooks/india-post/{customerId}/{booking|events}` is handled by `app/api/v1/[...slug]/route.ts` → `handleV1` → `handleInboundWebhook` → `acceptIndiaPostWebhook`.

POST is registered. GET and other methods are not public webhook methods; they fall through to tenant authentication.

There is no webhook signature, shared secret, or provider HMAC. HTTP ingest is quarantined (HTTP 200, no persist). `INDIA_POST_WEBHOOK_ALLOWED_CIDRS` is not used.

## Flow

1. `webhookSourceIp` — `cf-connecting-ip`, else `x-real-ip`. `X-Forwarded-For` is not used.
2. `acceptIndiaPostWebhook` always returns `{ accepted: false, quarantined: true }` as HTTP 200. Nothing is stored. Leftover `INDIA_POST_WEBHOOK_ALLOWED_CIDRS` does not enable ingest.
3. Tenant isolation, body limit, CEPT JSON parse, `accept_india_post_webhook` RPC, and `india-post-events` jobs remain in `persistIndiaPostWebhook` / `processIndiaPostInboxEvent` for when a verified CEPT sender authenticator exists. They are not reachable from HTTP today.

## Production evidence

For customer `1392911671`: inbox rows 0, booking rows 0, event rows 0, `india-post-events` jobs 0. Delivery has not been proven. The production CIDR value is not in the repository (`.env.example` is empty). An empty live value would answer HTTP 200 and leave this same zero-row result.

## Confirmed limits

- Idempotency does not include office. Two different offices with the same article, event code, and timestamp collide on `provider_webhook_inbox_event_uidx`. The `tracking_events` unique index has the same office gap. Neither index was changed.
- Event time is parsed with a `Z` suffix, so a wall-clock India Post time is stored as UTC.
- IPv4 CIDR matching does not accept an IPv6 source.
- The first `x-forwarded-for` value is trusted when `cf-connecting-ip` is absent.
- Bulk tracking HTTP 403 is unchanged and is a separate capability.

## Tests

`webhook.test.ts`, `webhook-allowlist.test.ts`, and `webhook-process.test.ts`: 43 passed. Isolated mocks only.

## Portal Test button

Not safe to click until the production allowlist is confirmed non-empty and not world-open, and until it is accepted that an unknown portal payload which names a live article will update that shipment and may notify. The documented CEPT sample is a real event shape, not a labeled test. No request was sent.
