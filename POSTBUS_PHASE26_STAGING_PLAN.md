# PostBus Phase 2.6 staging plan

Do not run this until `scripts/affiliate-staging-gate.mts` exits 0 for a named staging project and a person approves that project in the same request.

## Order

Apply the five affiliate files listed in `POSTBUS_AFFILIATE_STAGING_MIGRATION_PLAN.md`, then:

6. `supabase/migrations/20261017130000_subscription_tax_policy.sql`

This file adds tax policy and breakdown tables. It does not update plan prices or payment amounts.

## Staging checks after approval

1. Leave `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` and the affiliate accrual flag unset. Capture a test-mode subscription payment. Confirm commission count stays 0.
2. Propose and approve one staging tax policy with a rate the tax advisor has confirmed for that test. Do not copy a production guess.
3. Turn tax automation on only in staging. Apply it to that test payment. Confirm one breakdown, one tax-evidence row, and one commission.
4. Replay the webhook. Confirm the commission count stays 1.
5. Keep payouts off. Do not send customer email, WhatsApp, or India Post bookings from staging.

PGlite already applies this file after the affiliate program migration. That does not prove hosted Supabase RLS.

The previous staging gate result remains `staging_not_approved`. This session did not run the gate against a remote database.
