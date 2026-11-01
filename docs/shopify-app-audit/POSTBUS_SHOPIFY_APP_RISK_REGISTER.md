# PostBus Shopify App Risk Register

**Date:** 2026-10-20  
Likelihood/impact: H/M/L. Residual after planned controls.

| ID | Risk | Type | L | I | Evidence | Mitigation | Residual |
|----|------|------|---|---|---------|------------|----------|
| R1 | Duplicate CEPT book on timeout | Shipping | M | H | `booking-idempotency.ts`; HOSTINGER note | Keep `canRetryCeptPostAfterUnknown=false`; recovery UI | M |
| R2 | Cross-tenant via service-role | Security | M | H | Merchant API pattern | Forced org wrapper + tests | L if tests ship |
| R3 | Headless org bypasses RLS | Security | H | H | RLS uses `auth.uid()` | Don’t use user client for embed | H until designed |
| R4 | Email auto-link takeover | Security | M | H | Common SaaS bug; **not in code today** | Never merge on email | L |
| R5 | CSP change breaks marketing/dashboard clickjacking | Security | M | H | `headers.ts` deny-all | Path-prefix only | M |
| R6 | App Store reject: cookies / App Bridge | Compliance | H | H | No app-bridge; 1.1.1 | ID tokens + script tag | M |
| R7 | App Store reject: Razorpay charges | Compliance | H | H | 1.2.1; `checkout-button.tsx` | App Pricing; hide Razorpay in embed | M |
| R8 | PCD not approved | Compliance | M | H | `read_orders` addresses | Apply before listing | M |
| R9 | `app/uninstalled` not registered | Security | H | M | `ORDER_WEBHOOK_TOPICS` | Register + test | L after Phase 3 |
| R10 | Webhook idempotency swallows failures | Reliability | H | M | insert-before-process | Commit on success | L after fix |
| R11 | Double billing Razorpay + Shopify | Billing | M | H | Dual product | One entitlement; link rules | M |
| R12 | Unique 1 shop/org blocks multi-store | Product | H | L | migration 20260925140000 | MVP 1:1 | L |
| R13 | `auto_label_generation` does not gate jobs | Product | H | L | processor always enqueue | Fix or honest UI | L |
| R14 | In-memory rate limit | Reliability | H | M | `rate-limit.ts` | Redis/DB limiter | M |
| R15 | HMAC not constant-time | Security | L | L | `oauth.ts` | timingSafeEqual | L |
| R16 | Approach PDF missing | Legal/ops | H | M | spec.ts citation | Obtain PDF | M |
| R17 | REST 2025-01 vs GraphQL 2026-04 drift | Tech | M | M | `orders.ts` L38–39 | Standardize GraphQL | M |
| R18 | Tracking URL hard-gated to www.postbus.in | Ops | H | L | `shopifyTrackingInfo` | Staging policy | L |
| R19 | Shared Next process blast radius | Ops | M | H | Option C | Flags, Sentry, lanes | M |
| R20 | Staff vs PostBus RBAC | Security | M | M | `rbac.ts` | Server perms; don’t trust UI | M |
| R21 | Print Agent expectation vs iframe | UX | H | L | Print API = `print()` | Docs + agent | L |
| R22 | BYO custom-app vs Partner app dual HMAC | Integration | M | H | org vs platform secret | Separate apps/secrets | M |
| R23 | In-flight jobs after automation off | Product | H | M | audit | Copy + optional cancel API later | M |
| R24 | Quota consumed then CEPT fail | Billing | M | M | `consume_order_quota` timing **PARTIALLY VERIFIED** | Confirm when quota decrements vs book | M |
| R25 | Scope creep COD Functions | Delivery | M | H | old plan phases 10a–f | Out of MVP | L if scoped |
| R26 | Performance unknown | Reliability | H | M | SLOs NOT MEASURED | Instrument before GA | M |
| R27 | Non-expiring offline tokens sunset 2027 | Compliance | H | H | Shopify access token docs | `expiring=1` from day one | L if followed |

---

## Biggest migration risks

1. Auth/RLS for installs without Supabase users.  
2. App Store billing vs existing Razorpay customers.  
3. Webhook/HMAC dual-app.  
4. Booking reliability under Shopify-originated bulk.  
5. CSP and clickjacking.
