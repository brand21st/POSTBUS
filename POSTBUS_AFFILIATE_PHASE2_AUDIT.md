# PostBus affiliate Phase 2 audit

No production migration and no deploy.

## Tax-evidence root cause

`payments` stores the captured Razorpay amount in `amount_paise`. It has no GST, tax, or net column. `modules/billing` does not calculate subscription tax. Shipment invoices have `tax_amount`, and that table is for merchant orders, not platform subscription GST.

`affiliate_accrue` therefore refuses to insert a commission until `affiliate_tax_evidence` exists for the same payment and refunded-paise level. Without that row it returns `TAX_REVIEW` and leaves the commission count at zero. That is intentional. The approved PRD defines eligible net as the captured amount minus tax entered by a super admin. Guessing 18 percent GST would invent net revenue.

Missing evidence does not delete attribution. The organization attribution row stays. `affiliate_reconciliation_report` labels the payment `MISSING_TAX_EVIDENCE`. After an admin tax row is stored, the same payment can accrue once.

## Component status

| Component | Status |
| --- | --- |
| Signed webhook verification | COMPLETE in existing billing route |
| Payment amount stored in paise | COMPLETE |
| Capture evidence from Razorpay plus signed inbox | COMPLETE in `runAffiliateSweep` |
| Accrual, hold, reversal, ledger idempotency | COMPLETE in `affiliate_accrue` |
| Automatic GST from billing rows | NOT STARTED. Source data does not exist. |
| Read-only reconciliation categories | COMPLETE in `affiliate_reconciliation_report` |
| Partner reversed total | COMPLETE on `affiliate_summary.reversed` |
| Real payouts | NOT STARTED |
| Remote staging SQL | BLOCKED. No verified isolated staging connection. |

## Payment mapping

Eligible input: `payments` row with `subscription_id`, organization matching `subscriptions.organization_id`, `currency = INR`, `billing_cycle` not `ai_credits`, Razorpay payment id, and `affiliate_payment_evidence` whose amount matches the payment.

Excluded: null subscription (shipping and other non-subscription charges), `ai_credits`, currency other than INR, failed or unverified captures, and payments whose capture time is before attribution.

Plan upgrades and downgrades are not a separate commission type. The eligible gross is the verified captured amount of that payment, then tax is removed, then the snapshotted policy is applied.
