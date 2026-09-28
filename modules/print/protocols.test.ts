import { describe, expect, it } from "vitest";
import { detectPrintProtocol } from "@/modules/print/protocols/detect";
import { protocolFor, tsplProtocol } from "@/modules/print/protocols/registry";
import { labelRasterPlan, packMonoBitmap } from "@/modules/print/raster-plan";

const bulk = [{ interfaceClass: 0xff, hasBulkOut: true }];

describe("print protocols and raster", () => {
  it("uses TSPL for a named Xprinter label printer and nothing for an unknown device", () => {
    expect(
      detectPrintProtocol({
        vendorId: 0x0483,
        productId: 0x5740,
        productName: "Xprinter XP-420B",
        interfaces: bulk,
      })?.protocol
    ).toBe("tspl");
    expect(
      detectPrintProtocol({
        vendorId: 0x0483,
        productId: 0x5740,
        productName: "XP-80",
        interfaces: bulk,
      })
    ).toBeNull();
    expect(
      detectPrintProtocol({
        vendorId: 0x1234,
        productId: 0x5678,
        productName: "Office Laser",
        interfaces: bulk,
      })
    ).toBeNull();
    expect(protocolFor("zpl")?.implemented).toBe(false);
    expect(protocolFor("escpos")?.implemented).toBe(false);
  });

  it("builds a TSPL test page without a tracking barcode", () => {
    const page = new TextDecoder().decode(tsplProtocol.prepareTestPage());
    expect(page).toContain("PostBus test");
    expect(page).not.toMatch(/\b[A-Z]{2}\d{9}IN\b/);
  });

  it("packs label pixels 1:1 and refuses a page wider than the printer", () => {
    const widthPt = (105 * 72) / 25.4;
    const heightPt = (148 * 72) / 25.4;
    const plan = labelRasterPlan({ widthPt, heightPt, maxWidthMm: 108 });
    expect(plan.scaleX).toBe(plan.scaleY);
    expect(plan.widthMm).toBeCloseTo(105, 5);
    expect(plan.heightMm).toBeCloseTo(148, 5);
    expect(plan.paddedWidthPx % 8).toBe(0);
    expect(() => labelRasterPlan({ widthPt, heightPt, maxWidthMm: 100 })).toThrow(/not resized/);

    const black = new Uint8ClampedArray(8 * 4);
    for (let index = 0; index < 8; index += 1) black[index * 4 + 3] = 255;
    expect(packMonoBitmap(black, 8, 1, 8)[0]).toBe(0xff);

    const white = new Uint8ClampedArray(8 * 4).fill(255);
    expect(packMonoBitmap(white, 8, 1, 8)[0]).toBe(0);

    const bitmap = tsplProtocol.prepareLabelBitmap({
      rgba: black,
      widthPx: 8,
      heightPx: 1,
      paddedWidthPx: 8,
      widthMm: plan.widthMm,
      heightMm: plan.heightMm,
      copies: 1,
    });
    const header = new TextDecoder().decode(bitmap.slice(0, 80));
    expect(header).toContain("BITMAP 0,0,1,1,0,");
    expect(bitmap.length).toBeGreaterThan(80);
  });
});
