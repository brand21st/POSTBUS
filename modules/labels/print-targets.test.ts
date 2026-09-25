import { describe, expect, it } from "vitest";
import { paperSizeForLabelKind, shipmentPrintJobs, shipmentPrintLabel } from "@/modules/labels/print-targets";

describe("shipment print targets", () => {
  it("sends the barcode to A6 and the packing slip to A4", () => {
    expect(paperSizeForLabelKind("INDIA_POST")).toBe("A6");
    expect(paperSizeForLabelKind("MERCHANT")).toBe("A4");
    expect(
      shipmentPrintJobs(
        { id: "bar-1", indiaPostLabelId: "bar-1", packingLabelId: "pack-1", kind: "INDIA_POST" },
        "both"
      )
    ).toEqual([
      { id: "bar-1", paperSize: "A6", kind: "barcode" },
      { id: "pack-1", paperSize: "A4", kind: "packing" },
    ]);
  });

  it("uses Print both when both documents are ready", () => {
    expect(
      shipmentPrintLabel({ id: "bar-1", indiaPostLabelId: "bar-1", packingLabelId: "pack-1" })
    ).toBe("Print both");
    expect(shipmentPrintLabel({ id: "bar-1", indiaPostLabelId: "bar-1" })).toBe("Print barcode");
  });
});
