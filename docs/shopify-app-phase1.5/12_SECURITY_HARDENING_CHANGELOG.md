# 12 Security hardening changelog

**Scope:** Local Phase 1.5 defect fixes only.

| ID | Root cause | Files | Test |
|----|------------|-------|------|
| P0/P1 kill switch vs webhooks | `assertShopifyEmbeddedEnabled()` wrapped uninstall/GDPR | [`lib/shopify-app/handle.ts`](../../lib/shopify-app/handle.ts), [`context.ts`](../../lib/shopify-app/context.ts) | Flag off still processes webhooks; bootstrap still 404s |
| P1 stale uninstall | Update by shop only | [`webhooks.ts`](../../lib/shopify-app/webhooks.ts), [`uninstall-timing.ts`](../../lib/shopify-app/uninstall-timing.ts) | Triggered-at before `installed_at` ignored |
| P1 service-role RPC | `admin.rpc.bind` unbounded | [`tenant-admin.ts`](../../lib/shopify-app/tenant-admin.ts) | `rpc()` throws |
| P1 token exchange failure | Mocked 400; lock race | [`token-exchange.test.ts`](../../lib/shopify-app/token-exchange.test.ts) | No access token returned; lock maxActive 1 |
| P1 webhook size / duplicate | Missing limits / concurrent map | [`webhooks.ts`](../../lib/shopify-app/webhooks.ts) | Oversized 422; duplicate SUCCEEDED |
| P2 BFF rate limit | None on `/api/shopify` | [`handle.ts`](../../lib/shopify-app/handle.ts) | Uses existing `rateLimit` (60 BFF / 180 webhooks) |

CSP: kept Shopify static `frame-ancestors` list; **no** `?shop=` interpolation. Official iframe-protection URL returned 404 in this session; list matches Shopify’s documented Admin + `*.myshopify.com` + `admin.shop.dev` pattern from Phase 1.

No production or BYO HMAC changes.
