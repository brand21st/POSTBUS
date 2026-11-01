# PostBus affiliate Phase 2 reconciliation

`affiliate_reconciliation_report` is a stable SQL function. It only selects. Calling it does not insert commissions, tax rows, or ledger entries. The PGlite test records the commission count before and after the call and expects the same count.

It considers payments that already have an `affiliate_attributions` row for the same organization. Unattributed merchants are outside the report.

## Categories

| Category | Meaning |
| --- | --- |
| PAYMENT_UNVERIFIED | Attributed payment has no capture evidence |
| MISSING_TAX_EVIDENCE | Capture evidence exists and the matching tax row does not |
| MISSING_COMMISSION | Tax evidence exists and accrue has not inserted the commission yet |
| OWNERSHIP_MISMATCH | No subscription, subscription organization mismatch, or `ai_credits` |
| REFUND_REVIEW | Evidence shows a refund and the commission has no reversal row |
| LEDGER_MISMATCH | Accrual ledger amount differs from the commission amount |
| MATCHED | Commission exists and none of the review conditions apply |

`DUPLICATE_ATTEMPT` and `MANUAL_REVIEW_REQUIRED` are not separate labels. Duplicate processing is prevented by unique keys, and anything that is not `MATCHED` is already a review row. The admin screen section `reconciliation` still lists `affiliate_processing` statuses such as `TAX_REVIEW` and `CAPTURE_REVIEW`. The new `report` section lists the categories above.

## Repair

This phase does not add an automatic backfill. The existing admin tax action inserts `affiliate_tax_evidence` and sets `affiliate_processing.next_attempt_at` so the sweep can accrue later. That action still requires the admin PIN, a platform admin, and a reason. It is not run by the report.

Do not run the report, the sweep, or a tax backfill against production until a separate approval.
