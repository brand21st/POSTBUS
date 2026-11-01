# 08 Authentication test

**Classification:** PASS for local unit tests. BLOCKED for live ID token / token exchange.

## Local

`npx vitest run lib/shopify-app lib/security/headers.test.ts modules/shopify/oauth.test.ts`  
**12 files, 65 passed** (2026-10-20 10:02:46).

Covers HS256 ID token, org mismatch, HMAC, mocked exchange failure.

## Live

ID token from `tuzzstore.myshopify.com`: NOT TESTED.  
Offline token exchange against that shop: NOT TESTED.
