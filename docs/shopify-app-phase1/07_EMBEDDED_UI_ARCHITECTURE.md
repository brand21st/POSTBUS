# Embedded UI architecture

Real URL segment `app/shopify/` (a route group would not create `/shopify`).

| URL | File |
|-----|------|
| `/shopify` | `app/shopify/page.tsx` |
| `/shopify/onboarding` | `app/shopify/onboarding/page.tsx` |
| `/shopify/settings` | `app/shopify/settings/page.tsx` |
| `/api/shopify/*` | `app/api/shopify/[...slug]/route.ts` |

No collision with `/dashboard`, `/admin`, `/api/v1`, `/track`.

## Layout

`app/shopify/layout.tsx` only:

- `<meta name="shopify-api-key" content="{public client id}" />`
- App Bridge CDN and Polaris CDN `beforeInteractive`
- Kill switch `notFound()` when the flag is off
- No PostBus dashboard chrome, no fake order metrics, no Orders/Shipments nav

## Client shell

- `ShopifyTokenProvider` uses `useAppBridge` and authenticated `fetch` with the ID token.
- 401 + `X-Shopify-Retry-Invalid-Session-Request` retries `idToken()`.
- Polaris web components: `s-page`, `s-section`, `s-banner`, `s-spinner`, `s-text`, `s-stack`.

## States (bootstrap only)

Dashboard reads `GET /api/shopify/bootstrap`: shop domain, installation status, org ready yes/no, India Post **read-only** `india_post_connections.status` if an org exists.

Mapped UI: Connected / Setup required / Provisioning / Authorization required / Error.

Onboarding steps 1–2 are live (install verified, org created). Steps 3–5 are marked coming later. There is **no** India Post password form.
