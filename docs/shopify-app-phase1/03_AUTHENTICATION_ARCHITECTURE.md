# Authentication architecture

Phase 1 uses Shopify **session ID tokens**, not the merchant SaaS cookie session and not `requireTenant()`.

## ID token (`lib/shopify-app/id-token.ts`)

- Algorithm: HS256 with `SHOPIFY_PUBLIC_APP_CLIENT_SECRET` only.
- `aud` must equal `SHOPIFY_PUBLIC_APP_CLIENT_ID`.
- `iss` host and `dest` host must match and be `*.myshopify.com`.
- Shop identity is taken from `dest`, never from query `shop` or body `organization_id`.
- Stale/invalid JWT → `401 AUTH_REQUIRED` plus `X-Shopify-Retry-Invalid-Session-Request: 1`.

App Bridge `fetch` retries once with a fresh `idToken()` when that header is present (`components/shopify-app/token-provider.tsx` via `useAppBridge`).

## Context (`lib/shopify-app/context.ts`)

`requireShopifyAppContext()`:

1. Kill-switch + public-app config check.
2. Verify bearer ID token.
3. `provision_shopify_app_organization` RPC (idempotent).
4. Load `shopify_app_installations` for this public client + shop.
5. If `DISCONNECTED`, 401 + retry header (reinstall required).
6. Token exchange if access token missing; refresh with an in-memory per-shop lock if expiry is near.

Staff `sub` is stored as `last_shopify_user_id` only. Shopify staff are **not** inserted into `organization_members`.

## Token exchange (`lib/shopify-app/token-exchange.ts`)

- Grant: token exchange, `requested_token_type` offline, `expiring=1`.
- Tokens encrypted with existing `encryptSecret` (AES-256-GCM).
- Tokens never returned to the browser and never logged.
- Exchange failure sets install status `REAUTH_REQUIRED`; bootstrap still returns so the UI can show Authorization required. No Admin API order/fulfillment calls in Phase 1.

## BFF (`/api/shopify/bootstrap`)

`GET` or `POST`. Optional `organization_id` query/body is compared to the installation org and rejected on mismatch. It cannot select another tenant.
