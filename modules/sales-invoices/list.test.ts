import { describe, expect, it } from "vitest";
import { cleanSalesInvoiceSearch, salesInvoiceSearchClause, summarizeSalesInvoices } from "@/modules/sales-invoices/list";
import { listSalesInvoices, salesInvoiceSummary } from "@/modules/sales-invoices/service";

type Call = { table: string; method: string; args: unknown[] };

function fakeSupabase(results: Record<string, { data: unknown; count?: number }>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const result = { data: results[table]?.data ?? [], error: null, count: results[table]?.count ?? null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "or", "ilike", "gte", "lte", "limit", "range"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return builder;
    },
  };
  return { client: client as never, calls };
}

describe("cleanSalesInvoiceSearch", () => {
  it("removes characters that break PostgREST or() filters", () => {
    expect(cleanSalesInvoiceSearch("  PB/2026,27 (x)%_* ")).toBe("PB/2026 27 x");
    expect(cleanSalesInvoiceSearch(null)).toBe("");
    expect(cleanSalesInvoiceSearch("a".repeat(200))).toHaveLength(80);
  });
});

describe("salesInvoiceSearchClause", () => {
  it("matches invoice number and billed name, plus orders found by number", () => {
    expect(salesInvoiceSearchClause("irfan")).toBe("invoice_number.ilike.%irfan%,billing_snapshot->>name.ilike.%irfan%");
    expect(salesInvoiceSearchClause("1035", ["o1", "o2"])).toBe(
      "invoice_number.ilike.%1035%,billing_snapshot->>name.ilike.%1035%,order_id.in.(o1,o2)"
    );
  });
});

describe("summarizeSalesInvoices", () => {
  it("counts only issued invoices as sales and nets off issued credit notes", () => {
    const summary = summarizeSalesInvoices([
      { status: "ISSUED", document_kind: "SALES", grand_total_paise: 118000, cgst_paise: 9000, sgst_paise: 9000 },
      { status: "ISSUED", document_kind: "SALES", grand_total_paise: "59000", igst_paise: "9000", cess_paise: 0 },
      { status: "ISSUED", document_kind: "CREDIT_NOTE", grand_total_paise: -59000, igst_paise: -9000 },
      { status: "DRAFT", document_kind: "SALES", grand_total_paise: 500000, cgst_paise: 1000 },
      { status: "DRAFT", document_kind: "CREDIT_NOTE", grand_total_paise: -10000 },
      { status: "REVIEW", document_kind: "SALES", grand_total_paise: 70000 },
      { status: "CANCELLED", document_kind: "SALES", grand_total_paise: 900000, igst_paise: 90000 },
    ]);
    expect(summary).toEqual({ issued: 2, valuePaise: 118000, gstPaise: 18000, drafts: 2, review: 1, cancelled: 1, creditNotes: 1 });
  });

  it("returns zeros for a new account", () => {
    expect(summarizeSalesInvoices([])).toEqual({ issued: 0, valuePaise: 0, gstPaise: 0, drafts: 0, review: 0, cancelled: 0, creditNotes: 0 });
  });
});

describe("listSalesInvoices search", () => {
  it("filters in the database by invoice number, customer and order, keeping the count", async () => {
    const { client, calls } = fakeSupabase({
      orders: { data: [{ id: "order-1" }] },
      sales_invoices: { data: [{ id: "inv-1", order_id: "order-1", status: "DRAFT", payment_status: "UNPAID", orders: { order_number: "#1035" } }], count: 41 },
    });
    const result = await listSalesInvoices(client, "org-1", { page: 3, pageSize: 20, search: " #1035 " });
    expect(calls).toContainEqual({ table: "orders", method: "ilike", args: ["order_number", "%#1035%"] });
    expect(calls).toContainEqual({
      table: "sales_invoices",
      method: "or",
      args: ["invoice_number.ilike.%#1035%,billing_snapshot->>name.ilike.%#1035%,order_id.in.(order-1)"],
    });
    expect(calls).toContainEqual({ table: "sales_invoices", method: "range", args: [40, 59] });
    expect(result.total).toBe(41);
    expect(result.items.map((item) => item.id)).toEqual(["inv-1"]);
  });

  it("skips the order lookup without a search", async () => {
    const { client, calls } = fakeSupabase({ sales_invoices: { data: [], count: 0 } });
    await listSalesInvoices(client, "org-1", { page: 1, pageSize: 20, status: "ISSUED" });
    expect(calls.some((call) => call.table === "orders")).toBe(false);
    expect(calls).toContainEqual({ table: "sales_invoices", method: "eq", args: ["status", "ISSUED"] });
  });
});

describe("salesInvoiceSummary", () => {
  it("reads credit notes too so they can be netted off", async () => {
    const { client, calls } = fakeSupabase({
      sales_invoices: { data: [{ status: "ISSUED", document_kind: "CREDIT_NOTE", grand_total_paise: -1000 }] },
    });
    const summary = await salesInvoiceSummary(client, "org-1");
    expect(calls.filter((call) => call.method === "eq")).toEqual([{ table: "sales_invoices", method: "eq", args: ["organization_id", "org-1"] }]);
    expect(summary.creditNotes).toBe(1);
    expect(summary.valuePaise).toBe(-1000);
  });
});
