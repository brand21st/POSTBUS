# PostBus Phase 2.8 merchant billing

Status: IMPLEMENTED LOCALLY. Browser session UNVERIFIED. No merchant login was used.

## Existing page

`/dashboard/billing` still shows the current plan, cycle, status, renewal date from `renewsAt` or `currentPeriodEnd`, usage, plan picker, payment history, and receipt invoices.

## Added

`GET /api/v1/billing/tax-invoices` accepts `q`, `status` (`ISSUED` or `PREVIEW`), `paymentStatus`, `from`, `to`, `page`, `pageSize` (max 25), `sort`, and `direction`. The query is parsed by `parseInvoiceListQuery`. Search characters outside letters, digits, `/`, `_`, and `-` are removed before they reach the database filter. Rows are scoped with `organization_id = ctx.organizationId`. Ordering is on `created_at` or `amount_paise`. AI-credit payments are excluded.

Each row is either `TAX INVOICE` with a stored number or `INVOICE PREVIEW` with no number. GST paise is present only when an issued or stored breakdown row exists.

`GET /api/v1/billing/profile` reads the merchant legal name, address, and GSTIN. `PATCH /api/v1/billing/profile` still requires `org.billing`. In `lib/permissions/rbac.ts` that permission belongs to OWNER. ADMIN does not receive it. Saving the profile does not update `subscription_tax_invoices`.

City, state, postal code, email, and phone are not separate columns on `organization_billing_profiles`. The address remains one field.

The page has a filter form, loading and empty states, and previous/next controls. PDF download uses the authenticated route and the filename from `Content-Disposition`.
