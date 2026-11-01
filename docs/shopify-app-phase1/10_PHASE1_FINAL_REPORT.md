# Phase 1 final report

PostBus now has a **local, flag-off-by-default** Shopify embedded App Home foundation. It is a separate product identity from the BYO Shopify connector and from the cookie-authenticated dashboard.

## What shipped

- `/shopify` App Home, onboarding, and settings using App Bridge + Polaris web components.
- `/api/shopify/bootstrap` ID-token BFF and `/api/shopify/webhooks` HMAC endpoint.
- Additive schema: `shopify_app_installations`, compliance tables, `organizations.origin`, service-role provision RPC.
- Path-scoped embed CSP that leaves `/dashboard` and `/admin` locked down.
- 51 passing Vitest cases including PGlite provision concurrency and BYO regression.

## What did not ship (by design)

- Production migrate/deploy, Partner deploy, live webhooks.
- India Post password/onboarding, booking, labels, fulfillment, Razorpay.
- Fake order metrics or unused nav screens.
- Email-based org merge or Shopify staff as OWNER.

## Readiness

**Local foundation: complete. Live Admin iframe: PENDING. Production: not authorized.**

Enable only in a private dev store after Partner credentials are placed in gitignored env and the migration is applied to an isolated database.
