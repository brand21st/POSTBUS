import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { officialAddressLines, overlayIndiaPostPartyBox } from "@/modules/labels/official-address";
import { indiaPostPartyOverlayRect, officialElement } from "@/modules/labels/official-elements";
import { pagePreset } from "@/modules/labels/page-presets";

const SAMPLE_BOX = {
  receiverName: "CLINT VARGHESE",
  receiverLines: ["Varghese.", "Kochi, Kerala", "- 683565", "Ph: 9605658104"],
  senderName: "AURIMO BY NISH",
  senderLines: ["Ernakulam, Kerala", "- 682311", "Ph: 9605658104"],
  paymentLabel: "Prepaid",
};

describe("officialAddressLines", () => {
  it("keeps street, city, pin and phone", () => {
    expect(
      officialAddressLines({
        line1: "House 12, MG Road",
        line2: "Near Metro",
        city: "Kochi",
        state: "Kerala",
        pin: "683565",
        mobile: "9876543210",
      })
    ).toEqual(["House 12, MG Road", "Near Metro", "Kochi, Kerala", "- 683565", "Ph: 9876543210"]);
  });
});

describe("overlayIndiaPostPartyBox", () => {
  it("keeps a single official page and draws Prepaid", async () => {
    const source = await PDFDocument.create();
    source.addPage([297.64, 419.53]).drawText("CEPT", { x: 20, y: 200, size: 10 });
    const bytes = await overlayIndiaPostPartyBox(await source.save(), {
      receiverName: "Clint Varghese",
      receiverLines: ["House 12", "Kochi, Kerala", "- 683565", "Ph: 9876543210"],
      senderName: "Aurimo by Nish",
      senderLines: ["NH 85", "Ernakulam, Kerala", "- 682311", "Ph: 9000000000"],
      paymentLabel: "Prepaid",
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("keeps the rewrite box on a 4x6 page without stretching into the QR", async () => {
    const source = await PDFDocument.create();
    source.addPage([288, 432]).drawText("CEPT", { x: 20, y: 200, size: 10 });
    const bytes = await overlayIndiaPostPartyBox(await source.save(), {
      receiverName: "Clint Varghese",
      receiverLines: ["House 12", "Kochi, Kerala", "- 683565", "Ph: 9876543210"],
      senderName: "Aurimo by Nish",
      senderLines: ["NH 85", "Ernakulam, Kerala", "- 682311", "Ph: 9000000000"],
      paymentLabel: "Prepaid",
    });
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("keeps RECEIVER text to the right of the QR and above the booking box", async () => {
    const a6 = pagePreset("A6");
    const source = await PDFDocument.create();
    const page = source.addPage([a6.widthPt, a6.heightPt]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    const qr = officialElement("qrCode");
    const booking = officialElement("bookingInfo");
    const pin = officialElement("pinRange");
    page.drawRectangle({ x: 0, y: 0, width: a6.widthPt, height: a6.heightPt, color: rgb(1, 1, 1) });
    page.drawRectangle({
      x: qr.x,
      y: qr.y,
      width: qr.width,
      height: qr.height,
      color: rgb(0.12, 0.12, 0.12),
    });
    page.drawRectangle({
      x: pin.x,
      y: pin.y,
      width: pin.width,
      height: pin.height,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.8,
    });
    page.drawText("682311 - 683565", { x: pin.x + 70, y: pin.y + 6, size: 9, font, color: rgb(0, 0, 0) });
    page.drawRectangle({
      x: booking.x,
      y: booking.y,
      width: booking.width,
      height: booking.height,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.8,
    });
    page.drawText("Kolenchery SO (682311)", { x: booking.x + 6, y: booking.y + booking.height - 14, size: 8, font });
    const bytes = await overlayIndiaPostPartyBox(await source.save(), SAMPLE_BOX);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise;
    const pdfPage = await pdf.getPage(1);
    const text = await pdfPage.getTextContent();
    const items = text.items.filter((item): item is { str: string; transform: number[] } => "str" in item && "transform" in item);
    const receiver = items.find((item) => item.str.includes("RECEIVER"));
    const sender = items.find((item) => item.str.includes("SENDER"));
    expect(receiver).toBeTruthy();
    expect(sender).toBeTruthy();
    const overlay = indiaPostPartyOverlayRect(a6.widthPt, a6.heightPt);
    const receiverX = receiver!.transform[4];
    const receiverY = receiver!.transform[5];
    expect(receiverX).toBeGreaterThan(qr.x + qr.width);
    expect(receiverX).toBeGreaterThanOrEqual(overlay.x - 1);
    expect(receiverY).toBeGreaterThan(booking.y + booking.height);
    expect(receiverY).toBeLessThan(pin.y);
    expect(receiverY).toBeGreaterThanOrEqual(overlay.y);
    expect(receiverY).toBeLessThanOrEqual(overlay.y + overlay.height);
  });
});
