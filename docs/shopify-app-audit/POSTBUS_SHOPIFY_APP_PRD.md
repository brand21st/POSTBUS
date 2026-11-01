# Product Requirements Document — PostBus Shopify Embedded App

**Date:** 2026-10-20  
**Status:** Draft for approval — **no implementation until explicit go-ahead**  
**Website:** https://www.postbus.in

---

## 1. Problem

Shopify merchants using India Post today must leave Admin, create a PostBus password account, paste custom-app credentials, and run shipping on `www.postbus.in/dashboard`. That is not a native Shopify operations tool.

## 2. Goals

- Day-to-day shipping (sync, review, book, label, track, fulfill) **inside Shopify Admin**.  
- Reuse PostBus booking, CEPT, labels, tracking, jobs, quota.  
- No duplicate India Post bookings on retries.  
- Dual-run with existing SaaS.  
- App Store–compliant auth and billing.

## 3. Non-goals (MVP)

- Super Admin in Shopify  
- PostBus storefront, inventory, Cover Studio, AI Accountant  
- WhatsApp/Wati order capture  
- Merchant Public API key UI  
- Shopify Functions COD checkout suite (not in current product; old plan only)  
- USB printer auto-discovery inside iframe  
- WooCommerce  

## 4. Personas

- Shopify store owner (maps to PostBus OWNER after claim)  
- Staff processing orders (OPERATOR-like; **must not** change India Post credentials)  
- PostBus platform operator (uses existing `/admin`)  

## 5. Authentication requirements

- No PostBus password required to **use** the embedded app.  
- Org provisioned from verified shop, **never** email auto-merge.  
- Optional later “Open full PostBus dashboard” claim flow.  
- Server-side tenant checks always.

## 6. Functional requirements

### MVP (P0)

1. Install + ID token session + expiring offline token.  
2. Provision or link org (explicit link).  
3. India Post onboarding checklist: credentials, office, contract, barcode range, connection test. Block book until pass.  
4. Orders index: search, filter, paginate, bulk book (max 100 as today).  
5. Order detail: address/weight/COD **display**; extra COD charge rules as existing; do **not** silently rewrite Shopify order totals.  
6. Shipment status + retry + recovery banner (`RECOVERY_REQUIRED`).  
7. Label PDF download + browser print.  
8. Tracking timeline; fulfillment write-back uses `https://www.postbus.in/track?tracking=`.  
9. Automation toggles with copy: disabling does not cancel in-flight jobs.  
10. Entitlements from Shopify App Pricing (or trial) → existing quota RPC.  
11. GDPR + `app/uninstalled`.  

### P1

Manifests, NDR desk, shipping invoices, analytics cards, print-agent pairing docs, Admin order action “Book with PostBus”.

### P2

Label template editor, multi-print, support tickets (merchant only), tutorials.

## 7. COD rules

- Detect Shopify COD via existing `modules/shopify/payment.ts`.  
- `extra_cod_charge` is merchant-defined **collection** add-on for India Post, not a Shopify order edit.  
- Distinguish: Shopify order amount ≠ extra COD ≠ India Post tariff ≠ PostBus subscription.  
- Platform Razorpay ≠ merchant customer payments.

## 8. Onboarding checklist (dependency-aware)

Mandatory: Shopify install → org → India Post **verify** → contract/service → pickup/dropoff office → **barcode range** → default service → sync orders.

Optional: parcel defaults, automation, print agent, tariff flag.

Merchants **without** the same contract type: UI must choose `SP_INLAND_PARCEL` vs `BUSINESS_PARCEL` (existing codes). Do not assume one product.

## 9. Success metrics (targets; baselines **NOT MEASURED**)

- Time-to-first-book after install  
- Duplicate AWB rate = 0 on retries  
- Webhook import success / Shopify 429 retry  
- Uninstall token revocation SLA  

## 10. Compliance

- App Store: ID tokens, App Bridge script first, Shopify billing for listed charges, PCD for customer fields, no offsite checkout in the listed app.  
- Privacy policy URLs already on marketing site — **REQUIRES EXTERNAL VALIDATION** they cover Shopify GDPR.

## 11. Open questions

- App Pricing plan mapping vs STARTER/GROWTH/PRO/BUSINESS/ENTERPRISE (`BILLING_PLAN_CODES`).  
- Whether BYO custom-app merchants migrate automatically.  
- Multi-shop (blocked by unique index today).  
