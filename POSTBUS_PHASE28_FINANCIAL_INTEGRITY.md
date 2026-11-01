# PostBus Phase 2.8 financial integrity

Status: VERIFIED LOCALLY for the existing engines. No payout, refund, or live payment was executed.

GST-inclusive prices remain the payable amount. `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` and `POSTBUS_BILLING_GST_INCLUSIVE_LABEL` still default off. The 18% figures stay fixtures.

`subscription_issue_tax_invoice` still requires a platform admin, a matching approved breakdown, and supplier identity. A second call for the same payment returns the same number. The PGlite test left `payments.amount_paise` at 149900 and rejected an update of `gross_paise`.

`subscription_invoice_reconcile` is still a read-only SQL function. It returns `PAYMENT_MISMATCH`, `OWNERSHIP_MISMATCH`, `MISSING_TAX_POLICY`, `TAX_MISMATCH`, `MISSING_INVOICE`, `MISSING_TAX_EVIDENCE`, `REFUND_REVIEW`, or `MATCHED`. It does not insert invoices or commissions. `DUPLICATE_INVOICE` is prevented by the unique `payment_id`. `COMMISSION_MISMATCH` remains on the affiliate reconciliation report.

Affiliate accrual is unchanged: missing policy is `MISSING_CONFIGURATION`, missing evidence is `TAX_REVIEW`, conflict is `CONFLICT`, and a repeated payment does not accrue twice. Payouts stay disabled.
