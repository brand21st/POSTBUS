# PostBus Admin Feature Inventory

**Status:** READ-ONLY  
**Date:** 2026-10-20  
**Shopify reuse classes:**  
A unchanged · B API/session adapt · C Polaris UI replacement · D major refactor · E new · F not in Shopify merchant app

Counts are **VERIFIED** from `app/**/page.tsx` in the main tree.

| Surface | Page count |
|---------|------------|
| Merchant dashboard (`app/dashboard/**`) | **34** |
| Merchant onboarding (`app/onboarding`) | **1** |
| Super Admin (`app/(admin)/admin/**`) | **19** |
| Partner portal (`app/partner/**`) | **12** (all **F**) |
| Marketing / public / storefront | Out of Shopify merchant app unless noted |

---

## 1. Merchant dashboard pages

Auth: Supabase cookie + `requireTenant` on APIs. Layout: `app/dashboard` (not enumerated here). State: React Query / local `useState`; no global Redux.

### 1.1 Home and analytics

| Page | Route | Purpose | Key APIs | Class |
|------|-------|---------|----------|-------|
| Dashboard | `/dashboard` | KPIs, pipeline, recent orders, Shopify sync, quick ship | `GET dashboard/kpis`, `pipeline`, `orders`, `integrations`, `POST shipments`, `POST integrations/shopify/sync` | **C+B** |
| Analytics | `/dashboard/analytics` | Period charts (revenue, COD, sources) | `GET dashboard/analytics` | **C+B** (or F if Shopify Analytics preferred) |

### 1.2 Orders

| Page | Route | Purpose | Features / actions | Class |
|------|-------|---------|--------------------|-------|
| Orders list | `/dashboard/orders` | Operational order desk | Search, status/source/payment filters, offset pagination, checkboxes, bulk fulfill (`POST orders/bulk/status`), bulk India Post booking, Shopify sync, tariff, table layouts | **C+B** |
| New order | `/dashboard/orders/new` | Manual create | Products, address, WhatsApp parse, pack presets, extra COD | **C+B** optional |
| Order detail | `/dashboard/orders/[id]` | Single order | Lines, weights, address edit, shipment create, Shopify payment confirm, invoices | **C+B** |
| Customer links | `/dashboard/orders/customer-links` | Shareable WhatsApp collection | create/confirm links | **F** |

**Pagination / selection (**VERIFIED**):** Offset pagination; selection is in-memory. Header “select all” **replaces** selection with the current page (`docs/POSTBUS_ORDERS_SELECTION_PERSISTENCE_AUDIT.md`, `components/dashboard/data-table.tsx`). Shopify Index Table must not copy this defect.

CSV **import** is **not** implemented (export exists). Google Sheets is an Apps Script **example**, not a first-party sync.

### 1.3 Shipments, labels, manifests, tracking, NDR

| Page | Route | Purpose | Class |
|------|-------|---------|-------|
| Shipments | `/dashboard/shipments` | List | **C+B** |
| Shipment detail | `/dashboard/shipments/[id]` | Events, retry, labels, NDR sync | **C+B** |
| Labels | `/dashboard/labels` | Queue, download, print | **C+B** |
| Label customize | `/dashboard/labels/customize` | Official/custom editor | **C+B** later |
| Label templates | `/dashboard/labels/templates`, `[id]` | Saved templates | **C+B** later |
| Multi-print | `/dashboard/labels/multi-print` | Multi-up sheets | **C+B** later |
| Manifests | `/dashboard/manifests` | Pickup manifests | **C+B** |
| Tracking | `/dashboard/tracking` | Lookup + branded page editor | Lookup **C+B**; branded public page **F**/optional |
| NDR/RTO | `/dashboard/ndr-rto` | Exception buckets, sync | **C+B** |

### 1.4 Invoices, automation, billing, AI, inventory

| Page | Route | Purpose | Class |
|------|-------|---------|-------|
| Invoices | `/dashboard/invoices` | Shipping invoice PDFs | **C+B** |
| Invoice customize | `/dashboard/invoices/customize` | Template | Later **C+B** |
| Automation | `/dashboard/automation` | Toggles (Shopify sync/book/fulfill/print/tracking) | **C+B** MVP |
| Billing | `/dashboard/billing` | Razorpay plans, usage, AI credits | **F** as-is; Shopify billing **E** |
| AI Accountant | `/dashboard/ai-accountant` | GST/COD/assistant | **F** |
| Inventory | `/dashboard/inventory` | Products/categories/storefront | **F** |
| Cover Studio | `/dashboard/inventory/covers/[id]` | AI covers | **F** |

### 1.5 Integrations

| Page | Route | Purpose | Class |
|------|-------|---------|-------|
| Hub | `/dashboard/integrations` | Cards | **C** |
| India Post | `/dashboard/integrations/india-post` | Credentials, office, contracts, barcodes | **C+B** **MVP** |
| Shopify | `/dashboard/integrations/shopify` | BYO Client ID/secret + OAuth | **D/E** replace with Partner install |
| Wati | `/dashboard/integrations/wati` | Merchant Wati | **F**/optional |
| Vachat | `/dashboard/integrations/vachat` | Support transport | **F**/optional |
| PostBus WhatsApp | `/dashboard/integrations/postbus-whatsapp` | Platform WA | **F**/optional |
| Google Sheets | `/dashboard/integrations/google-sheets` | Script example | **F** |
| Developer | `/dashboard/integrations/developer` | API keys / OpenAPI | **F** |

### 1.6 Settings, support, tutorials, onboarding

| Page | Route | Purpose | Class |
|------|-------|---------|-------|
| Settings | `/dashboard/settings` | Org profile, members, notifications, print, parcel defaults | Shipping/print **C+B**; staff **D** vs Shopify users |
| Support | `/dashboard/support` | Ticket workspace | Optional **C+B**; Super Admin queues **F** |
| Tutorials | `/dashboard/tutorials` | CMS videos | **C** or **F** |
| Onboarding | `/onboarding` | Create org name | **E** (Shopify install onboarding) |

---

## 2. Super Admin — all **F** for the public Shopify app

| Route | Module |
|-------|--------|
| `/admin` | Overview |
| `/admin/accounts`, `/admin/accounts/[id]` | Tenant accounts |
| `/admin/plans` | Plan catalog |
| `/admin/subscriptions` | Subscriptions |
| `/admin/payments` | Payments |
| `/admin/razorpay` | Razorpay health |
| `/admin/revenue` | Revenue |
| `/admin/usage` | Usage |
| `/admin/trial` | Trial settings |
| `/admin/tax` | Tax policy |
| `/admin/invoices` | Subscription tax invoices |
| `/admin/addons` | Add-ons |
| `/admin/ai-credits` | AI credit admin |
| `/admin/affiliates` | Affiliates |
| `/admin/tutorials` | Tutorial CMS |
| `/admin/audit` | Billing audit |
| `/admin/india-post-webhooks` | CEPT webhook health |
| `/admin/settings` | Platform secrets + **unassigned support queues** |

API: `app/api/admin/[...slug]/route.ts` → `lib/api/admin/handle.ts`.

**Recommendation:** Keep Super Admin **outside** Shopify. Add Shopify-specific **platform** views later (installs, uninstalls, webhook failures, App Pricing) on `/admin`, never in the merchant iframe.

---

## 3. Permission-dependent merchant features (**VERIFIED**)

Roles in `lib/permissions/rbac.ts`:

- `integrations.manage` — OWNER/ADMIN (Shopify/India Post writes)
- `org.billing` — OWNER only
- `shipments.write` — OWNER/ADMIN/MANAGER/OPERATOR
- VIEWER is read-only for operations

Shopify staff roles **must not** be assumed to map 1:1. Enforce PostBus permissions server-side; optionally overlay online token staff permissions for Shopify API calls.

---

## 4. Background operations merchants trigger

| Action | Job type | Gate |
|--------|----------|------|
| Sync Shopify | `shopify-sync` | `auto_shopify_sync` on webhook import; manual sync button |
| Create/book shipment | `shipment-booking` | `createShipmentsForOrders`; `auto_booking` on Shopify upsert |
| Labels | `label-generation` | Always after successful book (**`auto_label_generation` does not gate worker**) |
| Print | print jobs | `auto_label_printing` |
| Manifest | `manifest-generation` | `auto_manifest` |
| Tracking | `tracking-sync` | `auto_tracking_sync` |
| Shopify fulfillment | `shopify-fulfillment` | `auto_shopify_fulfillment` |

Disabling a toggle **does not cancel in-flight jobs** (**VERIFIED**).

---

## 5. Partner, marketing, storefront

All **F** for the Shopify merchant app: `/partner/*`, marketing SEO pages, `app/(storefront)`, public order links, WhatsApp order forms.

Customer-facing tracking (`/track`) stays public; Shopify fulfillment should continue pointing at PostBus tracking URL.
