/** Strips characters that break PostgREST `or()` filters or act as LIKE wildcards. */
export function cleanSalesInvoiceSearch(raw: string | null | undefined) {
  return String(raw ?? "")
    .replace(/[%_,()*\\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** One `or()` clause: invoice number, billed customer name, or a matching order. */
export function salesInvoiceSearchClause(term: string, orderIds: string[] = []) {
  const clauses = [`invoice_number.ilike.%${term}%`, `billing_snapshot->>name.ilike.%${term}%`];
  if (orderIds.length) clauses.push(`order_id.in.(${orderIds.join(",")})`);
  return clauses.join(",");
}

type SummaryRow = {
  status?: string | null;
  document_kind?: string | null;
  grand_total_paise?: number | string | null;
  cgst_paise?: number | string | null;
  sgst_paise?: number | string | null;
  utgst_paise?: number | string | null;
  igst_paise?: number | string | null;
  cess_paise?: number | string | null;
};

export type SalesInvoiceSummary = {
  /** Issued sales invoices. */
  issued: number;
  /** Issued sales value minus issued credit notes, GST included. */
  valuePaise: number;
  /** GST on issued sales minus GST reversed by issued credit notes. */
  gstPaise: number;
  drafts: number;
  review: number;
  cancelled: number;
  creditNotes: number;
};

function paise(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

/** Drafts and cancelled invoices are not sales, so they stay out of the money totals. */
export function summarizeSalesInvoices(rows: SummaryRow[]): SalesInvoiceSummary {
  const summary: SalesInvoiceSummary = { issued: 0, valuePaise: 0, gstPaise: 0, drafts: 0, review: 0, cancelled: 0, creditNotes: 0 };
  for (const row of rows) {
    if (row.status === "DRAFT") summary.drafts += 1;
    else if (row.status === "REVIEW") summary.review += 1;
    else if (row.status === "CANCELLED") summary.cancelled += 1;
    if (row.status !== "ISSUED") continue;
    const gst = paise(row.cgst_paise) + paise(row.sgst_paise) + paise(row.utgst_paise) + paise(row.igst_paise) + paise(row.cess_paise);
    if (row.document_kind === "CREDIT_NOTE") {
      summary.creditNotes += 1;
      summary.valuePaise -= Math.abs(paise(row.grand_total_paise));
      summary.gstPaise -= Math.abs(gst);
    } else {
      summary.issued += 1;
      summary.valuePaise += paise(row.grand_total_paise);
      summary.gstPaise += gst;
    }
  }
  return summary;
}
