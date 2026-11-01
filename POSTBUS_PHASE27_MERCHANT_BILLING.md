# PostBus Phase 2.7 merchant billing

Status: PARTIAL. Implemented on the existing `/dashboard/billing` page. Browser verification is UNVERIFIED because no merchant session was used.

## What was added

The existing subscription, usage, plan picker, payment history, and receipt list stay on the same page.

- A form saves `legalName`, `address`, and optional `gstin` with `PATCH /api/v1/billing/profile`. The copy says the details are for future invoices.
- Each payment row has a Preview button. It downloads `/api/v1/billing/tax-invoices/:paymentId/pdf` as `invoice-preview.pdf`.
- `GET /api/v1/billing/tax-invoices` lists issued tax invoices for `ctx.organizationId`. The client does not choose the organization.

## What is still incomplete

The new tax-invoice list has no search, date filter, or pagination. The payment table is the existing history. Billing-profile validation requires a legal name of at least 2 characters, an address of at least 4 characters, and a GSTIN of at most 15 characters. Server issuance still applies the stricter GSTIN and tax-policy checks.

## Access

The routes sit behind the existing organization billing permission. A member of another organization does not receive that organization's rows. The PGlite check, running as `authenticated` for a member of a different organization, counted zero tax invoices.
