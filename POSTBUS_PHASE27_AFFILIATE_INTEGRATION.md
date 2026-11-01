# PostBus Phase 2.7 affiliate integration

Status: COMPLETE for the Phase 2.6 engine. Invoice linkage is PARTIAL. No flag was turned on.

## Preserved flow

Verified subscription payment, then an approved tax policy, then `subscription_tax_breakdowns`, then `affiliate_tax_evidence`, then `affiliate_accrue`, then the existing financial ledger.

`subscription_apply_approved_tax` still runs only when `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` is `true`. A missing approved policy returns `MISSING_CONFIGURATION`. Missing evidence stays `TAX_REVIEW`. A conflicting evidence row stays `CONFLICT`. The engine does not insert `tax_paise = 0` to skip review, and it does not overwrite manual evidence.

## Commission rules left in place

20% of eligible net subscription revenue excluding GST. 30-day first-touch attribution. 30-day hold. ₹1,000 minimum payout. A repeated payment or webhook does not create a second accrual. AI credits, storefront payments, and India Post charges stay excluded.

The 18% example (₹1,499 gross, taxable ₹1,270.34, GST ₹228.66, commission ₹254.07) remains a test fixture. It is not an active rate.

## Invoice link

`subscription_invoice_reconcile` reads `affiliate_tax_evidence` and `affiliate_payment_evidence`. It returns `MISSING_TAX_EVIDENCE` when the evidence row is absent or the tax amount differs, and `REFUND_REVIEW` when refunded paise is already recorded. It does not accrue, reverse, or pay.

Refunds after accrual continue to use the existing affiliate reversal. No new ledger was created.
