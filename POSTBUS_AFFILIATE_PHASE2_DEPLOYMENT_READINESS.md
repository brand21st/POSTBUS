# PostBus affiliate Phase 2 deployment readiness

Status: not ready for production.

## Local verification

COMPLETE for the PGlite schema, including `20261017124000_affiliate_reconciliation.sql`, and for TypeScript.

## Staging

BLOCKED. This session did not find an independently verified isolated staging database. The new SQL file was executed only inside PGlite. Do not point it at production and do not assume a database named staging is safe without checking the host and project id.

## Production blockers

- The four earlier affiliate SQL files plus `20261017124000_affiliate_reconciliation.sql` are not applied to production.
- `POSTBUS_AFFILIATES_ENABLED` and `POSTBUS_AFFILIATE_ACCRUAL_ENABLED` must stay off until an approved staging pass.
- Subscription GST is not on `payments`. Accrual stays in `TAX_REVIEW` until a super admin records `affiliate_tax_evidence`. Turning accrual on without that operating procedure creates no commissions and does not guess tax.
- Payouts stay unauthorized. `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` must remain unset.
- The webhook route's affiliate lease path must not ship inside an unrelated India Post release.

## Required approvals before any deploy

1. Apply the affiliate SQL files on a verified staging project only.
2. Confirm merchant signup and a signed test webhook still behave with the flags off.
3. Enable the master flag, then accrual, only in staging.
4. Record one staging tax-evidence row and confirm one commission.
5. Replay the test webhook and confirm the commission count stays one.
6. A separate production approval after those steps.

No payout, no production refund, and no production flag change is included in this readiness file.
