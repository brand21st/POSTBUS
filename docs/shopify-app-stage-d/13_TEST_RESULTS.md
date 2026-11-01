# 13 Test results

## Automated (executed)

```
npx vitest run lib/shopify-app lib/security/headers.test.ts modules/shopify/oauth.test.ts
```

2026-10-20 10:02:46:

```
Test Files  12 passed (12)
     Tests  65 passed (65)
```

## HTTP (executed, flag off)

```
shopify:404
bootstrap:404
dashboard:307
```

## Live Admin 01–25

All **BLOCKED** (no install, no tunnel, no credentials, production DB in `.env.local`).

Do not label them PASS.
