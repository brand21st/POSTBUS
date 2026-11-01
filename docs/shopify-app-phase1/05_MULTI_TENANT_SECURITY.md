# Multi-tenant security

## Two identities

| Surface | Auth | Tenant |
|---------|------|--------|
| `/dashboard`, `/api/v1` | Supabase cookie / `requireTenant` | `organization_members` |
| `/shopify`, `/api/shopify` | Shopify ID token | `shopify_app_installations.shop_domain` → `organization_id` |

Do not add `/shopify` to the cookie proxy allowlist. Do not call `requireTenant` from the Shopify BFF.

## Isolation rules enforced in Phase 1

- Shop A cannot load shop B: dest host is the only shop source.
- Client `organization_id` is ignored unless it equals the installation org (`assertOrganizationMatch`).
- Email takeover is impossible: provision never looks up profiles.
- Shopify staff are not OWNER members.
- Public-app tokens live only on `shopify_app_installations`. BYO tokens stay on `shopify_connections`.
- Tenant admin helper throws if `organizationId` is empty and never queries `shopify_connections`.
- Uninstall wipes public-app encrypted tokens only. Bookings, Razorpay, and BYO connections are untouched.

## CSP

When the flag is on, `/shopify` and `/api/shopify*` use static `frame-ancestors https://admin.shopify.com https://*.myshopify.com https://admin.shop.dev`. Query `shop` is never interpolated. `X-Frame-Options` is omitted on those paths only. `/dashboard` and `/admin` keep `DENY` + `frame-ancestors 'none'`.

## Secrets

Public app HMAC uses `timingSafeEqual` (`safeEqual`). BYO `verifyWebhookHmac` is unchanged (including its `===` compare) so the dual-HMAC mix audit finding is not reintroduced here.
