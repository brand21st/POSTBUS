# PostBus affiliate database schema

Source files, unapplied:

- `supabase/migrations/20261017120000_affiliate_program.sql`
- `supabase/migrations/20261017121000_affiliate_operations.sql`
- `supabase/migrations/20261017122000_affiliate_webhook_leases.sql`
- `supabase/migrations/20261017123000_affiliate_reporting.sql`

Apply only on an authorized staging database, in that order. Production apply is a separate approval.

## Settings and identity

`affiliate_settings` is a single row (`id boolean primary key default true`). Columns: `registration_open` default true, `attribution_days` default 30 check 1 to 90, `hold_days` default 30 check 1 to 365, `minimum_payout_paise` default 100000.

`affiliate_profiles`: `user_id` unique references `auth.users`, `status` check `PENDING | APPROVED | REJECTED | SUSPENDED`, `application jsonb`, `terms_version`, `rejection_reason`.

`affiliate_links`: `code` unique, `campaign` default empty, `enabled` default true, unique `(affiliate_id, campaign)`.

## Tracking and attribution

`affiliate_click_events`: partner, link, 32-hex `visitor`, `created_at`. Indexes on `(affiliate_id, created_at)` and `(link_id, visitor, created_at)`. No IP column. `affiliate_prune_visits` deletes clicks older than 366 days.

`affiliate_signup_claims`: primary key `user_id`, one link, `expires_at`.

`affiliate_attributions`: `organization_id` unique references `organizations`, plus partner, link, and `policy_version` default `first-touch-v1`.

`affiliate_attribution_corrections`: append-only replacement partner and link, actor, reason. The original attribution row is not updated. Trigger `affiliate_immutable` blocks update and delete.

## Policy, evidence, commission

`affiliate_policies`: nullable partner and link, identity `version`, `basis_points` default 2000 check 0 to 10000, optional `fixed_paise`, `effective_at`. A link-level row must also name a partner. The seed row is the platform 20 percent policy.

`affiliate_payment_evidence`: one logical capture per payment and refunded-paise level. Unique `(payment_id, refunded_paise)`. Amounts must be positive and refunded paise cannot exceed amount.

`affiliate_tax_evidence`: unique `(payment_id, refunded_paise)`, tax paise, refunded tax paise, reason, actor. Required before `affiliate_accrue` will insert a commission.

`affiliate_commissions`: `payment_id` unique, `policy_id`, `policy_snapshot jsonb`, `net_paise`, `amount_paise`, `available_at`. Immutable after insert.

## Ledger and payouts

`affiliate_ledger_entries.kind` check: `ACCRUAL`, `APPROVAL`, `REVERSAL`, `ADJUSTMENT`, `RESERVATION`, `RELEASE`, `PAYOUT`, `PAYOUT_RETURN`. `idempotency_key` unique. Amount is signed bigint paise. Immutable.

`affiliate_balance` sums approvals, adjustments, reservations, releases, and payout returns, and counts reversals only after an approval exists. `available` is `greatest(sum, 0)`. `recoverable` is the absolute value when the sum is negative. `paid` is the negation of `PAYOUT` and `PAYOUT_RETURN` amounts.

`affiliate_payout_accounts`: `encrypted_details`, `masked_details`. Immutable so a replaced account is a new row.

`affiliate_payout_requests.status` check: `REQUESTED`, `APPROVED`, `PAID`, `REJECTED`, `REVIEW`, `RETURNED`. Unique `idempotency_key`. Unique `settlement_reference` when set.

`affiliate_payout_allocations`: unique `(payout_id, ledger_id)`, positive paise. Immutable.

`affiliate_request_payout` locks the approved profile, rejects an amount above available or below the minimum, requires a fresh reconciliation queue, inserts the request and a negative `RESERVATION`, then allocates against positive `APPROVAL` and `ADJUSTMENT` capacity. A mismatch rolls the transaction back.

## Operations and audit

`affiliate_processing`: primary key `payment_id`, status, lease, attempts, `next_attempt_at`. This table is mutable because it is a queue.

`affiliate_audit_logs` and `affiliate_notifications` are append-only for the audit table. Profile insert and application updates also write audit rows from trigger `affiliate_profile_history`.

`affiliate_admin_action` allows status, correction, policy insert, tax insert, adjustment, link enablement, and settings update. It requires a platform admin and a reason of at least 3 characters. Approval also inserts the primary link if that campaign row does not exist.

## Webhook lease

`20261017122000_affiliate_webhook_leases.sql` adds nullable `processing_lease` and `processing_until` on `razorpay_webhook_events` and creates `claim_razorpay_webhook`. Completed events stay complete. A future lease returns `busy`.

## Reporting

`affiliate_conversions` is a security-invoker view of evidence joined to payments and attributions. Grants are service role only.

`affiliate_partner_records` returns at most 25 referral or commission rows and hides organization and provider identifiers.

`affiliate_admin_overview` returns counts and paise totals as text, so clients do not parse large integers as floats.

## RLS

Every affiliate table enables RLS. `anon` and `authenticated` lose table privileges, then selected read policies are granted back:

- Own profile: `affiliate_profiles.user_id = auth.uid()`.
- Own partner rows: links, attributions, commissions, payout requests, ledger, notifications, where `affiliate_id` belongs to the current user.

Encrypted payout details are not in the authenticated select grant for accounts. The partner API selects `id, masked_details, created_at` with the service role and an `affiliate_id` filter.

RPCs used by the server are revoked from `public` and granted to `service_role`, except `affiliate_create_organization(text)`, which is granted to `authenticated` and checks `auth.uid()`.

## Existing tables reused

`auth.users`, `organizations`, `organization_members`, `subscriptions`, `payments`, `razorpay_webhook_events`, `platform_admins`.

No new shipment, tracking, or storefront payment table is introduced.
