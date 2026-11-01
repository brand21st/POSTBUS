# Test results

Command (2026-10-20, local):

```
npx vitest run lib/shopify-app lib/security/headers.test.ts modules/shopify/oauth.test.ts
```

Final recorded output:

```
Test Files  11 passed (11)
     Tests  51 passed (51)
  Start at  09:31:20
  Duration  2.54s
```

## Coverage in this run

- ID token HS256 accept/reject (signature, audience, iss/dest mismatch, exp, nbf, missing).
- Public-app HMAC vs BYO secret; BYO `verifyWebhookHmac` still uses `SHOPIFY_API_SECRET`.
- CSP: `/shopify` embeddable when flag on; `/dashboard` and `/admin` DENY; no shop query in frame-ancestors.
- Tenant org match; tenant queries always filter `organization_id`; `shopify_connections` forbidden.
- Flag-off BFF 404; client org id rejected.
- Provision PGlite: concurrent first launch one org; no email merge; unique shop_domain; reinstall without second org.
- Uninstall HMAC fail; uninstall does not touch `shopify_connections`.
- Token encrypt round-trip; refresh skew.
- `handleV1` still owns `webhooks/shopify`; public-app secret not referenced in `modules/shopify/oauth.ts`.

## Not claimed

- Live Shopify Admin iframe install: **PENDING** (no Partner credentials, no `shopify app deploy`).
- Production migration apply: **not run**.
- Live webhook registration: **not run**.
- Playwright / App Bridge session-token automated check: **not run**.
