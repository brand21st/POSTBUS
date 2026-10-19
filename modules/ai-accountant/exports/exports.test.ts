import { describe, expect, it } from "vitest";
import { UTF8_BOM } from "@/lib/csv";
import { readWorkbook } from "@/lib/xlsx/read";
import { buildTallyXml, tallyGroup } from "@/modules/ai-accountant/exports/tally";
import { serializeExport } from "@/modules/ai-accountant/exports/run";

describe("Tally XML", () => {
  it("writes masters and balanced journal vouchers with Tally sign convention", () => {
    const xml = buildTallyXml({
      company: "Acme & Co",
      ledgers: [
        { name: "Bank", type: "ASSET", key: "bank" },
        { name: "Sales", type: "REVENUE", key: "sales" },
      ],
      vouchers: [
        {
          number: "PB-1",
          date: "2026-10-05",
          narration: "Sale <#1>",
          lines: [
            { ledger: "Bank", debitPaise: 11850, creditPaise: 0 },
            { ledger: "Sales", debitPaise: 0, creditPaise: 11850 },
          ],
        },
      ],
    });
    expect(xml).toContain("<SVCURRENTCOMPANY>Acme &amp; Co</SVCURRENTCOMPANY>");
    expect(xml).toContain('<LEDGER NAME="Bank" ACTION="Create">');
    expect(xml).toContain("<PARENT>Bank Accounts</PARENT>");
    expect(xml).toContain("<DATE>20261005</DATE>");
    expect(xml).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-118.50</AMOUNT>");
    expect(xml).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>118.50</AMOUNT>");
    expect(xml).toContain("Sale &lt;#1&gt;");
  });

  it("maps groups", () => {
    expect(tallyGroup({ name: "x", type: "LIABILITY", key: "gst_output_igst" })).toBe("Duties & Taxes");
    expect(tallyGroup({ name: "x", type: "EXPENSE", key: "rent" })).toBe("Indirect Expenses");
    expect(tallyGroup({ name: "x", type: "EXPENSE", key: "shipping_expense" })).toBe("Direct Expenses");
  });
});

describe("serializeExport", () => {
  const built = { sheets: [{ name: "A", rows: [["h1", "h2"], ["x", 1.5]] }, { name: "B", rows: [["only"]] }] };

  it("produces XLSX with every sheet", async () => {
    const file = await serializeExport(built, "XLSX");
    const sheets = await readWorkbook(file.bytes);
    expect(sheets.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("produces CSV with a BOM and section titles for multi-sheet exports", async () => {
    const file = await serializeExport(built, "CSV");
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.bytes);
    expect(text.startsWith(UTF8_BOM + "A\r\nh1,h2")).toBe(true);
    expect(text).toContain("B\r\nonly");
  });

  it("rejects mismatched formats", async () => {
    await expect(serializeExport(built, "XML")).rejects.toThrow();
    await expect(serializeExport({ xml: "<x/>" }, "CSV")).rejects.toThrow();
  });
});
