# PostBus affiliate audit

Status: review document only. No migration has been applied and no production deploy is authorized by this file.

Labels used below: EXISTING, MISSING, NEEDS MODIFICATION, PROPOSED.

## 1. Existing architecture

EXISTING production stack:

- Next.js 16.3.8 App Router, React 19, TypeScript, Tailwind CSS 4.
- Request gate is `proxy.ts`. There is no classic `middleware.ts`.
- Supabase Auth through `@supabase/ssr`, plus WhatsApp OTP in `lib/auth/otp`.
- Merchant identity: `profiles`, `organizations`, `organization_members`.
- Platform administration: `platform_admins`, UI under `/admin`.
- Billing: Razorpay subscriptions and one-time captures in `modules/billing` and `modules/razorpay`.
- Jobs: BullMQ workers and the existing billing cron at `app/api/cron/billing/route.ts`.
- India Post booking, tracking, and shipments are a separate domain and are out of scope.

EXISTING local draft, uncommitted and not on the release branch:

- `modules/affiliates` (cookie, policy, service, API, reconcile) and Vitest/PGlite tests.
- SQL files `supabase/migrations/20261017120000_affiliate_program.sql` through `20261017123000_affiliate_reporting.sql`.
- Partner routes `/partner/*` and `/api/partner/*`.
- Admin page `app/(admin)/admin/affiliates/page.tsx` and nav item in `lib/admin/nav.ts`.
- Feature flags default off: `POSTBUS_AFFILIATES_ENABLED`, `POSTBUS_AFFILIATE_ACCRUAL_ENABLED`, `POSTBUS_AFFILIATE_PAYOUTS_ENABLED`.

PROPOSED: finish and test this draft. Do not build a second affiliate stack.

## 2. Relevant database tables

EXISTING billing and identity:

- `organizations`, `organization_members`, `profiles`, `platform_admins`.
- `plans`, `subscriptions`, `subscription_items`, `subscription_history`.
- `payments` (`amount_paise`, statuses `PENDING | CAPTURED | FAILED | REFUNDED`).
- Unique index `payments_razorpay_payment_id_uidx` where `razorpay_payment_id` is not null.
- `razorpay_webhook_events` with unique `event_id`.
- `billing_audit_logs`, `billing_usage`, `razorpay_customers`, `trial_claims`.

Payments are mutable. `refund.processed` updates `status` and `refunded_at` on the same row. Commission history must not depend on rewriting that row.

PROPOSED affiliate tables, present only in the unapplied local SQL:

- `affiliate_settings`, `affiliate_profiles`, `affiliate_links`, `affiliate_click_events`.
- `affiliate_signup_claims`, `affiliate_attributions`, `affiliate_attribution_corrections`.
- `affiliate_policies`, `affiliate_payment_evidence`, `affiliate_tax_evidence`.
- `affiliate_commissions`, `affiliate_ledger_entries`, `affiliate_payout_allocations`.
- `affiliate_payout_accounts`, `affiliate_payout_requests`, `affiliate_audit_logs`.
- `affiliate_notifications`, `affiliate_processing`.
- View `affiliate_conversions`.

NEEDS MODIFICATION when the flag is later enabled: `razorpay_webhook_events` gains `processing_lease` and `processing_until` from `20261017122000_affiliate_webhook_leases.sql`. That change is inert until the affiliate flag is on, but it must not ship inside an unrelated India Post release.

## 3. Relevant API routes

EXISTING:

- `POST /api/webhooks/razorpay` verifies `x-razorpay-signature`, stores the event, then calls `processRazorpayEvent`.
- `POST /api/v1/auth/register` and WhatsApp OTP signup create the auth user.
- Organization creation goes through `modules/organizations/service.ts` and `create_organization_for_user`.
- Admin API is `lib/api/admin/handle.ts`, gated by platform admin.
- Billing cron is `app/api/cron/billing/route.ts`.

LOCAL draft routes, active only when `POSTBUS_AFFILIATES_ENABLED=true`:

- `GET /api/affiliate-referral` validates a 24-character code, records a click, sets signed cookie `pb_referral`.
- `proxy.ts` rewrites `/?ref=` to that route only when the flag is on.
- `/api/partner/[...slugs]` is the partner API.
- `/api/partner/qr` returns a QR image for an enabled link owned by the signed-in partner.
- Admin section `affiliates` calls `handleAffiliateAdmin`.

NEEDS MODIFICATION already present in the working tree, and must stay flag-gated:

- Register and OTP signup call `bindSignupReferral`.
- `modules/organizations/service.ts` calls `affiliate_create_organization` instead of `create_organization_for_user` when the flag is on.
- The webhook route uses `claim_razorpay_webhook` when the flag is on.
- The billing cron calls `runAffiliateSweep`, which returns immediately unless accrual is also enabled.

## 4. Authentication flow

EXISTING: Supabase Auth owns passwords and sessions. The app does not store password hashes. WhatsApp OTP can also create a user. `platform_admins.user_id` is the super-admin allow list. Merchant roles live on `organization_members`.

LOCAL draft: an affiliate is `affiliate_profiles.user_id`, unique, referencing `auth.users`. The same user may also be a merchant member. Partner APIs require `getRequestAuthUser`. Admin mutations require `platform_admins` inside SQL and the existing admin action PIN in the API. There is no custom password store.

## 5. Billing lifecycle

EXISTING subscription statuses: `TRIAL`, `ACTIVE`, `PAST_DUE`, `CANCELLED`, `EXPIRED`, `PAUSED`, `PAYMENT_FAILED`.

EXISTING verified payment path:

1. Razorpay signs the webhook.
2. The event id is inserted once.
3. `payment.captured` and `subscription.charged` update the subscription when the amount matches.
4. A following `invoice.paid` does not extend the period again.
5. `refund.processed` marks the payment `REFUNDED`.
6. Failed or pending payments do not become `CAPTURED`.
7. AI credit purchases use billing cycle `ai_credits` and are not subscription revenue.

LOCAL draft accrual, only if `POSTBUS_AFFILIATE_ACCRUAL_ENABLED=true`:

1. The cron claims attributed subscription payments.
2. It re-fetches the Razorpay payment and requires a captured, amount-matched payment.
3. `affiliate_capture_time` requires a signed webhook inbox row.
4. `affiliate_accrue` refuses to create a commission until an admin has stored tax evidence.
5. One commission row per `payments.id`. Renewals are new payment rows and can accrue again.
6. Refunds append `REVERSAL` ledger rows. They do not edit the commission.

MISSING: GST is not a column on `payments`. Eligible net cannot be known until a super admin records `affiliate_tax_evidence`. Accrual must stay off until that operating procedure is accepted.

## 6. Existing reusable components

EXISTING UI: dashboard cards, tables, badges, forms, and Recharts. Sonner toasts. Admin shell and PIN.

LOCAL draft UI:

- `components/affiliates/partner-dashboard.tsx` reads `affiliate_summary` and `affiliate_partner_records`. It includes an area chart, copy link, campaign create, and payout request.
- `components/affiliates/admin-dashboard.tsx` reads `affiliate_admin_overview` and the admin lists.
- `/partner/register` posts the application schema: name, mobile, optional business, website, social, channel, country `IN`, state, city, and terms acceptance.
- `/partner/dashboard` and `/admin/affiliates` render a disabled message when the flag is off.

MISSING relative to the full product brief: a polished WhatsApp, Facebook, and LinkedIn share row, and a dedicated campaign-performance page. QR exists as an API. Do not fill dashboards with sample numbers.

## 7. Security risks

EXISTING controls to keep:

- Webhook signatures and unique event ids.
- Service-role client stays on the server.
- Admin PIN for sensitive admin mutations.
- Organization membership checks for merchant data.

LOCAL draft controls:

- HMAC-SHA256 cookie `pb_referral`, `HttpOnly` set by the referral route, 30-day default expiry from `affiliate_settings.attribution_days`.
- Link codes are 24-character opaque strings, not table UUIDs in the public URL.
- Click visitor id is a random 32-hex value. IP addresses are not stored. Repeat clicks inside one minute are dropped.
- Signup bind no-ops unless the auth user was created in the last 10 minutes and has no organization membership.
- `affiliate_create_organization` refuses a link whose partner user is the signing-up user.
- Admin correction SQL raises `Self referral` when the new partner is a member of the attributed organization.
- RLS is enabled. `anon` has no grants. Authenticated users can select only their own partner rows. Financial writes are service-role RPCs.
- Payout UPI is encrypted with `INTEGRATION_ENCRYPTION_KEY`. The partner API returns only a mask.
- Partner list RPCs return `Merchant` plus eight characters of the attribution id, not the organization name or Razorpay id.

NEEDS MODIFICATION before production:

- Cookie secret `POSTBUS_AFFILIATE_COOKIE_SECRET` must be at least 32 characters and must not be committed.
- The webhook lease path changes duplicate handling when the affiliate flag is on. Roll back by turning the flag off only after confirming in-flight leases are finished. Prefer not to deploy the route change until that flag is an intentional release.
- Tax entry is a privileged financial input. A wrong tax row blocks or mis-states commission. It needs the admin PIN and an audit row, which the draft already writes.

## 8. Required database changes

PROPOSED, not applied:

1. Apply the four local SQL files on a staging database only, in filename order.
2. Do not edit historical `payments` rows as part of that apply.
3. Confirm `create_organization_for_user` still exists and remains the path when the flag is off.
4. Confirm `platform_admins` is the only admin authority inside `affiliate_admin_action` and `affiliate_settle_payout`.

No production `supabase db push` is authorized by this audit.

## 9. Recommended architecture

Modular monolith inside the current Next.js app.

- Identity and applications: `affiliate_profiles` on `auth.users`.
- Links and clicks: `affiliate_links`, `affiliate_click_events`, signed cookie.
- Attribution: one row per organization, first touch, immutable except through `affiliate_attribution_corrections`.
- Conversion and commission: existing `payments` plus evidence, tax, policy snapshot, and one commission per payment.
- Ledger and manual payouts: append-only entries. RazorpayX is out of scope.
- Admin and partner UI: existing `/admin` and `/partner` routes.
- Processing: existing billing cron, bounded to 20 payments per run.

Do not create a separate affiliate app. Do not attach commissions to India Post shipments or to merchant storefront Razorpay payments.

## 10. Implementation dependencies

- Supabase service role on the server.
- Existing Razorpay webhook secret and payment fetch client.
- `INTEGRATION_ENCRYPTION_KEY` before any payout account can be saved.
- `POSTBUS_AFFILIATE_COOKIE_SECRET` before any referral cookie can be signed.
- `ADMIN_ACCOUNT_ACTION_PIN` before admin mutations.
- A written GST procedure before `POSTBUS_AFFILIATE_ACCRUAL_ENABLED` is turned on.

## Stop line

This audit does not approve a production migration, a Coolify deploy, or live payouts.
