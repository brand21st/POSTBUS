# PostBus Phase 2.7 invoice architecture

Status: PARTIAL. Implemented locally. Issuance is disabled.

## Boundary

The existing payment receipt remains the receipt. Subscription GST documents are a separate `subscription_tax_invoices` record. Shipping invoices in `modules/invoices` are a different domain and are not used as subscription tax evidence.

## Lifecycle

1. A verified subscription payment can be previewed at any time.
2. `assessSubscriptionInvoice` blocks issuance when the approved policy, supplier identity, customer name, customer address, or amount reconciliation is missing.
3. An empty customer GSTIN does not block issuance. An invalid customer GSTIN does.
4. `POSTBUS_BILLING_TAX_INVOICE_ENABLED` must be the string `true`. Any other value leaves issuance off. The app checks the flag before calling SQL.
5. `subscription_issue_tax_invoice` requires a platform admin, an INR subscription payment, a matching approved tax breakdown, supplier name, address, and a 15-character GSTIN, and customer name and address.
6. The same payment returns the existing invoice number when the gross amount still matches. A conflicting gross amount raises. The payment row is not updated.
7. Issued rows cannot be updated or deleted. The trigger raises `Issued subscription tax invoices are immutable`.

Preview PDFs use the title `INVOICE PREVIEW` and the sentence that the file is a draft and not an issued tax invoice. The title `TAX INVOICE` is used only for a persisted issued snapshot.

## Numbering

`subscription_allocate_invoice_number` inserts a counter row and, on conflict, increments `last_value` in the same statement. The proposed format is `PB/2026-27/000001`. The prefix and April financial-year start are settings, not an approved statutory policy. October 2026 maps to `2026-27`. 31 March 2026 maps to `2025-26`.

Uniqueness is enforced on `invoice_number` and on `payment_id`. Number allocation was checked as two sequential calls in one PGlite session. Two concurrent database sessions were not opened.

## Refunds

No credit-note or debit-note issuer was added. `subscription_invoice_reconcile` is read-only. After an invoice exists, a payment with `affiliate_payment_evidence.refunded_paise > 0` returns `REFUND_REVIEW`. Affiliate reversal stays on the existing ledger.

## What issuance does not do

It does not invent a GST rate, a supplier GSTIN, or a place of supply. Settings start empty. A missing supplier GSTIN blocks issuance. Customer-submitted tax amounts are not accepted as authoritative. The SQL function reconciles taxable value plus tax to the gross amount, and the tax parts to the total tax.
