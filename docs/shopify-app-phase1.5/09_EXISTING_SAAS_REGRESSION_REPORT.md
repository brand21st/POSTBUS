# 09 Existing SaaS regression report

**Scope:** Dashboard, BYO Shopify, v1 handle, oauth HMAC.

## Baseline reproduction (Stage A, 2026-10-20)

Command:

```
npx vitest run lib/shopify-app lib/security/headers.test.ts modules/shopify/oauth.test.ts
```

Actual: **Test Files 11 passed (11), Tests 51 passed (51)** at 09:46:13. Matches historical Phase 1 claim.

## After Phase 1.5 hardening (same command)

Actual: **Test Files 12 passed (12), Tests 65 passed (65)** at 09:48:30.

(`uninstall-timing.test.ts` added; other files gained cases.)

## Other surfaces

| Surface | Result |
|---------|--------|
| BYO `verifyWebhookHmac` | PASS (oauth.test.ts) |
| `handleV1` still owns `webhooks/shopify` | PASS (`v1-regression.test.ts`) |
| `/dashboard` cookie gate unchanged | PASS (code review `lib/supabase/proxy.ts`; `/shopify` not listed) |
| Live dashboard login | NOT TESTED this session |
| CEPT / Razorpay / fulfillment | NOT APPLICABLE (not invoked) |

**Production untouched:** PASS.
