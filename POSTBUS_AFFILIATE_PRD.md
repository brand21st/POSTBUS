# PostBus affiliate PRD

The program pays partners who refer new merchants to PostBus subscriptions. It is not a merchant-to-merchant marketplace. India Post shipping and merchant storefront payments are out of scope.

## Users

- Partner: a Supabase user with an `affiliate_profiles` row.
- Referred merchant: a new organization created by a visitor who arrived through an approved link.
- Super admin: a `platform_admins` user.

A person may be both a merchant member and a partner. Those identities stay on different tables.

## Registration

Fields, matching `applicationSchema`:

- Full name, mobile, promotional channel, country fixed to India, state, city.
- Optional business name, website, and social profile.
- Explicit acceptance of terms version `2026-10-v1`.

Password storage stays in Supabase Auth. The partner application does not collect a password of its own.

Statuses: `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`.

Only `APPROVED` partners receive a primary link and can earn new commissions from new payments. Rejection stores `rejection_reason`. Duplicate applications for the same user are rejected. A repeated mobile number is flagged in `affiliate_audit_logs` as `risk.identity_overlap` and still requires admin review. It is not an automatic ban.

## Links

Public URL shape: `https://www.postbus.in/?ref=<24-character code>`.

Campaign links add `&utm_campaign=<label>` and create a second `affiliate_links` row. The public code stays unguessable. A short `PB12345` alias is not part of this release.

The partner dashboard provides the primary link, copy, QR through `/api/partner/qr`, and a campaign field. Share targets for WhatsApp, Facebook, and LinkedIn are ordinary links built from that URL. They are not a separate tracking system.

Disabling a link stops new clicks and new signup claims. It does not delete commissions already accrued.

## Attribution

Default policy id: `first-touch-v1`.

- Cookie name `pb_referral`, signed, `HttpOnly`, `SameSite=Lax`, `Secure` in production.
- Window default: 30 days, configurable from 1 to 90 on `affiliate_settings.attribution_days`.
- The cookie stores the link id and a random visitor id, not a Razorpay or organization id.
- On signup, `affiliate_bind_signup` writes `affiliate_signup_claims` only for a brand-new auth user with no organization membership, and only for an enabled link owned by a different approved partner.
- On organization create, `affiliate_create_organization` inserts one `affiliate_attributions` row. `organization_id` is unique.
- A later click by someone who already belongs to an organization does not replace that row.
- An audited correction inserts `affiliate_attribution_corrections`. Historical commission rows keep the original `affiliate_id`.

Trial start is not a paid conversion.

## Commission

Default policy: 2000 basis points, which is 20 percent of eligible net subscription revenue. A later policy row does not change commissions already stored.

Eligible net:

- Verified captured subscription payment in INR.
- Amount taken from the Razorpay payment, matched to `payments.amount_paise`.
- GST and other tax removed only through an admin `affiliate_tax_evidence` row for that payment and refund level.
- Refunded net reduces the commission through a reversal.
- Excluded: AI credit wallet purchases, payments with no subscription, payments for a different organization, unpaid and failed attempts, and anything recorded only by the browser.

Example: eligible net 149900 paise at 2000 basis points is 29980 paise. Rounding is half-up integer division, implemented as `(net * basis_points + 5000) / 10000`. Fixed-paise policies are capped at the eligible net.

Recurring: each successful renewal is a new `payments` row and can accrue once. A failed renewal accrues nothing. A cancellation with no successful charge accrues nothing.

Hold: `available_at` is capture time plus `affiliate_settings.hold_days`, default 30. Until then the ledger has `ACCRUAL` only. After the hold, a repeated reconcile inserts one `APPROVAL` row.

Statuses shown to partners by `affiliate_partner_records`: `PENDING`, `PAYABLE`, `PAID`, `REVERSED`.

## Payouts

Phase 1 is manual.

- Minimum default: 100000 paise, which is ₹1,000.
- Partner stores a UPI id. The server encrypts it and shows a mask.
- `affiliate_request_payout` locks the partner row, checks the available balance, and inserts one `RESERVATION` plus allocations.
- The same idempotency key returns the same payout. A different amount with the same key fails.
- Super admin moves the request through `APPROVED`, `REJECTED`, `REVIEW`, `PAID`, or `RETURNED`.
- `PAID` requires a settlement reference of at least 3 characters. A second paid call with the same reference is a no-op. A second paid call with a different reference fails.
- RazorpayX is not in this release.

## Dashboards

Partner overview numbers come from `affiliate_summary`: clicks, distinct visitors, signups, paid conversions, earned paise, pending paise, available balance, reserved payouts, and paid total.

Referral rows must not show organization ids, customer email, plan price, or Razorpay payment ids. The current projection uses a short attribution label and subscription status.

Admin overview comes from `affiliate_admin_overview`: partner counts, pending applications, signups, paid merchants, earned, paid, liability, and review queue size.

Every approve, reject, suspend, policy change, tax entry, adjustment, link disable, settings change, and payout decision stores `affiliate_audit_logs` with a reason.

## Non-goals

- Commissions on India Post booking fees.
- Commissions on merchant storefront Razorpay payments.
- Automatic bank payouts.
- Paying a commission because a trial started.
- Rewriting a historical commission when the default rate changes.
