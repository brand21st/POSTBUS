import { describe, expect, it } from "vitest";
import { DEFAULT_CHART } from "@/modules/ai-accountant/chart";
import {
  codRemittanceEntry,
  expenseEntry,
  orderSaleEntry,
  purchaseEntry,
  shipmentChargeEntry,
  splitTax,
  ZERO_GST,
  type PostingEntry,
} from "@/modules/ai-accountant/ledger/posting-rules";
import {
  buildBalanceSheet,
  buildCashflow,
  buildProfitAndLoss,
  buildTrialBalance,
  type AccountTotal,
} from "@/modules/ai-accountant/reports/statements";

/** Aggregates posting entries into per-account totals, like accounting_account_totals. */
function totals(entries: PostingEntry[]): AccountTotal[] {
  return DEFAULT_CHART.map((account) => {
    let debit = 0;
    let credit = 0;
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.accountKey !== account.key) continue;
        debit += line.debitPaise;
        credit += line.creditPaise;
      }
    }
    return { code: account.code, name: account.name, type: account.type, system_key: account.key, debit_paise: debit, credit_paise: credit };
  });
}

const capital: PostingEntry = {
  sourceType: "manual",
  sourceId: "cap",
  sourceEvent: "manual",
  entryDate: "2026-10-01",
  memo: "Capital",
  lines: [
    { accountKey: "bank", debitPaise: 1_000_000, creditPaise: 0 },
    { accountKey: "owner_equity", debitPaise: 0, creditPaise: 1_000_000 },
  ],
};

const book = [
  capital,
  purchaseEntry({
    purchaseId: "p1",
    entryDate: "2026-10-02",
    categoryKey: "inventory",
    taxablePaise: 200_000,
    gst: splitTax(24_000, "32", "32"),
    itcEligible: true,
    paymentAccountKey: "bank",
    vendor: "Supplier",
  }),
  orderSaleEntry({
    orderId: "o1",
    orderNumber: "#1",
    entryDate: "2026-10-05",
    totalPaise: 118_000 + 5_000,
    shippingPaise: 5_000,
    codPaise: 123_000,
    gst: splitTax(18_000, "32", "27"),
  }),
  shipmentChargeEntry({ shipmentId: "s1", reference: "EL1", entryDate: "2026-10-05", tariffPaise: 4_720 }),
  codRemittanceEntry({ reportRowId: "r1", article: "EL1", entryDate: "2026-10-09", netPaise: 120_540, commissionPaise: 2_460 }),
  expenseEntry({
    expenseId: "e1",
    entryDate: "2026-10-10",
    categoryKey: "marketing",
    totalPaise: 30_000,
    itc: ZERO_GST,
    paymentAccountKey: "bank",
  }),
];

describe("statements", () => {
  it("trial balance balances", () => {
    const tb = buildTrialBalance(totals(book));
    expect(tb.balanced).toBe(true);
    expect(tb.debitPaise).toBeGreaterThan(0);
  });

  it("P&L nets revenue against direct and operating costs", () => {
    const pnl = buildProfitAndLoss(totals(book));
    expect(pnl.revenuePaise).toBe(105_000);
    expect(pnl.directCostPaise).toBe(4_720 + 2_460);
    expect(pnl.operatingPaise).toBe(30_000);
    expect(pnl.netProfitPaise).toBe(105_000 - 7_180 - 30_000);
    expect(pnl.completeness).toBe("INCOMPLETE");
  });

  it("balance sheet balances with profit inside equity", () => {
    const bs = buildBalanceSheet(totals(book));
    expect(bs.balanced).toBe(true);
  });

  it("indirect cash flow reconciles to the cash movement", () => {
    const cf = buildCashflow(totals(book));
    expect(cf.reconciles).toBe(true);
    expect(cf.financingPaise).toBe(1_000_000);
    expect(cf.cashChangePaise).toBe(1_000_000 - 224_000 + 120_540 - 30_000);
  });
});
