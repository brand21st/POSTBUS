# PostBus Phase 2.7 PDF implementation

Status: IMPLEMENTED LOCALLY. VERIFIED LOCALLY for the preview bytes. Browser download is UNVERIFIED.

## Renderer

`modules/billing/subscription-invoice-pdf.ts` uses the existing `pdf-lib` dependency. No PDF package was added. The page is A4. Standard Helvetica is used, so amounts are labeled `Rs` rather than with the rupee symbol. The plan line uses ` - ` because Helvetica cannot encode a middle dot.

## Content

The preview and the issued render use the same layout:

- PostBus
- `INVOICE PREVIEW` or `TAX INVOICE`
- Invoice number, invoice date, and billing period when those values exist
- Supplier legal name, address, and GSTIN
- Customer legal name, address, and GSTIN when provided
- Plan, billing cycle, and period
- Gross amount, taxable amount, CGST, SGST, IGST, total GST, and total
- Payment status and payment reference
- Blockers, when the document is not ready

Empty supplier fields are left empty. They are not replaced with a sample GSTIN. A preview states that it is a draft and not an issued tax invoice.

An issued PDF is rendered from the stored snapshot, not from the current settings row.

## Test

`renderSubscriptionInvoicePdf` returned bytes beginning with `%PDF-`. `invoiceDocumentTitle(false)` is `INVOICE PREVIEW`. `invoiceDocumentTitle(true)` is `TAX INVOICE`.

## Download

Merchant route: `GET /api/v1/billing/tax-invoices/:paymentId/pdf`. The response is `application/pdf`, an attachment, and `Cache-Control: private, no-store`. The handler returns a `Response`, which the API layer already passes through. The client uses `fetch` because the JSON helper cannot carry a PDF.
