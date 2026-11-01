# PostBus Phase 2.7 staging plan

Status: BLOCKED. Remote staging SQL was not run.

## Gate

`scripts/affiliate-staging-gate.mts` still fails closed with `staging_not_approved` when no approved project ref is configured. `ENVIRONMENT=staging` is not approval. Do not point that script at a database until a staging project ref is explicitly approved.

## Order, after approval

Apply the existing local files in this order, on a disposable staging database only:

1. `20261017120000_affiliate_program.sql`
2. `20261017121000_affiliate_operations.sql`
3. `20261017122000_affiliate_webhook_leases.sql`
4. `20261017123000_affiliate_reporting.sql`
5. `20261017124000_affiliate_reconciliation.sql`
6. `20261017130000_subscription_tax_policy.sql`
7. `20261017140000_subscription_tax_invoices.sql`

Then run the PGlite invoice and affiliate suites against a migrated database, confirm `POSTBUS_BILLING_TAX_INVOICE_ENABLED` is unset or not `true`, and confirm supplier GSTIN is still empty. Do not issue a tax invoice on staging until a tax advisor approves the rate, supplier identity, numbering series, and financial-year rule.

## Do not do in this step

Do not change plan prices. Do not turn on affiliate accrual, affiliate payouts, tax automation, or tax-invoice issuance. Do not send a live Razorpay payment. Do not treat a staging success as production approval.
