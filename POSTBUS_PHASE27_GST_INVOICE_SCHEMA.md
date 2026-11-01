# PostBus Phase 2.7 GST invoice schema

Migration: `supabase/migrations/20261017140000_subscription_tax_invoices.sql`

Status: IMPLEMENTED LOCALLY. Not applied to staging. Not applied to production.

The file is forward-only. Earlier affiliate and tax migrations were not edited. Amounts are integer paise. Issued snapshots are immutable.

## Tables

| Table | Role |
| --- | --- |
| `subscription_invoice_settings` | Singleton supplier legal name, address, GSTIN, numbering prefix `PB`, financial-year start month `4`. All identity fields start empty. |
| `subscription_invoice_counters` | One row per series. `last_value` increments with `insert ... on conflict do update`. |
| `organization_billing_profiles` | Merchant legal name, billing address, and optional GSTIN for future invoices. Organizations previously had no billing-address column. |
| `subscription_tax_invoices` | One issued invoice per payment. Status is `ISSUED`. Checks require `taxable_paise + total_tax_paise = gross_paise` and `cgst_paise + sgst_paise + igst_paise = total_tax_paise`. |

The invoice row stores the organization, subscription, payment, plan name, billing cycle, period, invoice number, invoice date, supplier snapshot, customer snapshot, place of supply, service description, gross, taxable, CGST, SGST, IGST, total tax, approved policy id, policy version, payment reference, and timestamps.

`payments.amount_paise` is not altered by issuance.

## Functions

| Function | Access |
| --- | --- |
| `subscription_allocate_invoice_number` | `service_role` |
| `subscription_issue_tax_invoice` | `service_role`, and the body also requires `platform_admins` |
| `subscription_invoice_reconcile` | `service_role`, read-only |
| `subscription_invoice_org_visible` | `authenticated`, security definer membership check |
| `subscription_tax_invoice_guard` | Trigger. Update and delete raise. |

## Reconciliation categories

`subscription_invoice_reconcile` returns one label: `PAYMENT_MISMATCH`, `OWNERSHIP_MISMATCH`, `MISSING_TAX_POLICY`, `TAX_MISMATCH`, `MISSING_INVOICE`, `MISSING_TAX_EVIDENCE`, `REFUND_REVIEW`, or `MATCHED`.

`DUPLICATE_INVOICE` is prevented by the unique `payment_id` rather than returned as a label. `COMMISSION_MISMATCH` remains on the existing affiliate reconciliation.

## Grants

Anonymous and authenticated roles have no write access. Authenticated users may select `subscription_tax_invoices` only through `own_org_tax_invoice`, which calls `subscription_invoice_org_visible`. Settings, counters, and billing profiles are revoked from `anon` and `authenticated`.
