# PostBus Standardized PRD

See also `docs/POSTBUS_PRD.md` for the product document.

## Product

PostBus is India Post shipping management software for Indian ecommerce merchants. Merchants connect an existing India Post Customer ID and manage orders, bookings, labels, manifests, tracking, NDR/RTO, invoices, WhatsApp, and billing from one workspace.

Website: https://www.postbus.in

## Tech stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4
- Supabase Auth, Postgres, Storage, RLS
- Zod, TanStack Query, pdf-lib
- Razorpay for platform billing
- Background jobs: Postgres drain (default) or Redis + BullMQ
- Local print-agent for packing-PC printers

## User roles

- Merchant: OWNER, ADMIN, MANAGER, OPERATOR, VIEWER
- End customer: track pages, order links, WhatsApp store
- Super Admin: /admin platform operations

## Core features

1. Auth (email/password) and workspace tenancy
2. Orders (Shopify, Manual, API, WooCommerce, WhatsApp)
3. Inventory / products / storefront
4. India Post CEPT booking (Speed Post Parcel, Business Parcel) including bulk Excel
5. Labels (official + custom), invoices, manifests
6. Tracking sync + public tracking pages
7. NDR & RTO operational dashboard (read-only vs CEPT)
8. Automation toggles including auto print
9. Integrations: Shopify, India Post, Wati, VaChat
10. Support Center
11. Billing/trial via Razorpay; quota on successful booking only
12. Super Admin catalog and account lifecycle

## Constraints

- Postage is billed by India Post, not PostBus
- CEPT has no NDR action APIs
- Platform Razorpay must not be reused for merchant store checkout
- Secrets encrypted; RLS tenant isolation
