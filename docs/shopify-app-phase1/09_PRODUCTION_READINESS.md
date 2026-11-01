# Production readiness

Phase 1 is **not** production-ready. Kill switch stays false until an explicit go-live.

## Blockers

1. Partner app client ID/secret and App URL on a public HTTPS host.
2. Apply `20261020120000_shopify_public_app_foundation.sql` to a non-production project first, then production with a change window.
3. `shopify app deploy` / webhook registration only after HMAC endpoint is reachable.
4. Legal review of GDPR redact vs shared SaaS org retention (handlers persist requests; they do not delete merchant data).
5. Live Admin iframe verification (App Bridge, session token, CSP).
6. No orders, booking, labels, or billing in the embedded app yet — App Store listing would fail functional review.
7. Token exchange against real shops (expiring offline tokens, refresh lock under load).
8. Observability: structured logs exist (`shopify_app.provision`, `shopify_app.webhook`) but no dashboard/alerts.

## Must remain true at deploy

- Do not iframe `/dashboard`.
- Do not reuse `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` for the public app.
- Do not register public-app webhooks on `POST /api/v1/webhooks/shopify`.
- Do not auto-merge organizations by staff email.
- Do not grant Shopify staff `organization_members` OWNER.
- Do not call CEPT or Razorpay from `/shopify`.

## Rollback

Set `SHOPIFY_EMBEDDED_APP_ENABLED=false`. Existing SaaS continues. Do not drop `shopify_connections`. Do not reverse CEPT bookings.
