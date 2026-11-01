# 02 Shopify app configuration audit

**Scope:** [`shopify.app.toml`](../../shopify.app.toml), [`shopify.web.toml`](../../shopify.web.toml), [`lib/env.ts`](../../lib/env.ts), `.env.example`.

**Classification:** PASS for placeholder isolation. FAIL for live Partner identity (not created). BLOCKED for `shopify app deploy`.

## Expected

Embedded public app, distinct from BYO `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`, GraphQL API version `2026-04`, webhooks on `/api/shopify/webhooks`.

## Actual

- `embedded = true`
- `client_id = "REPLACE_WITH_PARTNER_APP_CLIENT_ID"` (dummy)
- `application_url = "http://localhost:3000/shopify"`
- `automatically_update_urls_on_dev = false`
- Scopes match env default (orders/products/fulfillments/locations)
- Webhooks: `app/uninstalled` + compliance topics → `/api/shopify/webhooks`
- Shopify CLI inspected: **3.90.0** (`shopify version` only). `shopify app info` / `app dev` / `app deploy` **not run**.

BYO connector env names remain separate. Public-app HMAC code paths do not read `SHOPIFY_API_SECRET`.

## Failures / blockers

- No real Partner app client ID in repo (by design).
- Local HTTP application URL cannot pass App Store TLS (3.1.1) until a public HTTPS URL exists.

## Recommendations

After Stage D approval: create a **new** Partner app (do not paste BYO keys), put secrets in gitignored `.env.local`, point `application_url` at a tunnel/HTTPS host, then register webhooks to `/api/shopify/webhooks`.
