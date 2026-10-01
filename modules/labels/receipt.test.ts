import { describe, expect, it } from "vitest";
import { renderReceiptPdf, type ReceiptData } from "@/modules/labels/receipt";

const sample: ReceiptData = {
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

describe("renderReceiptPdf", () => {
  it("renders a PDF and drops characters Helvetica cannot encode", async () => {
    const pdf = await renderReceiptPdf(sample);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("renders when India Post has not reported tariff or invoice yet", async () => {
    const pdf = await renderReceiptPdf({ ...sample, invoiceNo: "", tariff: null, codAmount: 0, paymentMode: "PREPAID" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
