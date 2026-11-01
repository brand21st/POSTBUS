# PostBus Phase 2.8 admin invoices

Status: IMPLEMENTED LOCALLY. Browser session UNVERIFIED.

`/admin/invoices` still uses the platform-admin API. Issuance stays off unless `POSTBUS_BILLING_TAX_INVOICE_ENABLED` is the string `true`. The issue form still sends the action PIN, and the server refuses issuance while the flag is off.

The list now accepts invoice number or payment reference, organization id, plan name, date range, page, and direction. Overview figures are a count of `CAPTURED` subscription payments, excluding `ai_credits`, and a count of `subscription_tax_invoices`. Previews are not in the issued count. The filtered total is separate from the issued count.

The latest 20 `billing_audit_logs` rows for `tax_invoice.issued` and `tax_invoice.settings` are listed. The page does not edit invoice amounts.

Supplier settings still require the action PIN. An empty supplier GSTIN remains empty.
