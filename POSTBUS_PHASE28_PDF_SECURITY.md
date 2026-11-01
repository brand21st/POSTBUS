# PostBus Phase 2.8 PDF security

Status: PARTIAL. The route rules are implemented locally. A logged-in download was not executed.

`GET /api/v1/billing/tax-invoices/:paymentId/pdf` requires a tenant session. The payment id must be a UUID. `ownedPayment` loads the payment only when `organization_id` matches `ctx.organizationId`. A missing payment returns not found, which also covers another organization's id.

An issued row renders `TAX INVOICE` from the stored snapshot. Otherwise the response is `INVOICE PREVIEW`, with no new invoice number allocated. The preview lists readiness blockers and does not invent a GSTIN.

The response is `application/pdf`, an attachment, and `Cache-Control: private, no-store`. The filename is sanitized. The file is streamed from the request. It is not written to a public bucket.

PGlite still shows an authenticated member of another organization selecting zero invoice rows. That check is local, not hosted Supabase RLS.
