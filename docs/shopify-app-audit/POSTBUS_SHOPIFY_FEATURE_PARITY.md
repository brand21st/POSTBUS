# PostBus Shopify Feature Parity Matrix

**Date:** 2026-10-20  
Reuse %: **UNKNOWN** unless backend call is the same function (then **backend ~100%**, UI **UNKNOWN**). Do not invent UI percentages.

**Shopify App Required?** = needed for day-to-day India Post shipping inside Admin.

---

## Summary

| Bucket | Count (approx) | Notes |
|--------|----------------|-------|
| MVP inside Shopify | Orders, shipments, book, labels download/print PDF, tracking lookup, India Post settings, automation toggles, fulfillment write-back | Backend reusable |
| Later | Template editors, multi-print, NDR desk, manifests, invoices, support, analytics | |
| Intentional exclusions | Super Admin, Partner, storefront, inventory, AI studios/accountant, Razorpay checkout, WhatsApp order links, developer API hub, BYO Shopify keys UI | **F** |
| Must replace | Auth, billing for App Store, CSP, install lifecycle, Polaris UI | **E** |

Lost if Shopify-only merchant: WhatsApp collection links, PostBus storefront, Cover Studio, affiliate portal, AI accountant — **intentional** unless product later includes them. They remain on `www.postbus.in/dashboard`.

---

## Matrix

| Existing feature | Route | Logic | API | DB | In Shopify app? | Native UI | Reuse | Changes | Risk | Priority | Tests |
|------------------|-------|-------|-----|-----|-----------------|-----------|-------|---------|------|----------|-------|
| Dashboard KPIs | `/dashboard` | `modules/dashboard/analytics.ts` | `GET dashboard/kpis` | orders/shipments | Yes MVP lite | Metrics cards | Backend high / UI UNKNOWN | Polaris homepage | L | P1 | KPI contract |
| Orders list | `/dashboard/orders` | `listOrders` | `GET /orders` | orders | **Yes** | Index table + filters | Backend high | Fix cross-page selection; cursor later | M | **P0** | pagination, bulk |
| Order detail | `/dashboard/orders/[id]` | `getOrder` | `GET /orders/:id` | orders, lines | **Yes** | Details template | high | Address lock after book | M | P0 | COD display |
| Bulk fulfill/book | orders page | `bulk-status.ts` → `createShipmentsForOrders` | `POST orders/bulk/status` `POST shipments` | shipments, jobs | **Yes** | Bulk actions | **~100% backend** | Concurrency unchanged | **H** | P0 | duplicate book, two users |
| Manual order | `/orders/new` | `createManualOrder` | `POST /orders` | orders | Optional | Form | high | Not Shopify source of truth | L | P2 | |
| CSV import | — | **Not implemented** | export only | — | No unless E | — | n/a | — | — | — | |
| Customer links | `/orders/customer-links` | commerce | customer-links | customer_order_links | **No** | — | — | Checkout rule 1.1.2 | H compliance | F | |
| Shipments | `/shipments` | shipments service | `/shipments` | shipments | **Yes** | Index | high | | M | P0 | retry |
| Labels download | `/labels` | labels | `/labels/:id/download` bulk | labels | **Yes** | Download + print() | high | App Bridge print = page/PDF; USB agent outside | M | P0 | PDF |
| Label editors | customize/templates | label-template | label-template* | label_templates | Later | Settings | high | | L | P2 | |
| Multi-print | `/labels/multi-print` | multi-up | | label_sheet_members | Later | | high | | M | P2 | |
| Manifests | `/manifests` | | `/manifests` | manifests | Later | | high | | L | P1 | |
| Tracking lookup | `/tracking` | tracking-sync apply | `GET tracking` | tracking_events | **Yes** | Timeline | high | | M | P1 | event order |
| Branded tracking page | tracking editor | tracking-pages | tracking-pages* | tracking_pages | Optional | | | Public URL stays | L | P3 | |
| NDR/RTO | `/ndr-rto` | ndr-rto | `/ndr-rto*` | shipments | Later | | high | | M | P1 | |
| Invoices | `/invoices` | invoices | `/invoices*` | shipping_invoices | Later | | high | Not Shopify invoices | L | P2 | |
| Automation | `/automation` | `automation/service.ts` | workspace automation | automation_settings | **Yes** | Settings switches | high | Show queued-job caveat | M | P0 | disable stops **new** jobs |
| India Post connect | `/integrations/india-post` | provider | integrations/india-post* | india_post_* barcode_ranges | **Yes** | Setup guide | high | Gate booking until verify | **H** | P0 | no CEPT from browser |
| Shopify connect UI | `/integrations/shopify` | oauth | integrations/shopify* | shopify_connections | **Replace** | Managed install | ADAPT | Partner app | **H** | P0 | OAuth/token exchange |
| Wati/Vachat/WA | integrations/* | | | | No MVP | | | | | F | |
| Developer API | `/integrations/developer` | merchant-api | api-keys | api_keys | No | | | | | F | |
| Billing Razorpay | `/billing` | billing | `/billing/*` | subscriptions | **No charges** | Shopify App Pricing | 0 for charges | Entitlement adapter | **H** | P0 App Store | no double bill |
| Settings org/team | `/settings` | orgs | organizations members | members | Partial | Settings | WRAP | Staff vs RBAC | M | P1 | |
| Print pairing | settings printing | print | print-devices | print_devices | Optional | External nav | REUSE | USB not in iframe | M | P1 | |
| Support | `/support` | support | `/support*` | support_* | Optional | | WRAP | No admin queues | M | P2 | tenant isolation |
| AI credits/studios/accountant | billing/inventory/ai-accountant | ai-* | | ai_* | **No** | | | | L | F | |
| Inventory/storefront | `/inventory` store | storefront | products | products | **No** | | | Shopify catalog | | F | |
| Onboarding create org | `/onboarding` | session | POST organizations | organizations | **Replace** | Setup guide | E | Provision from shop | **H** | P0 | no email merge |
| Super Admin | `/admin/*` | admin handle | `/api/admin` | platform_* | **No** | — | — | | | F | |
| Partner | `/partner/*` | affiliates | `/api/partner` | affiliate_* | **No** | | | | | F | |
| Public track | `/track` | public track | `/api/v1/public/track` | | Customers only | Theme / email | REUSE | | L | — | |
| WooCommerce | — | **enum only** | — | — | No | | | | | — | |

---

## Coverage

- **Routine shipping inside Shopify Admin:** Yes for review → validate pack → tariff (if enabled) → book → label PDF → tracking → fulfillment, **if** India Post onboarded and entitlements OK.  
- **Not inside iframe:** USB thermal control, print-agent installer, CEPT itself, Shopify hosted billing confirmation, public customer tracking, Super Admin.  
- **Browser print:** App Bridge documents `print()` — desktop uses browser dialog; Mobile/POS intercepted. **Does not enumerate USB printers** (Shopify Print API docs **VERIFIED**).
