# PostBus Shopify App Implementation Plan

**Date:** 2026-10-20  
**Constraint:** Existing production SaaS remains up. Additive migrations only. No CEPT calls from CI against production.

Existing unpublished plan (`.cursor/plans/shopify_embedded_app_53eff4cb.plan.md`) is **directionally aligned**; this document **revises sequencing** from the repo audit and **drops** COD Functions / Thank-you / App Proxy from the critical path (those features are **not** in the current product).

---

## Phase 0 — Audit approval (this deliverable)

**Objectives:** Architecture freeze.  
**Deliverables:** `docs/shopify-app-audit/*` (this set).  
**Dependencies:** Owner approval.  
**Risks:** Scope creep (AI, storefront).  
**Accept:** Written go / no-go.  
**Tests:** None.  
**Rollback:** N/A.

---

## Phase 1 — Foundation (no merchant traffic)

**Objectives:** `shopify.app.toml`, Partner app, env names (no production secret rotation unless ops owns it), packages `@shopify/app-bridge-react`, `@shopify/app-bridge-types`, `@shopify/polaris-types`.  
**Deliverables:** Scaffold `app/(shopify)/`, App Bridge script in that layout only.  
**CSP:** Path-prefix `frame-ancestors` for `/shopify` **behind flag**.  
**Risks:** Global CSP regression on marketing site.  
**Accept:** `/shopify` hello world in a **dev store** iframe; `/dashboard` still `frame-ancestors none`.  
**Rollback:** Flag off.  
**Tests:** Header unit tests for two CSP profiles.

---

## Phase 2 — Auth and provisioning

**Objectives:** ID token verify, token exchange (expiring offline), `shopify_installations` **or** reuse `shopify_connections` with `install_source`.  
**Deliverables:** `requireShopifyTenant`; tenant-scoped service-role helper + **cross-tenant rejection test**. Provision org without email merge.  
**Dependencies:** Phase 1.  
**Risks:** RLS vs headless org.  
**Accept:** Dev store install creates org; second install same shop reconnects; different shop new org.  
**Rollback:** Drop unused tables (migration reverse only if never shipped).  
**Tests:** JWT fixture tests; takeover (email match) **rejected**.

---

## Phase 3 — Webhooks and compliance

**Objectives:** Register order topics **plus** `app/uninstalled` and GDPR topics. Fix idempotency **commit on success**.  
**Dependencies:** Phase 2 tokens.  
**Risks:** Breaking existing BYO webhooks — use compatible HMAC.  
**Accept:** Uninstall clears token; duplicate webhook after failure **retries work**.  
**Rollback:** Feature flag registration set.  
**Tests:** HMAC, GDPR stub handlers, uninstall.

---

## Phase 4 — Shared API integration (BFF)

**Objectives:** `/api/shopify/v1` wrapping `listOrders`, `createShipmentsForOrders`, labels, tracking, automation, India Post settings.  
**Accept:** Same booking lock/idempotency as dashboard (contract tests).  
**Tests:** Auth missing 401; org mismatch 404.

---

## Phase 5 — Native dashboard + orders

**Objectives:** Home + Orders index/detail + bulk book.  
**Dependencies:** Phase 4, India Post not required for **list**.  
**Risks:** Selection pagination.  
**Accept:** Book 1 and 25 orders on dev store **UAT CEPT only**.  
**Rollback:** UI flag.  
**Tests:** Playwright Admin (dev store) + duplicate booking.

---

## Phase 6 — India Post booking UX

**Objectives:** Onboarding checklist, verify, barcode, recovery UI.  
**Accept:** Booking blocked until verify; recovery does not re-POST.  
**Tests:** Existing booking-idempotency tests remain green.

---

## Phase 7 — Labels and bulk PDFs

**Objectives:** Download/print using existing generators.  
**Accept:** A6 official + one merchant format.  
**Tests:** PDF smoke (already have label tests).

---

## Phase 8 — Tracking and fulfillment

**Objectives:** Timeline UI; confirm `shopify-fulfillment` job for Partner-app tokens; tracking URL production host rule (consider staging exception **without** breaking prod invariant — product decision).  
**Tests:** `shopifyTrackingInfo` tests.

---

## Phase 9 — Settings and automation

**Objectives:** Toggles + copy about in-flight jobs.  
**Tests:** `auto_shopify_sync=false` skips import.

---

## Phase 10 — Billing and entitlements

**Objectives:** Shopify App Pricing + entitlement adapter; **no Razorpay** in Shopify UI. Dual-sub linking rules. Quota still `consume_order_quota`.  
**Risks:** App Store 1.2.x.  
**Tests:** Entitlement denied booking; reinstall resubscribe.

---

## Phase 11 — Support and optional P1

Admin extensions, NDR, manifests, invoices, print agent docs. Super Admin Shopify health pages on `/admin` only.

---

## Phase 12 — Hardening

Rate limit (Redis/DB), audit install/billing, structured logs, HMAC timing-safe compare, webhook idempotency, observability (today **NOT MEASURED**).

---

## Phase 13 — App Store review readiness

PCD application, listing assets, privacy, GDPR, App Bridge first script, billing, session-token automated check (disable ad blockers).

---

## Phase 14 — Controlled beta

Allowlisted shops; UAT or production CEPT **only with merchant contract**; support runbook.

---

## Phase 15 — Production rollout

Progressive; keep BYO dashboard path; migrate volunteers.

---

## Cross-cutting rollback

- Feature flags: `SHOPIFY_EMBEDDED_ENABLED`, webhook topic set, billing provider.  
- Never reverse CEPT bookings.  
- Never drop `shopify_connections` in a hurry.

## What to build first after approval

1. CSP split + empty App Home  
2. ID token BFF + org provision tests  
3. Orders list wrapping `listOrders`  
4. Book wrapping `createShipmentsForOrders`  
5. Uninstall + GDPR  
6. App Pricing entitlements  
