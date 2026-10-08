import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { SAMPLE_INVOICE_DATA } from "@/modules/invoices/data";
import { renderInvoicePdf } from "@/modules/invoices/pdf";
import { SAMPLE_PACKING_DATA } from "@/modules/labels/packing-data";
import { renderMerchantLabelPdf, renderPackingSlipPdf } from "@/modules/labels/packing-pdf";
import { renderReceiptPdf, type ReceiptData } from "@/modules/labels/receipt";
import { indiaPostLabelTemplate } from "@/modules/labels/template-schema";
import { canvasRequireFrom, loadCanvas } from "@/modules/labels/unicode/canvas-native";
import { measurePaintText, needsUnicodePaint } from "@/modules/labels/unicode/paint";
import { measureShapedText, rasterizeShapedLine } from "@/modules/labels/unicode/raster";
import { sanitizeLabelText, segmentScriptRuns } from "@/modules/labels/unicode/text";

const SAMPLES = path.join(process.cwd(), "tmp/unicode-label-samples");

const SCRIPT_LINES: Array<[string, string, string]> = [
  ["malayalam", "നിജില എൻ എം", "കല്ലാച്ചി പി.ഒ"],
  ["hindi", "निजिला एन एम", "कल्लाची पोस्ट"],
  ["tamil", "நிஜிலா", "கல்லாச்சி"],
  ["kannada", "ನಿಜಿಲಾ", "ಕಲ್ಲಾಚಿ"],
  ["telugu", "నిజిలా", "కల్లాచి"],
  ["bengali", "নিজিলা", "কল্লাচি"],
  ["gujarati", "નિજિલા", "કલ્લાચી"],
  ["marathi", "निजिला", "कल्लाची"],
  ["punjabi", "ਨਿਜਿਲਾ", "ਕੱਲਾਚੀ"],
  ["odia", "ନିଜିଲା", "କଲ୍ଲାଚି"],
  ["english", "Nijila NM", "Kallachi PO"],
  ["mixed", "നിജിലാ Nijila निजिला", "കല്ലാച്ചി Kallachi कल्लाची"],
];

const receiptBase: ReceiptData = {
  articleId: "AW784699994IN",
  service: "Speed Post Parcel",
  bookingRefId: "1026577399592963",
  invoiceNo: "2125000309112526403",
  bookingDate: "2025-11-09 08:32:11",
  bookingOffice: "KADUGODI BNPL CENTRE - 560067",
  destinationOffice: "Pandhana S.O - 450661",
  customerId: "1000002954",
  contractId: "40000354",
  orderNumber: "#1042",
  paymentMode: "COD",
  physicalWeightGrams: 500,
  volumetricWeightGrams: 4056,
  chargedWeightGrams: 4056,
  dimensions: "10 x 8 x 4 cm",
  tariff: 106.2,
  codAmount: 499,
  sender: { name: "Lumin Ads", phone: "8884177077", lines: ["5/1 1st Cross", "Bengaluru, Karnataka 560011"] },
  receiver: { name: "Nilesh", phone: "7908686330", lines: ["मुख्य बाज़ार, Pandhana", "East Nimar, Madhya Pradesh 450661"] },
};

function packingFor(name: string, address: string) {
  return {
    ...SAMPLE_PACKING_DATA,
    receiver: {
      ...SAMPLE_PACKING_DATA.receiver,
      name,
      lines: [address, "Kozhikode, Kerala", "- 673001"],
      street: address,
    },
  };
}

describe("native canvas loader", () => {
  it("resolves @napi-rs/canvas from the project root, not a virtual /ROOT/ filename", () => {
    expect(canvasRequireFrom()).toBe(path.join(process.cwd(), "package.json"));
    expect(typeof loadCanvas().createCanvas).toBe("function");
  });
});

describe("unicode label text helpers", () => {
  it("keeps NFC, ZWJ and ZWNJ and drops bidi overrides", () => {
    const zwj = "क्\u200dष";
    expect(sanitizeLabelText(`\u202E${zwj}`)).toBe(zwj);
    expect(sanitizeLabelText("നിജില\u0000")).toBe("നിജില");
  });

  it("segments mixed Malayalam, Latin and Devanagari", () => {
    const runs = segmentScriptRuns("നിജിലാ Nijila निजिला");
    expect(runs.map((run) => run.script)).toEqual(["malayalam", "latin", "devanagari"]);
  });

  it("shapes Malayalam and Devanagari conjuncts narrower than unjoined letters", () => {
    expect(measureShapedText("ക്ക", 12)).toBeLessThan(measureShapedText("കക", 12));
    expect(measureShapedText("ക്ഷ", 12)).toBeGreaterThan(8);
    expect(measureShapedText("റ്റ", 12)).toBeLessThan(measureShapedText("റ്റ് റ", 12) + 1);
    expect(measureShapedText("क्ष", 12)).toBeLessThan(measureShapedText("कष", 12));
    expect(measureShapedText("त्र", 12)).toBeGreaterThan(4);
    expect(measureShapedText("ज्ञ", 12)).toBeGreaterThan(4);
    expect(measureShapedText("க்ஷ", 12)).toBeGreaterThan(4);
  });

  it("does not use Helvetica measurement for Indic text", () => {
    expect(needsUnicodePaint("നിജില")).toBe(true);
    expect(needsUnicodePaint("Nijila NM")).toBe(false);
    expect(measurePaintText("നിജില", 9)).toBeGreaterThan(10);
  });
});

describe("unicode Postbus PDFs", () => {
  it("keeps Devanagari on receipts instead of stripping it", async () => {
    const pdf = await renderReceiptPdf(receiptBase);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(pdf);
    expect(loaded.getPages()[0].getSize().width).toBeGreaterThan(400);
    expect(loaded.getPages()[0].node.normalizedEntries().XObject).toBeTruthy();
  });

  it("renders every supported script on custom labels, packing slips and invoices", async () => {
    mkdirSync(SAMPLES, { recursive: true });
    const template = indiaPostLabelTemplate();
    for (const [script, name, address] of SCRIPT_LINES) {
      const data = packingFor(name, address);
      const label = await renderMerchantLabelPdf(template, data);
      const slip = await renderPackingSlipPdf(data);
      const invoice = await renderInvoicePdf({
        ...SAMPLE_INVOICE_DATA,
        shipping: { ...SAMPLE_INVOICE_DATA.shipping, name, lines: [address] },
        billing: { ...SAMPLE_INVOICE_DATA.billing, name, lines: [address] },
        customer: { ...SAMPLE_INVOICE_DATA.customer, name, lines: [address] },
      });
      expect(Buffer.from(label).subarray(0, 4).toString()).toBe("%PDF");
      expect(Buffer.from(slip).subarray(0, 4).toString()).toBe("%PDF");
      expect(Buffer.from(invoice).subarray(0, 4).toString()).toBe("%PDF");
      const labelPdf = await PDFDocument.load(label);
      expect(labelPdf.getPages()).toHaveLength(1);
      if (script !== "english") {
        expect(labelPdf.getPages()[0].node.normalizedEntries().XObject).toBeTruthy();
      }
      const preview = rasterizeShapedLine({
        text: `${name} ${address}`,
        fontSizePt: 14,
        color: { r: 0.07, g: 0.09, b: 0.15 },
      });
      writeFileSync(path.join(SAMPLES, `${script}.png`), preview.png);
      writeFileSync(path.join(SAMPLES, `${script}-label.pdf`), Buffer.from(label));
      expect(preview.widthPt).toBeGreaterThan(12);
    }
  }, 60_000);

  it("keeps English custom-label geometry and Helvetica for ASCII", async () => {
    const bytes = await renderMerchantLabelPdf(indiaPostLabelTemplate(), SAMPLE_PACKING_DATA);
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[0];
    expect(Math.round(page.getSize().width)).toBe(Math.round(indiaPostLabelTemplate().page.widthPt));
    expect(needsUnicodePaint("Priya Nair")).toBe(false);
  });
});
