# PostBus Shopify App — Executive Summary

**Date:** 2026-10-20  
**Nature of work:** Read-only audit. **No code, database, env, deploy, booking, or payment changes.**  
**Evidence pack:** `docs/shopify-app-audit/` (15 documents).

---

## Answers to the 20 executive questions

### 1. Current architecture?

Next.js **16.3.8** App Router + React 19 + TypeScript + Supabase Postgres/RLS + catch-all `/api/v1` + DB/BullMQ jobs + India Post CEPT + Razorpay SaaS billing + a **BYO Shopify custom-app connector**. Not an embedded Shopify app.

### 2. How many merchant-facing modules/pages?

**34** dashboard pages + **1** onboarding page. Plus public tracking, optional storefront, marketing. See inventory.

### 3. How many Super Admin modules?

**19** `/admin` pages. **None** belong in the public Shopify app.

### 4. Which backend services can be reused?

Orders/shipments (`createShipmentsForOrders`), India Post provider (session, book, tariff, track, labels), barcode allocation, booking locks/idempotency, label/invoice PDFs, tracking-sync, Shopify fulfillment write-back, automation settings, quota RPC, print agent, NDR, manifests. **Reuse via server, not by copying dashboard UI.**

### 5. What needs refactoring?

Auth for iframe (ID tokens), CSP, webhook idempotency, uninstall registration, GDPR, billing provider split, tenant-scoped service-role for headless orgs, HMAC compare, rate limit store, Shopify API version unification.

### 6. Shopify integration maturity?

**Mature as a dashboard connector. Immature as a public embedded app.** OAuth, encrypted tokens, HMAC webhooks, REST+GraphQL, sync jobs exist. No App Bridge, no session tokens, no `shopify.app.toml`, CSP blocks iframes.

### 7. Can we use the existing database safely?

**Yes for shipping tables**, with additive migrations. **Do not** auto-merge orgs by email. Keep 1 shop ↔ 1 org for MVP (unique indexes). Headless installs need a **new** access path that still forces `organization_id`.

### 8. Can both UIs share the backend simultaneously?

**Yes.** Same jobs and modules. Separate auth. Keep BYO `shopify_connections` until merchants migrate.

### 9. Authentication changes?

Shopify ID token → verify → expiring offline token exchange. **No password required** to operate the embed. Optional claim to link a Supabase user. PostBus RBAC stays server-side; Shopify staff ≠ OWNER.

### 10. All routine shipping inside Shopify?

**Yes, for the India Post pipeline**, after CEPT onboarding: review, pack, book, PDF label, track, fulfill. **Not** USB printer control, Super Admin, or customer checkout.

### 11. Special browser / external integrations?

Browser/App Bridge `print()`; PDF download; optional **local Print Agent** for USB; Shopify-hosted **App Pricing**; public `/track` for customers; never CEPT from the browser.

### 12. Recommended architecture?

**Option C:** add `app/(shopify)` + `/api/shopify` BFF in this repo; Polaris App Home iframe; shared `modules/*`. Do not rewrite the backend. Do not iframe the existing dashboard.

### 13. Most critical security risks?

Iframe cookie auth (won’t work); service-role without org filter; headless RLS gap; uninstall not registered; webhook retry hole; email-merge takeover if someone “simplifies” linking; Razorpay vs App Store billing.

### 14. App Store publication changes?

ID tokens + latest App Bridge; Shopify billing (not Razorpay) for listed charges; GDPR webhooks; PCD for customer data; no custom-app key paste as the public UX; no offsite checkout in the listed app; factual listing.

### 15. Implementation complexity?

**High** (auth, compliance, billing, dual-app webhooks) but **not a rewrite**. Shipping core is the hard-won part and should stay. Roughly **multi-month** for production-grade App Store, **not** a two-week UI wrap. Effort **UNKNOWN** in hours (no team velocity in repo).

### 16. First MVP?

Install/auth/provision, India Post onboarding, orders list/detail, bulk book, labels PDF, tracking, automation toggles, uninstall/GDPR, App Pricing entitlements.

### 17. Later?

NDR, manifests, invoices, template editors, multi-print, Admin extensions, support inbox, analytics, print agent polish, multi-shop, AI, storefront.

### 18. Biggest migration risks?

Headless tenancy/RLS; dual billing; dual Shopify app HMAC; duplicate booking under bulk; CSP regressions.

### 19. Safest rollout?

Flags → dev store → UAT CEPT → allowlisted beta → keep `/dashboard` → then App Store. Never cut over by deleting BYO connections.

### 20. Build first?

1) Path-scoped CSP + empty App Home.  
2) ID token BFF + org provision **with takeover tests**.  
3) Orders + `createShipmentsForOrders`.  
4) Uninstall/GDPR.  
5) App Pricing entitlements.

---

## Recommendation

**Approve Phase 0.** Implement only after explicit approval. Treat India Post and booking idempotency as **sacred shared services**. Treat the Shopify app as a **new native UI + auth + billing adapter**, not a second shipping engine.

---

## Document index

1. `POSTBUS_CURRENT_ARCHITECTURE.md`  
2. `POSTBUS_ADMIN_FEATURE_INVENTORY.md`  
3. `POSTBUS_API_INVENTORY.md`  
4. `POSTBUS_DATABASE_ARCHITECTURE.md`  
5. `POSTBUS_SHOPIFY_INTEGRATION_AUDIT.md`  
6. `POSTBUS_INDIA_POST_INTEGRATION_AUDIT.md`  
7. `POSTBUS_SECURITY_AUDIT.md`  
8. `POSTBUS_SHOPIFY_FEATURE_PARITY.md`  
9. `POSTBUS_SHOPIFY_NATIVE_APP_ARCHITECTURE.md`  
10. `POSTBUS_SHOPIFY_APP_PRD.md`  
11. `POSTBUS_SHOPIFY_APP_UI_UX_SPEC.md`  
12. `POSTBUS_SHOPIFY_APP_IMPLEMENTATION_PLAN.md`  
13. `POSTBUS_SHOPIFY_APP_TEST_PLAN.md`  
14. `POSTBUS_SHOPIFY_APP_RISK_REGISTER.md`  
15. This file  

**India Post Approach PDF:** not in repo — **REQUIRES EXTERNAL VALIDATION**.  
**Production SLOs:** **NOT MEASURED**.
