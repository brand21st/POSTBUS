# Shopify app configuration

## Files

| File | Role |
|------|------|
| `shopify.app.toml` | Embedded app placeholder. `client_id` is a dummy. Do **not** run `shopify app deploy`. |
| `shopify.web.toml` | Points Shopify CLI `dev` at `npm run dev`. Not a Remix scaffold. |
| `.env.example` | Public-app env names. Distinct from `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`. |
| `.env.staging.example` | Same kill switch, default off. |
| `lib/env.ts` | `shopifyEmbeddedAppEnabled`, `shopifyPublicAppClientId`, `shopifyPublicAppClientSecret`, API version default `2026-04`, scopes. |

## Environment

```
SHOPIFY_EMBEDDED_APP_ENABLED=false
SHOPIFY_PUBLIC_APP_CLIENT_ID=
SHOPIFY_PUBLIC_APP_CLIENT_SECRET=
SHOPIFY_PUBLIC_APP_API_VERSION=2026-04
SHOPIFY_PUBLIC_APP_SCOPES=read_orders,write_orders,read_products,read_fulfillments,write_fulfillments,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_locations
```

`SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` remain the BYO / platform-fallback connector. Mixing those secrets into public-app HMAC or ID tokens is forbidden.

## Packages

- `@shopify/app-bridge-react@4.2.13` (React 19)
- `@shopify/app-bridge-types`
- `@shopify/polaris-types` (web components `s-*`, not legacy `@shopify/polaris` React)
- `jose` for HS256 session tokens

## Local enablement (dev only)

1. Create a Partner app (not done in this phase).
2. Put client ID/secret in a gitignored `.env.local`.
3. Set `SHOPIFY_EMBEDDED_APP_ENABLED=true`.
4. Restart `npm run dev`.
5. Do not apply the migration to production.

## Health when the flag is off

`/shopify` and `/api/shopify/*` 404. There is no public health JSON on those paths. This document is the health note.
