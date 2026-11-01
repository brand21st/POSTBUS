# PostBus affiliate security plan

This plan covers the local affiliate module. It does not change production controls until a later approved release.

## Trust boundaries

- The browser may send `?ref=` and cookies. It may not choose the partner id, the commission rate, or a payment amount.
- Partner HTTP handlers derive `affiliate_id` from `affiliate_profiles.user_id = session user`.
- Admin HTTP handlers run only after the existing platform-admin gate. SQL rejects a caller who is not in `platform_admins`.
- The service-role key stays in server environment variables. Partner and admin pages call same-origin APIs.
- Razorpay webhook bodies are accepted only after `verifyWebhookSignature`.

## Referral cookie

`modules/affiliates/cookie.ts`:

- Secret `POSTBUS_AFFILIATE_COOKIE_SECRET`, minimum 32 characters. Missing secret throws before a cookie is issued.
- Payload is base64url JSON plus an HMAC-SHA256 signature. Comparison uses `timingSafeEqual`.
- `readReferral` rejects extra segments, oversized values, bad UUIDs, bad visitor ids, and expired timestamps.
- The referral route sets `HttpOnly`, `SameSite=Lax`, `Secure` when the request is https, and `Path=/`.
- Max age follows `affiliate_settings.attribution_days`.

A client-supplied affiliate id without this cookie is ignored. `bindSignupReferral` reads only the signed cookie.

## Click and signup abuse

- Public codes must match `^[a-zA-Z0-9_-]{24}$`.
- Click route rate limit: 30 requests per minute per forwarded IP. The IP is not written to `affiliate_click_events`.
- `affiliate_record_click` ignores non 32-hex visitor ids, disabled links, and non-approved partners. The same visitor and link inside one minute inserts nothing.
- `affiliate_bind_signup` returns without writing a claim when the user is older than 10 minutes, already has an organization membership, or the link is not an enabled link of a different approved partner.
- `affiliate_create_organization` takes an advisory lock on the user id, returns the existing organization if the user is already a member, and inserts an attribution only for an unexpired claim whose partner is not the same user.
- A second organization create does not insert a second attribution because `organization_id` is unique and the function returns the existing org.
- Admin reassignment checks that the target partner is not a member of the attributed organization.

Shared IP addresses do not auto-reject a referral.

## Financial integrity

- Commission insert is unique on `payments.id`.
- Ledger idempotency keys are unique. Repeated accrue calls do not double-insert accrual or approval.
- Refund reversal amount is cumulative. A later call inserts only the delta.
- Historical policy rows are immutable. A new rate is a new `affiliate_policies` row. Accrue keeps the original commission amount.
- Payout reservation locks the partner row. Two concurrent requests cannot both pass the balance check for the same funds because the second waits on the row lock and then sees the reservation.
- A payout idempotency key reused with a different amount or account raises `Idempotency conflict`.
- Settlement of an already paid payout with a different reference raises `Payout already finalized`.
- `affiliate_immutable` blocks update and delete on commissions, ledger rows, evidence, policies, attributions, audit logs, payout accounts, and allocations, including for the table owner.
- Negative available balance is reported as `recoverable` and blocks new `APPROVED` or `PAID` settlement.

## Secrets and privacy

- UPI details are encrypted with `encryptSecret` before insert. Partner responses return `masked_details` only.
- Admin destination view decrypts one account and writes `payout.destination_viewed` before returning the value.
- Partner referral labels are `Merchant` plus eight characters of the attribution id.
- Database errors thrown through `checked` use a fixed message and do not return provider text.
- Click retention is 366 days. Financial rows are not pruned by that job.
- Application JSON can contain a mobile number. It is not selected by the public referral route.

## Admin actions

`handleAffiliateAdmin` requires `ADMIN_ACCOUNT_ACTION_PIN` to be configured, checks the PIN, and stores `p_data` without the PIN. Same-origin is required for mutations. Rate limit is 90 requests per minute per admin actor. Partner rate limit is 60 per minute per user.

Status changes, policy inserts, tax evidence, adjustments, link toggles, and settings updates all require a reason of at least 3 characters inside `affiliate_admin_action`.

## RLS

Authenticated users can read their own profile and their own partner financial projections. They cannot update `affiliate_profiles.status`. They cannot execute payout RPCs. They cannot select `encrypted_details`. Cross-partner commission counts are zero under a different `request.jwt.claim.sub`. This is covered by `ledger.pg.test.ts`.

Anon has no grants on affiliate tables.

## Flag safety

All three flags default off. `accrualEnabled` and `payoutsEnabled` also require the master flag. Disabled partner routes return before auth and before the admin client is constructed.

## Residual risks to accept in writing before go-live

- Tax evidence is entered by a super admin. A mistaken zero-tax row treats the full capture as eligible net. The audit log is the control. There is no automatic GST calculation because `payments` has no tax column.
- The webhook lease migration alters a production billing table. Ship it only in an affiliate release, with the master flag off until staging proves the existing duplicate-event behavior.
- Encrypted UPI is reversible by anyone who has `INTEGRATION_ENCRYPTION_KEY` and the service role. That is acceptable for phase-1 manual payouts and is not a bank-token vault.
- RazorpayX automatic payouts are not authorized.
