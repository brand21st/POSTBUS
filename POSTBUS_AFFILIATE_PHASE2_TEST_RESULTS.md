# PostBus affiliate Phase 2 test results

Executed locally on 17 October 2026. No live Razorpay call. No remote database.

## Commands and results

`npx vitest run modules/affiliates/policy.test.ts modules/affiliates/api.test.ts modules/affiliates/reconcile.test.ts modules/affiliates/ledger.pg.test.ts app/api/affiliate-referral/route.test.ts`

5 files, 60 tests, all passed.

`npx vitest run modules/billing/webhooks.test.ts`

1 file, 11 tests, all passed.

`npx tsc --noEmit --pretty false`

Exit code 0.

## Scenario evidence

| Scenario | Result | Evidence |
| --- | --- | --- |
| First subscription commission | Passed | `accrues and approves exactly once` |
| Monthly renewal | Passed | second payment id accrues a second row |
| Annual renewal | Passed | `YEARLY` 2,000,000 paise accrues 400,000 paise |
| Duplicate accrue | Passed | second `affiliate_accrue` keeps one commission |
| Failed or unverified capture | Passed | `CAPTURE_REVIEW` and `PAYMENT_UNVERIFIED` |
| Unpaid trial | Passed | trial status with no evidence creates no commission |
| Missing tax evidence | Passed | report stays `MISSING_TAX_EVIDENCE` and commission count stays 0 |
| Tax then accrue | Passed | report moves to `MISSING_COMMISSION`, then `MATCHED` |
| Full and partial refund, including after payout | Passed | existing refund test, recoverable balance |
| 30-day hold | Passed | recent capture returns `HOLD` and available `0` |
| Policy snapshot | Passed | later 5000 basis points does not change stored 200000 |
| AI credits | Passed | `affiliate_accrue` returns `INELIGIBLE` |
| Non-subscription charge | Passed | null `subscription_id` returns `INELIGIBLE` and `OWNERSHIP_MISMATCH` |
| Reconciliation does not write | Passed | commission count unchanged by the report |
| Cross-affiliate RLS | Passed | existing authenticated-role test |
| Webhook lease | Passed | claim, busy, retry, complete |

## Not executed as separate cases

- Two database sessions racing the same payment. Idempotency is the unique `payment_id` and unique ledger key. The suite calls accrue twice in one session.
- A named plan-upgrade fixture. Upgrades use the captured amount rule, which the yearly amount test covers. There is no separate upgrade code path.
- A live Razorpay sandbox refund webhook. Refunds are tested by inserting a higher `refunded_paise` evidence row and calling accrue.

Those gaps are not marked passed.
