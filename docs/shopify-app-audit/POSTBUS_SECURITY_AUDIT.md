# PostBus Security Audit (Shopify-app context)

**Status:** READ-ONLY static review  
**Date:** 2026-10-20  
**No pentest, no production writes.**

Shopify session tokens / ID tokens: **NOT PRESENT** (`package.json`; grep). Embedded auth is a **net-new** control.

---

## Threat model (Shopify + existing SaaS)

| Asset | Attacker | Impact |
|-------|----------|--------|
| Org orders/shipments | Other merchant | Data leak, fraudulent bookings |
| India Post credentials | Other merchant / stolen session | Book on another contract |
| Shopify offline token | Stolen DB + encryption key | Store takeover via Admin API |
| Platform Razorpay keys | Confused with merchant keys | Platform funds / merchant charges mixed |
| CEPT booking | Replay / double submit | Duplicate AWB charges |
| GDPR data | Public app without compliance webhooks | App Store rejection / legal |

---

## Findings

### CRITICAL

None **confirmed** in reviewed tenant order-get paths (org filter present).

**Proposed CRITICAL if implemented wrong:** resolving org from client JSON instead of verified JWT `dest`; using service-role without forced `organization_id`.

### HIGH

| ID | Finding | Evidence | Shopify impact |
|----|---------|----------|----------------|
| H1 | Dashboard APIs are cookie-session; iframe third-party cookies fail | App Store 1.1.1; `requireTenant` uses Supabase cookies | Must use ID token auth |
| H2 | CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY` | `lib/security/headers.ts` L69, L93 | Blocks embed until path-scoped |
| H3 | In-memory rate limit | `lib/security/rate-limit.ts`; `handle.ts` L37–42 | Weak under multi-instance |
| H4 | Incomplete CSRF (`assertBrowserOrigin` only on some mutation files) | print/label-template/commerce | Cookie APIs; Shopify BFF should **not** use cookies as primary |
| H5 | Shopify webhook idempotency committed before success | `inbound-webhooks.ts` | Missed imports on retry |
| H6 | `app/uninstalled` not registered | `ORDER_WEBHOOK_TOPICS` | Tokens survive uninstall |
| H7 | Service-role Merchant API | `merchant-api/handle.ts` | Query hygiene required |

### MEDIUM

| ID | Finding | Evidence |
|----|---------|----------|
| M1 | Shopify HMAC compared with `===` not `timingSafeEqual` | `oauth.ts` L123–136 |
| M2 | CSP `'unsafe-inline'` scripts/styles | `headers.ts` |
| M3 | Outbound webhook DNS TOCTOU | `modules/webhooks/ssrf.ts` |
| M4 | `shopifyReadyToSync` without CONNECTED token | `orders.ts` ~524 |
| M5 | Platform `SHOPIFY_API_SECRET` tried on every webhook HMAC | `oauth.ts` |
| M6 | India Post inbound HMAC not live (quarantined) | `webhook-allowlist.ts` |
| M7 | `INTEGRATION_ENCRYPTION_KEY` compromise decrypts all org secrets | `crypto.ts` |

### LOW

| ID | Finding | Evidence |
|----|---------|----------|
| L1 | Client ID stored plaintext | expected for OAuth |
| L2 | JSON-LD XSS mitigated | `serializeJsonLd` |
| L3 | Open redirects mitigated | `safeAuthNext` + tests |

---

## Controls that work

- AES-256-GCM secrets (`lib/security/crypto.ts`); prod throws if key missing  
- Order list/get filter `organization_id`  
- RLS `is_org_member` on tenant tables  
- Outbound webhook HTTPS + public IP checks + no redirects  
- Razorpay **platform** credentials only (`modules/razorpay/config.ts` comment)  
- OTP rate buckets / auth audit (WhatsApp login)  
- Booking locks + no blind CEPT re-POST  
- `safeAuthNext` open-redirect tests  

---

## Merchant cannot (intended)

If RLS + org filters hold, a merchant cannot access another org’s orders, shipments, India Post credentials, settings, invoices, AI credits, or trigger their bookings.

**Caveats:** service-role bugs, stolen encryption key, stolen Shopify token, guessed webhook HMAC if platform secret reused.

---

## Shopify-specific requirements

1. Verify ID token: `exp`, `nbf`, `aud` = client id, `iss`/`dest` host match; then **token exchange** for **expiring offline** token (`expiring=1`).  
2. Send ID tokens **only** to PostBus backend, never to CEPT/Razorpay.  
3. 401 + `X-Shopify-Retry-Invalid-Session-Request` on stale JWT.  
4. Do not authenticate embedded UI with Supabase passwords.  
5. Organization linking: shop ownership via `dest`, not email.  
6. Online tokens optional for attributing staff; **authorization for PostBus data remains server-side org RBAC**. Shopify staff “Staff” is not OWNER.  
7. GDPR webhooks + retention jobs.  
8. Separate platform Razorpay from any future **merchant** Razorpay (COD advance in old plan — **not implemented**; if built, isolate keys).  

---

## Secret handling in this audit

No secrets printed. Env names only: `INTEGRATION_ENCRYPTION_KEY`, `SHOPIFY_API_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_*`, `CRON_SECRET`.
