import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { officialAddressLines, overlayIndiaPostPartyBox } from "@/modules/labels/official-address";

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
});
