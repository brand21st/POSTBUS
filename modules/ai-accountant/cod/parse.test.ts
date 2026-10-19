import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { toCsv } from "@/lib/csv";
import { writeWorkbook } from "@/lib/xlsx/write";
import { classifyRow } from "@/modules/ai-accountant/cod/ingest";
import { detectColumns, parseCodFile, parseCodReportText, parseReportDate } from "@/modules/ai-accountant/cod/parse";

const encoder = new TextEncoder();

describe("column detection", () => {
  it("maps common India Post headers", () => {
    expect(detectColumns(["Sl No", "Article Number", "Delivery Date", "COD Amount", "Commission", "Net Amount Payable"])).toEqual({
      article: 1,
      date: 2,
      cod: 3,
      commission: 4,
      net: 5,
    });
  });
});

describe("parseCodFile", () => {
  it("reads XLSX with title rows above the header", async () => {
    const bytes = await writeWorkbook([
      {
        name: "Remittance",
        rows: [
          ["India Post COD Remittance Statement"],
          ["Customer ID 1000123"],
          ["Article No", "Delivered On", "COD Amt", "Comm", "Net Payable"],
          ["EL835418390IN", "19-10-2026", "259.00", "5.18", "253.82"],
          ["el835418391in", 46314, 1499, 29.98, 1469.02],
          ["Total", "", "1758", "35.16", "1722.84"],
        ],
      },
    ]);
    const result = await parseCodFile(bytes, "report.xlsx");
    expect(result.format).toBe("XLSX");
    expect(result.headerRow).toBe(2);
    expect(result.rows).toEqual([
      { articleBarcode: "EL835418390IN", deliveredOn: "2026-10-19", codAmountPaise: 25900, commissionPaise: 518, netAmountPaise: 25382 },
      { articleBarcode: "EL835418391IN", deliveredOn: "2026-10-19", codAmountPaise: 149900, commissionPaise: 2998, netAmountPaise: 146902 },
    ]);
  });

  it("reads CSV with rupee symbols and thousands separators, and honours a manual map", async () => {
    const csv = toCsv([
      ["Barcode", "Value", "Charges", "Remitted"],
      ["EL835418390IN", "₹1,259.00", "25.18", "1,233.82"],
    ]);
    const auto = await parseCodFile(encoder.encode(csv), "x.csv");
    expect(auto.format).toBe("CSV");
    expect(auto.rows[0]?.netAmountPaise).toBe(123382);
    // No COD column header: COD is derived as net + commission.
    expect(auto.rows[0]?.codAmountPaise).toBe(125900);
    const manual = await parseCodFile(encoder.encode(csv), "x.csv", { article: 0, cod: 1, commission: 2, net: 3 });
    expect(manual.rows[0]?.codAmountPaise).toBe(125900);
  });

  it("reads PDF text lines", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Article Date COD Commission Net", { x: 40, y: 720, size: 10, font });
    page.drawText("EL835418390IN 19-10-2026 259.00 5.18 253.82", { x: 40, y: 700, size: 10, font });
    page.drawText("EL835418391IN 20/10/2026 1,499.00 29.98 1,469.02", { x: 40, y: 680, size: 10, font });
    const result = await parseCodFile(new Uint8Array(await doc.save()), "r.pdf");
    expect(result.format).toBe("PDF");
    expect(result.rows.map((r) => [r.articleBarcode, r.deliveredOn, r.codAmountPaise, r.netAmountPaise])).toEqual([
      ["EL835418390IN", "2026-10-19", 25900, 25382],
      ["EL835418391IN", "2026-10-20", 149900, 146902],
    ]);
  });
});

describe("text parser", () => {
  it("does not read date parts or pincodes as money", () => {
    expect(parseCodReportText("EL835418390IN 19-10-2026 682001 259.00")).toEqual([
      { articleBarcode: "EL835418390IN", deliveredOn: "2026-10-19", codAmountPaise: 25900, commissionPaise: 0, netAmountPaise: 25900 },
    ]);
  });

  it("parses report dates", () => {
    expect(parseReportDate("2026-10-19T00:00")).toBe("2026-10-19");
    expect(parseReportDate("5/1/2026")).toBe("2026-01-05");
    expect(parseReportDate("nope")).toBeNull();
  });
});

describe("classifyRow", () => {
  const row = { articleBarcode: "EL835418390IN", codAmountPaise: 25900, commissionPaise: 0, netAmountPaise: 25900 };
  const shipment = { id: "s", order_id: "o", cod_amount: "259.00", status: "DELIVERED", payment_mode: "COD" };
  it("reconciles exact matches and flags the rest", () => {
    expect(classifyRow(row, shipment, false).status).toBe("RECONCILED");
    expect(classifyRow(row, null, false).reason).toBe("missing_shipment");
    expect(classifyRow({ ...row, codAmountPaise: 25000 }, shipment, false).reason).toBe("short_remittance");
    expect(classifyRow(row, shipment, true).reason).toBe("duplicate_remittance");
    expect(classifyRow(row, { ...shipment, status: "CANCELLED" }, false).status).toBe("UNMATCHED");
    expect(classifyRow(row, { ...shipment, payment_mode: "PREPAID" }, false).reason).toBe("prepaid_shipment");
  });
});
