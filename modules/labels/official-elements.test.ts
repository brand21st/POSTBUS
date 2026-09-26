import { describe, expect, it } from "vitest";
import { rectsOverlap } from "@/modules/labels/collision";
import {
  coveredOfficialElements,
  indiaPostPartyOverlayRect,
  mapOfficialRect,
  officialElement,
  visibleOfficialElements,
} from "@/modules/labels/official-elements";
import { officialDrawRect, pagePreset } from "@/modules/labels/page-presets";

describe("official label elements", () => {
  it("hides the QR code from the editor and covers it on compose", () => {
    expect(visibleOfficialElements().some((item) => item.id === "qrCode")).toBe(false);
    const qr = coveredOfficialElements().find((item) => item.id === "qrCode");
    expect(qr?.coverOnCompose).toBe(true);
    const mapped = mapOfficialRect(qr!, { x: 0, y: 0, width: 297.64, height: 419.53 });
    expect(mapped.width).toBeGreaterThan(80);
    expect(mapped.x).toBeLessThan(40);
    expect(mapped.y).toBeGreaterThan(120);
  });

  it("places the address rewrite to the right of the QR and above the booking footer", () => {
    const a6 = pagePreset("A6");
    const pages = [
      { width: a6.widthPt, height: a6.heightPt },
      { width: 288, height: 432 },
    ];
    for (const page of pages) {
      const placed = officialDrawRect(page.width, page.height);
      const qr = mapOfficialRect(officialElement("qrCode"), placed);
      const booking = mapOfficialRect(officialElement("bookingInfo"), placed);
      const pin = mapOfficialRect(officialElement("pinRange"), placed);
      const receiver = mapOfficialRect(officialElement("receiver"), placed);
      const sender = mapOfficialRect(officialElement("sender"), placed);
      const party = indiaPostPartyOverlayRect(page.width, page.height);
      expect(rectsOverlap(party, qr, 2)).toBe(false);
      expect(rectsOverlap(party, booking, 2)).toBe(false);
      expect(rectsOverlap(party, pin, 0)).toBe(false);
      expect(party.x).toBeGreaterThanOrEqual(qr.x + qr.width + 6);
      expect(party.y).toBeGreaterThanOrEqual(booking.y + booking.height);
      expect(party.x).toBeLessThanOrEqual(sender.x);
      expect(party.y).toBeLessThanOrEqual(sender.y);
      expect(party.x + party.width).toBeGreaterThanOrEqual(receiver.x + receiver.width);
      expect(party.y + party.height).toBeGreaterThanOrEqual(receiver.y + receiver.height);
      expect(party.y + party.height).toBeLessThanOrEqual(pin.y + 0.01);
    }
  });
});
