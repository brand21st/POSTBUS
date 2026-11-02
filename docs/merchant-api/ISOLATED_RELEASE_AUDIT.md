# Isolated Developer Platform v1 — repository audit

Date: 2026-10-19. Read-only production identity was re-verified before the isolated branch was created.

## Production identity (re-verified)

| Item | Value |
|---|---|
| Coolify app | `mw9larpomkyonxzy1rk3h6jm` `running:healthy` |
| Branch | `release/auth-session-on-prod` |
| SHA | `fd9021236e9c8e136ca20b80a38d1c0621c475a5` |
| Site | `https://www.postbus.in` |
| Health | api/database Healthy, `jobRunner=database`, jobs/shopify/indiaPost **Warning** (pre-existing) |
| Local dirty HEAD | `b3de2b8a9555072daa94374c03fcb2ecca994dd1` on `fix/auth-session-stability` |

## Isolation method

Git worktree + branch `release/merchant-developer-platform-v1` created from `fd90212`. The dirty working tree was not checked out and was not discarded.

## File inventory

### REQUIRED (included)

| Path | Why |
|---|---|
| `app/(marketing)/developers/**` | Public docs + OpenAPI routes |
| `app/dashboard/integrations/developer/page.tsx` | Portal tabs, scopes, docs links |
| `app/dashboard/integrations/developer/developer-webhooks.tsx` | Dashboard webhook UI |
| `modules/merchant-api/**` (delta + new `webhook-routes.ts`, `openapi-document.ts`) | REST compatibility + webhook dispatch + OpenAPI |
| `modules/webhooks/{catalog,deliver,outbox,publish,sign,ssrf,subscriptions}.ts` + tests | Outbox, SSRF, HMAC, worker |
| `modules/webhooks/outgoing.ts` + test | Keep `emitWebhook`; canonical HMAC includes event id |
| `lib/api/v1/workspace.ts` | Session `/api/v1/webhooks` uses the same subscription service (auth unchanged) |
| `lib/api/v1-permissions.ts` + test | Nested `/webhooks/:id/...` requires `webhooks.manage` |
| `lib/api/v1-schemas.ts` | Key mint allows `webhooks:read` / `webhooks:manage` |
| `lib/env.ts`, `.env.example` | Document independent webhook flags |
| `modules/orders/service.ts` | `order.created` after commit; skipped for `source=API` |
| `modules/merchant-api/orders.ts` | API `order.created` after persist |
| `modules/shopify/orders.ts` | Status-change `order.updated`; new import `order.created`; try/catch |
| `modules/shipments/service.ts` | `shipment.booking_requested` on QUEUED |
| `modules/india-post/booking-run.ts` | `shipment.booked` / `booking_failed` after persist |
| `modules/india-post/apply-tracking.ts` | `publishTrackingResult` after ingest; try/catch |
| `workers/processor.ts` | `webhook-processing` → `runWebhookProcessing` |
| `supabase/migrations/20261018200000_merchant_webhook_platform.sql` | History only; **already applied** as name `merchant_webhook_platform` |
| `docs/merchant-api/*` expansion + isolated reports | Operator contract |

### OPTIONAL

| Path | Why |
|---|---|
| `docs/merchant-api/PRODUCTION_SMOKE_REPORT.md` | Prior REST canary evidence |

### UNRELATED (excluded)

Affiliate, partner, print agent, billing/Razorpay, labels UI, tracking parser patches, env files, `.cursor`, scripts, dirty `package.json`, `next.config.ts`, experimental storefront.

### RISKY (reviewed, included as minimum shared hooks)

Order create, Shopify upsert, shipment queue, booking persist, tracking apply, session webhook routes, worker `deliverWebhooks`. Behavior of booking/CEPT is unchanged except post-commit publish wrapped in try/catch.

### BLOCKED (not in this commit)

Coolify pin/deploy, webhook allowlist population, live CEPT, Google Sheets E2E, production dashboard login.

## Migrations

Do **not** re-apply. See `PRODUCTION_MIGRATION_PLAN.md`.
