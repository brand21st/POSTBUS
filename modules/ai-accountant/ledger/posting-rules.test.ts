import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  codRemittanceEntry,
  entryTotals,
  expenseEntry,
  inclusiveGst,
  orderReturnEntry,
  orderSaleEntry,
  platformPaymentEntry,
  purchaseEntry,
  shipmentChargeEntry,
  splitTax,
  ZERO_GST,
} from "@/modules/ai-accountant/ledger/posting-rules";
import { DEFAULT_CHART } from "@/modules/ai-accountant/chart";

const keys = new Set(DEFAULT_CHART.map((account) => account.key));

function balanced(entry: { lines: Array<{ accountKey: string; debitPaise: number; creditPaise: number }> }) {
  const totals = entryTotals(entry.lines);
  expect(totals.debitPaise).toBe(totals.creditPaise);
  for (const line of entry.lines) expect(keys.has(line.accountKey)).toBe(true);
}

function amount(entry: ReturnType<typeof orderSaleEntry>, key: string, side: "D" | "C") {
  return entry.lines
    .filter((line) => line.accountKey === key)
    .reduce((sum, line) => sum + (side === "D" ? line.debitPaise : line.creditPaise), 0);
}

describe("order sale", () => {
  const base = {
    orderId: "00000000-0000-0000-0000-000000000001",
    orderNumber: "#1001",
    entryDate: "2026-10-20",
    totalPaise: 11800 + 5000,
    shippingPaise: 5000,
    codPaise: 0,
    gst: splitTax(1800, "32", "32"),
  };

  it("splits prepaid sale into sales, shipping income and CGST/SGST", () => {
    const entry = orderSaleEntry(base);
    balanced(entry);
    expect(amount(entry, "accounts_receivable", "D")).toBe(16800);
    expect(amount(entry, "sales", "C")).toBe(10000);
    expect(amount(entry, "shipping_income", "C")).toBe(5000);
    expect(amount(entry, "gst_output_cgst", "C")).toBe(900);
    expect(amount(entry, "gst_output_sgst", "C")).toBe(900);
  });

  it("books COD part to India Post receivable and the advance to gateway", () => {
    const entry = orderSaleEntry({ ...base, codPaise: 12000, gst: splitTax(1800, "32", "27") });
    balanced(entry);
    expect(amount(entry, "cod_receivable", "D")).toBe(12000);
    expect(amount(entry, "accounts_receivable", "D")).toBe(4800);
    expect(amount(entry, "gst_output_igst", "C")).toBe(1800);
  });

  it("RTO mirrors the sale into sales returns", () => {
    const entry = orderReturnEntry(base);
    balanced(entry);
    expect(entry.sourceEvent).toBe("rto");
    expect(amount(entry, "sales_returns", "D")).toBe(15000);
    expect(amount(entry, "accounts_receivable", "C")).toBe(16800);
    expect(amount(entry, "gst_output_cgst", "D")).toBe(900);
  });

  it("refuses tax larger than the total", () => {
    expect(() => orderSaleEntry({ ...base, totalPaise: 100, shippingPaise: 0 })).toThrow();
  });
});

describe("other rules balance", () => {
  it("shipment tariff", () => {
    const entry = shipmentChargeEntry({ shipmentId: "s", reference: "EL1", entryDate: "2026-10-20", tariffPaise: 4720 });
    balanced(entry);
  });

  it("COD remittance nets commission", () => {
    const entry = codRemittanceEntry({
      reportRowId: "r",
      article: "EL835418390IN",
      entryDate: "2026-10-21",
      netPaise: 25400,
      commissionPaise: 500,
    });
    balanced(entry);
    expect(entry.lines.find((line) => line.accountKey === "cod_receivable")?.creditPaise).toBe(25900);
  });

  it("expense with input GST", () => {
    const { gst } = inclusiveGst(11800, 1800, "32", "32");
    const entry = expenseEntry({
      expenseId: "e",
      entryDate: "2026-10-01",
      categoryKey: "packaging",
      totalPaise: 11800,
      itc: gst,
      paymentAccountKey: "bank",
    });
    balanced(entry);
    expect(entry.lines.find((line) => line.accountKey === "packaging")?.debitPaise).toBe(10000);
  });

  it("purchase without ITC capitalises tax", () => {
    const entry = purchaseEntry({
      purchaseId: "p",
      entryDate: "2026-10-01",
      categoryKey: "inventory",
      taxablePaise: 10000,
      gst: splitTax(1200, "32", "29"),
      itcEligible: false,
      paymentAccountKey: "accounts_payable",
      vendor: "Supplier",
    });
    balanced(entry);
    expect(entry.lines.find((line) => line.accountKey === "inventory")?.debitPaise).toBe(11200);
    expect(entry.lines.some((line) => line.accountKey.startsWith("gst_input"))).toBe(false);
  });

  it("platform payment routes AI credits separately", () => {
    const entry = platformPaymentEntry({ paymentId: "x", entryDate: "2026-10-01", amountPaise: 99900, purpose: "ai_credits" });
    balanced(entry);
    expect(entry.lines[0]?.accountKey).toBe("ai_credits");
  });
});

describe("validation", () => {
  it("drops zero lines and rejects unbalanced entries", () => {
    expect(() =>
      assertBalanced({
        sourceType: "manual",
        sourceId: "m",
        sourceEvent: "manual",
        entryDate: "2026-10-01",
        memo: "x",
        lines: [
          { accountKey: "bank", debitPaise: 100, creditPaise: 0 },
          { accountKey: "cash", debitPaise: 0, creditPaise: 90 },
        ],
      })
    ).toThrow(/unbalanced/);
    const ok = assertBalanced({
      sourceType: "manual",
      sourceId: "m",
      sourceEvent: "manual",
      entryDate: "2026-10-01",
      memo: "x",
      lines: [
        { accountKey: "bank", debitPaise: 100, creditPaise: 0 },
        { accountKey: "cash", debitPaise: 0, creditPaise: 0 },
        { accountKey: "owner_equity", debitPaise: 0, creditPaise: 100 },
      ],
    });
    expect(ok.lines).toHaveLength(2);
  });

  it("rejects fractional paise", () => {
    expect(() => splitTax(10.5)).toThrow();
  });

  it("zero-rated sale has no GST lines", () => {
    expect(inclusiveGst(5000, 0).gst).toEqual(ZERO_GST);
  });
});

describe("COGS", () => {
  it("costs every line by SKU or returns null", async () => {
    const { orderCogsPaise, cogsEntry } = await import("@/modules/ai-accountant/ledger/posting-rules");
    const costs = new Map([["tee-1", 25000], ["mug", 9000]]);
    expect(orderCogsPaise([{ sku: " TEE-1 ", quantity: 2 }, { sku: "mug", quantity: 1 }], costs)).toBe(59000);
    expect(orderCogsPaise([{ sku: "tee-1", quantity: 1 }, { sku: null, quantity: 1 }], costs)).toBeNull();
    const back = cogsEntry({ orderId: "o", orderNumber: "#1", entryDate: "2026-10-01", cogsPaise: 100, returned: true });
    expect(back.sourceEvent).toBe("rto_cogs");
    expect(back.lines.find((line) => line.accountKey === "inventory")?.debitPaise).toBe(100);
  });
});
