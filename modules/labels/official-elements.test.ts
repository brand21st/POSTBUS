import { describe, expect, it } from "vitest";
import { coveredOfficialElements, mapOfficialRect, visibleOfficialElements } from "@/modules/labels/official-elements";

describe("official label elements", () => {
  it("hides the QR code from the editor and covers it on compose", () => {
    expect(visibleOfficialElements().some((item) => item.id === "qrCode")).toBe(false);
    const qr = coveredOfficialElements().find((item) => item.id === "qrCode");
    expect(qr?.coverOnCompose).toBe(true);
    const mapped = mapOfficialRect(qr!, { x: 0, y: 0, width: 297.64, height: 419.53 });
    expect(mapped.width).toBeGreaterThan(80);
    expect(mapped.x).toBeLessThan(40);
    expect(mapped.y).toBeGreaterThan(140);
  });
});
