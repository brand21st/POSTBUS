# PostBus affiliate architecture

The affiliate program is a module inside the existing Next.js app. It is not a separate service.

## Boundaries

| Domain | Owner | Affiliate access |
| --- | --- | --- |
| Merchant organization | `organizations`, `organization_members` | One attribution row, no membership rewrite |
| Platform subscription billing | `subscriptions`, `payments`, Razorpay webhooks | Read verified payments, never create them |
| Affiliate identity and payouts | `affiliate_*` tables | Isolated ledger |
| India Post shipping | shipments, tracking, labels | None |
| Merchant storefront payments | store Razorpay flows | None |

## Modules

Mapped onto the current files:

- Identity and application: `affiliate_profiles`, `handlePartnerApi` path `application`.
- Links: `affiliate_links`, created on approval and by the partner campaign endpoint.
- Attribution: `modules/affiliates/cookie.ts`, `app/api/affiliate-referral/route.ts`, `affiliate_bind_signup`, `affiliate_create_organization`.
- Conversion: `modules/affiliates/reconcile.ts` and `affiliate_payment_evidence`.
- Commission engine: `affiliate_accrue` and `modules/affiliates/policy.ts`.
- Ledger: `affiliate_ledger_entries`, `affiliate_balance`.
- Payouts: `affiliate_request_payout`, `affiliate_settle_payout`.
- Analytics: `affiliate_summary`, `affiliate_partner_records`, `affiliate_admin_overview`.
- Notifications: `affiliate_notifications` rows written by status and payout RPCs. They reuse the database, not a new provider.
- Administration: `handleAffiliateAdmin` and `affiliate_admin_action`.

## Runtime flow

```mermaid
flowchart TD
  visit["GET /?ref=code"] --> proxy["proxy.ts flag check"]
  proxy --> click["affiliate-referral route"]
  click --> cookie["Signed pb_referral cookie"]
  cookie --> signup["Register or WhatsApp OTP"]
  signup --> claim["affiliate_bind_signup"]
  claim --> org["affiliate_create_organization"]
  org --> attr["affiliate_attributions unique org"]
  pay["Signed Razorpay webhook"] --> payment["Existing payments row"]
  payment --> cron["Billing cron sweep"]
  cron --> accrue["affiliate_accrue"]
  accrue --> ledger["Append-only ledger"]
  ledger --> payout["Manual payout RPC"]
```

When `POSTBUS_AFFILIATES_ENABLED` is not `true`, the proxy does not rewrite `/`, signup bind returns immediately, and organization creation keeps calling `create_organization_for_user`.

When accrual is off, the cron calls `runAffiliateSweep` and that function returns before any Razorpay fetch.

## Money rules

All stored amounts are integer paise. JavaScript helpers use `bigint`. SQL uses `bigint` and half-up integer division. Policy selection is the most specific row effective at capture time: link, then partner, then platform default. The chosen row is copied into `affiliate_commissions.policy_snapshot`.

Idempotency keys:

- Accrual: `accrual:<payment uuid>`
- Approval: `approval:<payment uuid>`
- Reversal: `refund:<payment uuid>:<refunded paise>`
- Reservation: `reserve:<payout uuid>`
- Payout or release: `PAID:<payout uuid>` or `REJECTED:<payout uuid>`
- Adjustment: `adjust:<client uuid>`

`affiliate_commissions.payment_id` is unique. `affiliate_ledger_entries.idempotency_key` is unique. `affiliate_payout_requests.idempotency_key` is unique.

## Processing

`affiliate_claim_payments` inserts a queue row per attributed subscription payment and claims due rows with `FOR UPDATE SKIP LOCKED`, at most 50 and normally 20. A claim sets the next attempt 10 minutes ahead. The sweep stores statuses such as `INELIGIBLE`, `CAPTURE_REVIEW`, `TAX_REVIEW`, `HOLD`, and `RECONCILED`.

Webhook processing, when the affiliate flag is on, uses `claim_razorpay_webhook`. A live lease of 15 minutes returns busy. A processed or ignored event returns complete. This does not re-run a completed billing update.

## Authorization

Partner reads of links, attributions, commissions, payouts, ledger, and notifications are RLS policies on `auth.uid()`. Writes go through service-role RPCs that take the partner id from the session profile, not from the request body.

Admin RPCs check `platform_admins`. The HTTP layer also checks the admin action PIN and strips it before the SQL payload is stored.

## What this architecture refuses

- A second subscription engine.
- Commission from a frontend success page.
- Last-touch overwrite of an existing organization attribution.
- Automatic payouts through RazorpayX.
- Sharing the affiliate ledger with shipment or storefront money.
