# PostBus Phase 2.7 billing audit

Local inspection of the existing subscription billing path. No production system was changed.

| Component | Classification | Evidence |
| --- | --- | --- |
| Plan catalog and checkout amount | COMPLETE | `plans.monthly_price_paise` / `yearly_price_paise`. `amountForCycle` returns the stored integer. `startCheckout` uses that amount. |
| Payment receipt invoices | COMPLETE | Existing `invoices` rows still store the payment amount. They were not replaced. |
| GST-inclusive splitter and approved tax policy | COMPLETE | Phase 2.6 `subscription_tax_policies`, `subscription_tax_breakdowns`, `subscription_apply_approved_tax`. No default rate. |
| Affiliate tax evidence and 20% accrual | COMPLETE | Existing `affiliate_tax_evidence`, `affiliate_accrue`, and the financial ledger. Not rebuilt. |
| Subscription GST tax invoice | PARTIAL | Local draft, numbering, issuance gate, PDF, and read-only reconcile exist. Issuance stays off. |
| Merchant tax-invoice history | PARTIAL | Billing page can save a future billing profile and download a preview PDF. No search or pagination on the new invoice list. |
| Super Admin tax invoices | PARTIAL | `/admin/invoices` lists issued rows, saves supplier settings with the action PIN, and runs read-only reconcile. No date filters. |
| Credit notes and debit notes | NOT STARTED | Refunds stay on the existing ledger. An issued invoice is immutable. A legally operative adjustment workflow is blocked pending tax approval. |
| Staging database | BLOCKED | No approved staging project ref. Remote SQL was not run. |
| Production affiliate and tax migrations | NOT STARTED | The six earlier affiliate/tax files and `20261017140000_subscription_tax_invoices.sql` were not applied remotely. |

## Preserved systems

Checkout, Razorpay verification, the payment receipt, the affiliate ledger, and India Post shipping were left in place. AI-credit purchases, storefront payments, and India Post charges remain outside subscription tax invoices.

## Environment

| | |
| --- | --- |
| Implemented locally | Yes |
| Verified locally | Pricing source, tax gate, and invoice SQL tests |
| Verified on staging | No |
| Deployed to production | No |
