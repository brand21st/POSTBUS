# 08 Webhook and GDPR audit

**Scope:** `POST /api/shopify/webhooks` vs `POST /api/v1/webhooks/shopify`.

**Classification:** PASS for local HMAC/idempotency/stale-uninstall/size. GDPR processing: FAIL (persist-only, not complete). Live Shopify deliveries: BLOCKED.

## Phase 1.5 fix

Merchant UI flag no longer 404s public-app webhooks. HMAC runs when `SHOPIFY_PUBLIC_APP_CLIENT_SECRET` is set.

## HMAC

Public secret + `timingSafeEqual` (`safeEqual`). BYO `verifyWebhookHmac` unchanged (`modules/shopify/oauth.ts` still uses `SHOPIFY_API_SECRET`).

## Uninstall

Disconnects `shopify_app_installations` only. Stale `X-Shopify-Triggered-At` before `installed_at` is ignored.

## GDPR

`customers/data_request` → RECEIVED. `customers/redact` / `shop/redact` → PENDING_REVIEW with legal-retention note. **No SaaS org/customer deletion.** Do **not** mark GDPR COMPLETE.

## Tests

Invalid HMAC, uninstall without BYO table, stale uninstall, oversized body, duplicate delivery, GDPR persist PENDING_REVIEW: PASS (Vitest).
