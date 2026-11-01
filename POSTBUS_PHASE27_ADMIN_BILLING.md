# PostBus Phase 2.7 admin billing

Status: PARTIAL. Implemented locally. Browser verification is UNVERIFIED. No admin session was opened.

## Surface

Super Admin navigation adds Tax invoices at `/admin/invoices`, after the existing Tax policy item. The page reads `/api/admin/tax-invoices`.

The page shows:

- Whether `POSTBUS_BILLING_TAX_INVOICE_ENABLED` is on in this environment. The local page reports it off.
- A supplier form for legal name, GSTIN, address, numbering prefix, and the existing admin action PIN.
- An issued-invoice table.
- An issue form that the API refuses while the flag is off.
- A read-only reconcile lookup by payment id.

## Authorization

`lib/api/admin/handle.ts` already requires a platform admin before the tax-invoice handler runs. Saving settings and issuing an invoice also require the existing action PIN. Issuance writes `billing_audit_logs` with action `tax_invoice.issued`, the actor, the invoice number, and the payment id.

## Metrics

The page does not invent revenue, commission, or missing-evidence totals. Those figures stay on the existing affiliate and billing reports. This screen shows issuance state, stored invoices, and the reconcile label for a payment the operator looks up.

## Limits

There is no date filter, merchant filter, or pagination beyond the handler's current list. Privileged issue and settings writes are audited. Reconcile does not modify rows.
