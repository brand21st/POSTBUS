# PostBus Product Requirements Document

| Field | Value |
| --- | --- |
| Product | PostBus |
| Website | [https://www.postbus.in](https://www.postbus.in) |
| Version | 0.1.0 (living document; reflects the current codebase) |
| Audience | Product, engineering, QA, support, Super Admin |
| Status | Production shipping-management platform |
| Last updated | 2026-10-10 |

---

## 1. Overview

PostBus is **India Post shipping management software for Indian ecommerce merchants**. It is not a courier and it does not sell postage. Merchants connect an existing **India Post Customer ID**, import or create orders, book parcels through CEPT, print labels, build manifests, track articles, and invoice customers from one workspace.

The repository is the full product: public marketing site, merchant dashboard, tenant APIs, Super Admin, Supabase schema, background jobs, and a local print agent.

**Positioning:** “Connect your existing India Post Customer ID and manage orders, shipping labels, tracking and invoices from one dashboard.”

---

## 2. Problem

Indian merchants who already ship with India Post typically:

- Re-enter Shopify or WhatsApp orders into CEPT or Excel booking files
- Print labels and manifests from disconnected tools
- Lose visibility after booking (NDR, OFD, RTO) because tracking is not operationalized
- Notify customers by hand on WhatsApp
- Have no single place for support conversations tied to orders

PostBus replaces that patchwork with a tenant workspace on top of the merchant’s own India Post contract.

---

## 3. Goals

1. Make India Post booking the default fulfillment path for Shopify, manual, API, WooCommerce, and WhatsApp orders.
2. Keep booking, labels, manifests, tracking, NDR/RTO, and invoices in one permissioned dashboard.
3. Consume plan quota only when an India Post booking succeeds (failed bookings do not count).
4. Keep India Post postage billing with India Post; PostBus bills software only (Razorpay).
5. Stay multi-tenant: every operational query is scoped by `organization_id` and RLS (`is_org_member`).

### Non-goals

- Acting as a courier or reseller of postage
- Carrier actions India Post CEPT does not expose (reattempt, address change, “request RTO”)
- Replacing merchant India Post Customer IDs with a PostBus master account
- Using platform Razorpay keys for merchant storefront checkout (Domain A vs merchant payments stay separate)

---

## 4. Users and roles

### 4.1 Personas

| Persona | Needs |
| --- | --- |
| Merchant owner | Signup, trial, billing, India Post + Shopify connect, team |
| Warehouse / packing operator | Orders → book → print labels → manifest |
| Support agent | Tickets, WhatsApp inbox, tracking, NDR/RTO |
| Customer (end buyer) | Track page, order-collection links, WhatsApp store |
| Super Admin (PostBus staff) | Accounts, plans, trials, Razorpay, usage, audit |

### 4.2 Workspace roles

`OWNER`, `ADMIN`, `MANAGER`, `OPERATOR`, `VIEWER`

Permissions include org/billing, members, orders, products, shipments, labels, manifests, tracking pages, automation, integrations, API keys, webhooks, audit, settings, and support (read / reply / assign / manage / settings).

### 4.3 Super Admin

Access via `platform_admins` (or bootstrap `PLATFORM_ADMIN_EMAIL`). Console at `/admin`. Sensitive billing actions (for example plan change) require the Super Admin PIN.

---

## 5. Product surfaces

| Surface | Routes / entry |
| --- | --- |
| Marketing | `/`, `/features`, `/pricing`, `/contact`, SEO landers |
| Auth | `/login`, `/register`, `/forgot-password`, `/reset-password` |
| Onboarding | `/onboarding` |
| Merchant app | `/dashboard/*` |
| Public tracking | `/track`, `{subdomain}.postbus.in` |
| Public store / order links | `/store/[workspace]`, `/order/[...]` |
| Super Admin | `/admin` |
| Tenant API | `/api/v1/...` (session + tenant) |
| Admin API | `/api/admin/...` |
| Webhooks | `/api/webhooks/razorpay`, India Post / Shopify / Wati / VaChat handlers |
| Jobs | `/api/cron/jobs`, `/api/cron/billing`, optional `npm run workers` |
| Print agent | `print-agent/` on the packing PC |

---

## 6. Functional requirements

### 6.1 Authentication and tenancy

- Email + password via Supabase Auth; SSR cookies refreshed in `proxy.ts`.
- Register creates `auth.users` → `profiles` (`handle_new_user`) → organization via `GET /api/v1/me` (`create_organization_for_user`).
- WhatsApp number is collected at signup as a profile field, not as the login factor today.
- **Planned (flagged):** PostBus-owned WhatsApp OTP coexisting with password; production cutover gated on AUTH template approval and duplicate-phone cleanup. Do not unique-index phones until duplicates are resolved.

**Acceptance**

- Unauthenticated users cannot load tenant APIs.
- Non–platform-admins cannot call `/api/admin/*`.
- Logout clears the session and returns to login.

### 6.2 Orders

**Sources:** `SHOPIFY`, `MANUAL`, `API`, `WOOCOMMERCE`, `WHATSAPP`.

**Order statuses:** `IMPORTED` → `READY` → `PROCESSING` → `BOOKED` → `SHIPPED` → `IN_TRANSIT` → `DELIVERED`, plus `FAILED` / `CANCELLED`.

**Must support**

- List with filters, persisted row selection, CSV export
- Create manual orders; open detail; edit shipping address, weights, booking service
- Bulk status updates
- Customer collection links (WhatsApp pending + legacy submissions)
- Payment statuses: pending, paid, partial, COD, refunded, failed
- Fulfillment statuses: unfulfilled, partial, fulfilled, cancelled

**Acceptance**

- Address edits persist and appear on subsequent booking/label payloads.
- Shopify line-item images backfill in the background when missing.
- Quota is **not** consumed by creating or importing an order.

### 6.3 Inventory and products

- Catalog, categories, stock reserve/commit/release, opening/adjustment, RTO return movements.
- Used by dashboard inventory and by the public WhatsApp storefront.

### 6.4 Shipments and India Post booking

Merchants connect CEPT credentials (UAT or Production). Bookable article types:

- `SP_INLAND_PARCEL` — Speed Post Parcel Domestic
- `BUSINESS_PARCEL` — Business Parcel (CX)

**Shipment statuses** include draft through booked, label/manifest pending/ready, in transit, OFD, delivered, NDR, RTO, failed, cancelled, plus recovery-required for interrupted bulk booking.

**Must support**

- Create shipments from orders (single and bulk)
- Excel validate + queue bulk booking
- Retry failed bookings; set dimensions
- Session management to CEPT; office/origin lookup
- Booking lock / crash recovery so a worker death does not double-book

**Acceptance**

- Successful booking writes article number and consumes order quota (`consume_order_quota`).
- Failed booking does not consume quota.
- Concurrent drain of `background_jobs` is safe (`FOR UPDATE SKIP LOCKED`).

### 6.5 Labels, invoices, manifests

- Fetch/store official India Post label PDF when CEPT provides it.
- Custom packing labels and templates; multi-up print sheets; packing slips.
- Unicode / Indic address layout must remain printable.
- Invoice generate / retry / regenerate / customize.
- Manifest create and list.

**Acceptance**

- Label download returns PDF with source header (`X-Label-Source` when official).
- Incomplete labels can be retried without creating a second booking.

### 6.6 Tracking and NDR / RTO

Tracking events land from CEPT webhooks (inbox + allowlist) and bulk poll (`syncTracking`). Duplicates are rejected.

**Operational buckets** (one current value per shipment): `OUT_FOR_DELIVERY`, `DELIVERED`, `NDR`, `RTO`, `RTO_IN_TRANSIT`, `RTO_DELIVERED`. `Delivered Today` is derived (Asia/Kolkata).

**Rules**

- Newer OFD after NDR returns the shipment to OFD; newer consignee delivery after NDR → `DELIVERED`.
- After return has started, a later “delivered” scan is `RTO_DELIVERED`, not consignee delivered.
- RTO delivered must **not** set order status to `DELIVERED` and must **not** fire Shopify/Wati delivered notifications.
- Dashboard is observational: no reattempt / request-RTO buttons against CEPT.

**Acceptance**

- NDR & RTO page summary + list + manual sync stay tenant-scoped.
- Shipment detail shows NDR/RTO facts alongside the timeline.

### 6.7 Public tracking pages

- Global `/track`.
- Published branded pages on `{subdomain}.postbus.in`.
- Merchant controls publish, banners, subdomain availability.

### 6.8 Automation

Per-organization toggles:

| Toggle | Effect |
| --- | --- |
| Shopify sync | Import/update orders |
| Shipment creation | Create shipment rows from ready orders |
| Booking | Queue India Post booking |
| Label generation | Generate labels after book |
| Manifest | Auto manifest |
| Tracking sync | Poll/apply tracking |
| Shopify fulfillment / processing | Push status back to Shopify |
| Wati order / processing / booked / in-transit / delivered | WhatsApp UTILITY notices |
| Auto label printing | Enqueue print jobs for the local agent |

**Acceptance**

- Toggles persist; jobs honor the flags.
- Print jobs are not printed twice for the same generated label.

### 6.9 Integrations

| Integration | Requirement |
| --- | --- |
| Shopify | OAuth, order sync, fulfillment callbacks |
| India Post | Encrypted Customer ID / CEPT session, default service, parcel defaults, offices |
| Wati | Merchant WhatsApp UTILITY templates |
| VaChat / PostBus WhatsApp | Platform and merchant WhatsApp, support ingest, store/order flows |
| Outgoing webhooks | `order.*`, `shipment.*`, `label.generated`, `manifest.generated`, `tracking.updated` |

`INTEGRATION_ENCRYPTION_KEY` is required in production. Secrets never appear in API responses.

### 6.10 WhatsApp commerce and support

- Customer order links and WhatsApp order forms (public tokenized routes).
- Storefront: products, quote, events, policies.
- Support Center: tickets (open → closed/reopened), priorities, categories, assignment, templates, notes, ingest from WhatsApp.
- AI credits (OpenRouter) for assisted replies / parsing; billed separately from plan quota via Razorpay classification on `payment.captured`.

### 6.11 Billing and trial

- Catalog plans (Starter / Growth / Pro / Business / Enterprise as codes; live catalog is Super Admin–managed).
- Monthly or yearly (yearly is 20% off monthly list). Amounts in integer paise.
- Checkout: Razorpay **Orders** (one-time payment for the period); `payment.captured` activates by `order_id`.
- Trial: default messaging is 3-day full-feature trial, one per email or WhatsApp; Super Admin can change `trial_enabled` / `trial_days`.
- Merchant billing UI: `/dashboard/billing`. Postage is **not** included.

**Acceptance**

- Duplicate Razorpay `event_id` is stored once and not re-applied.
- Unmatched `payment.captured` is `ignored` (no credits, no subscription).
- Encrypted Razorpay columns on `platform_settings` are not granted to `anon` / `authenticated`.

### 6.12 Super Admin

Overview, accounts (activate/block/suspend/hold/disable/delete/change-plan/extend/trial/reset-usage), subscriptions, payments, plans (archive never delete if subscribers), revenue, usage, audit logs (read-only), Razorpay settings/test/webhook, trial settings, tutorials, AI credits.

### 6.13 Print agent

Runs on the packing PC. Lists local printers, claims jobs, silent-prints A6 India Post PDFs. The VPS never sees USB printers.

---

## 7. Background jobs

`JOB_RUNNER=database` (default): scheduled `POST /api/cron/jobs` with `CRON_SECRET`.  
`JOB_RUNNER=redis`: BullMQ workers (`npm run workers`).

Job types include Shopify sync, shipment booking, labels, manifests, tracking, webhook processing, India Post events, notifications, cleanup, reports, Shopify fulfillment, Wati/VaChat notify, invoices, support ingest.

**Health:** `GET /api/health` warns when jobs stay due > 10 minutes.

---

## 8. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Security | RLS on tenant tables; service-role only on server; webhook HMAC; rate limits on OTP/auth; no secrets in client or git |
| Tenancy | All commerce queries filter `organization_id` |
| Reliability | Booking locks, bulk crash recovery, job claim timeout (~15 min) |
| Observability | Sentry, structured logs, PostHog |
| Locale | India: `en-IN`, INR, Asia/Kolkata for “today” metrics |
| PDF | Official labels unmodified for print; custom labels must fit A6/presets |
| Deploy | Coolify/Docker; apply `supabase/migrations/` before API that needs them |

---

## 9. Success metrics

- Time from imported Shopify order to booked article number
- Booking success rate vs CEPT errors
- % of booked shipments with a printable label
- Tracking freshness (last_tracked_at vs last CEPT event)
- NDR identified vs uncategorized in-transit
- Trial → paid conversion; quota utilization without overcount on failed books
- Support first-response time in Support Center

---

## 10. Open / in-flight items

| Item | Status in product |
| --- | --- |
| NDR & RTO dashboard | Shipped as observational module |
| WhatsApp OTP login | Planned; coexist with password; flag off until AUTH template + duplicate cleanup |
| WooCommerce | Order source + marketing lander; treat plugin completeness as a separate release track |
| Merchant Razorpay checkout on WhatsApp store | Must not reuse Domain A platform webhook/keys |

---

## 11. Traceability (code)

| Area | Primary locations |
| --- | --- |
| Domain types | `types/domain.ts` |
| Tenant commerce API | `lib/api/v1/commerce.ts`, `lib/api/v1-permissions.ts` |
| India Post | `modules/india-post/` |
| NDR/RTO | `modules/ndr-rto/` |
| Orders | `modules/orders/` |
| Labels | `modules/labels/` |
| Billing | `modules/billing/`, `modules/razorpay/` |
| Shopify | `modules/shopify/` |
| Support | `modules/support/` |
| Schema | `supabase/migrations/` |
| Nav | `lib/dashboard/nav.ts` |

---

## 12. Glossary

| Term | Meaning |
| --- | --- |
| CEPT | India Post booking/tracking APIs used with a Customer ID |
| Article | Booked consignment / tracking number |
| Workspace | `organizations` row; tenant boundary |
| Domain A | PostBus platform Razorpay (plans, AI credits) |
| NDR | Non-delivery (failed attempt) |
| RTO | Return to origin |
| Print agent | Local process that prints labels the cloud generated |
