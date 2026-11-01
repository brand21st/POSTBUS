# Installation data model

Migration: `supabase/migrations/20261020120000_shopify_public_app_foundation.sql`  
**Not applied to production.**

## `organizations.origin`

Additive `text` column, default `'WEB'`, check `WEB | SHOPIFY_PUBLIC_APP`.  
`created_by` was already nullable; headless Shopify orgs insert `created_by = null`.

## `shopify_app_installations`

Dedicated table. Not `shopify_connections`.

| Constraint | Meaning |
|------------|---------|
| Unique `(app_client_id, shop_domain)` | One install per public app + shop |
| Unique `shop_domain` | This public app identity owns the shop row |
| Status check | `PENDING \| CONNECTED \| REAUTH_REQUIRED \| DISCONNECTED \| ERROR` |
| `organization_id` FK | Restrict delete |
| Encrypted tokens | `encrypted_access_token`, `encrypted_refresh_token` |
| `claimed_at` | Null in Phase 1 |

Status mapping vs older `integration_status`: `DISCONNECTED` is uninstall; `REAUTH_REQUIRED` is token exchange/refresh failure.

## RPC `provision_shopify_app_organization`

Service-role execute only. Advisory transaction lock on shop domain.

- Never matches `profiles.email`.
- On conflict of existing install: return that org (`is_new = false`).
- Reinstall of `DISCONNECTED` resets status to `PENDING` without a second org.
- Concurrent first launches serialize on the lock; tests expect a single org.

Return columns are `org_id`, `install_id`, `is_new` so they do not collide with table columns named `organization_id` inside PL/pgSQL.

## Compliance

`shopify_compliance_requests`: webhook id unique, payload hash, status `RECEIVED | PENDING_REVIEW | COMPLETED`.

`shopify_app_webhook_deliveries`: idempotency keyed by `X-Shopify-Webhook-Id`, inserted **after** successful handling.

## RLS

Authenticated/anon have no grants. Service role is used only from server code. Tenant wrapper `createShopifyTenantAdmin(organizationId)` always `.eq("organization_id", …)` (or `.eq("id", …)` on `organizations`) and refuses `shopify_connections`.
