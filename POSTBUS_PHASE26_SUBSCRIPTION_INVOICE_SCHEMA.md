# PostBus Phase 2.6 subscription invoice schema

Status: partial. Breakdown persistence is local. A legal tax invoice is not started.

## Existing invoice

`invoices` remains a payment receipt record: organization, subscription, number, amount, amount paise, currency, status, period, and Razorpay id. This phase does not treat that row as a GST tax invoice and does not fill supplier GSTIN, customer GSTIN, or SAC.

## New breakdown

`subscription_tax_breakdowns` stores one immutable row per payment:

- gross, taxable, CGST, SGST, IGST, and total tax in paise
- policy id and version
- organization and subscription ids
- source `approved-subscription-tax-policy`

Checks require taxable plus total tax to equal gross, and the three tax components to equal total tax. Updates and deletes raise. Historical `payments.amount_paise` is not rewritten. There is no backfill.

Customer billing address, supplier legal name, and supplier GSTIN stay empty until those values exist in approved platform configuration. The admin screen at `/admin/tax` lists policies and recent breakdowns for a platform admin. It does not issue a PDF.
