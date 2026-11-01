# Phase 1 implementation plan

**Status:** Implemented locally. Not deployed. Migration is additive and has not been applied to production.

## Goal

Ship a flag-gated Shopify embedded App Home foundation inside this Next.js repo, isolated from the existing merchant dashboard, BYO Shopify connector, India Post booking, and billing.

## Architecture

Shopify Admin iframes `/shopify` → App Bridge ID token → `/api/shopify/*` BFF → HS256 verify with the **public Partner app** secret → `shopify_app_installations` → headless `organizations` row (`origin = SHOPIFY_PUBLIC_APP`).

The SaaS dashboard remains cookie-gated in `lib/supabase/proxy.ts` (`/dashboard`, `/admin`, `/onboarding` only). `/shopify` is not on that gate.

BYO store connections stay on `shopify_connections` and `POST /api/v1/webhooks/shopify`. The public app never verifies HMAC with `SHOPIFY_API_SECRET`.

## Tasks completed

1. Config: `shopify.app.toml`, `shopify.web.toml`, public-app env placeholders, `SHOPIFY_EMBEDDED_APP_ENABLED` default false, packages `@shopify/app-bridge-react`, `@shopify/app-bridge-types`, `@shopify/polaris-types`, `jose`.
2. Path-scoped CSP for `/shopify` and `/api/shopify` when the flag is on.
3. Additive migration `supabase/migrations/20261020120000_shopify_public_app_foundation.sql`.
4. ID token BFF, expiring offline token exchange, encrypted token storage, `GET/POST /api/shopify/bootstrap`.
5. Public-app webhooks at `POST /api/shopify/webhooks`.
6. Polaris web-component App Home, onboarding, settings.
7. Vitest suite + this documentation set.

## Dependencies (not in Phase 1)

- Partner Dashboard client ID/secret (placeholders only).
- `shopify app deploy` / live webhook registration.
- Production `supabase db push` / migrate.
- Orders BFF, booking, labels, billing, App Store listing.

## Kill switch

`SHOPIFY_EMBEDDED_APP_ENABLED` must be the exact string `true`. Otherwise `/shopify` is `notFound()` and `/api/shopify/*` returns 404. Dashboard behavior is unchanged.
