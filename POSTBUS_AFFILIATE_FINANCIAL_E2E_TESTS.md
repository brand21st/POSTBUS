# PostBus affiliate financial end-to-end tests

Local run on 17 October 2026. No Razorpay live call. No remote SQL.

Command:

`npx vitest run modules/affiliates/policy.test.ts modules/affiliates/api.test.ts modules/affiliates/reconcile.test.ts modules/affiliates/ledger.pg.test.ts app/api/affiliate-referral/route.test.ts modules/billing/webhooks.test.ts`

6 files, 73 tests, all passed.

`npx tsc --noEmit --pretty false` exited 0.

`npx tsx scripts/affiliate-staging-gate.mts` exited 1 with `staging_not_approved`.

## Covered

| Check | Where |
| --- | --- |
| Captured total without a tax row is `MISSING` | `policy.test.ts` |
| Tax equal to the capture is `CONFLICT` and the sweep does not accrue | `policy.test.ts`, `reconcile.test.ts` |
| Explicit zero-tax row is `VERIFIED` | `policy.test.ts` |
| Missing tax leaves commission count at 0 and the report says `MISSING_TAX_EVIDENCE` | `ledger.pg.test.ts` |
| After tax, one commission, report `MATCHED` | `ledger.pg.test.ts` |
| Yearly capture 2,000,000 paise at 20 percent accrues 400,000 paise | `ledger.pg.test.ts` |
| Second accrue and second webhook lease do not duplicate | `ledger.pg.test.ts` |
| Renewal payment accrues a second row | `ledger.pg.test.ts` |
| Hold returns available 0 | `ledger.pg.test.ts` |
| Refund after payout increases recoverable balance | `ledger.pg.test.ts` |
| AI credits and a payment with no subscription are `INELIGIBLE` | `ledger.pg.test.ts` |
| Other affiliate cannot read commissions under RLS | `ledger.pg.test.ts` |
| Non-admin cannot run `affiliate_admin_action` | `ledger.pg.test.ts` |
| Staging target without an approved ref is rejected | `policy.test.ts` and the gate script |
| Billing webhook idempotency | `modules/billing/webhooks.test.ts`, 11 tests |

## Not claimed

Two concurrent database sessions were not opened. Uniqueness of `affiliate_commissions.payment_id` is the database guard; the test calls accrue twice in one session.

Remote staging and production were not part of this run.
