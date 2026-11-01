# Reconciliation

Affiliate `affiliate_reconciliation_report` categories: OWNERSHIP_MISMATCH, PAYMENT_UNVERIFIED, MISSING_TAX_EVIDENCE, MISSING_COMMISSION, REFUND_REVIEW, LEDGER_MISMATCH, MATCHED. SQL is `select jsonb_agg` only.

Invoice `subscription_invoice_reconcile` remains read-only (Phase 2.7/2.8). Issuance flag off.

No backfill run.
