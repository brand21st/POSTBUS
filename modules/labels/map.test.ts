import { describe, expect, it } from "vitest";
import { mapLabelRow, trackingIdFromShipment } from "@/modules/labels/map";

describe("mapLabelRow", () => {
  it("puts the India Post article id on the label row", () => {
    const mapped = mapLabelRow({
      id: "label-1",
      status: "READY",
      shipments: {
        barcode: "CL214330016IN",
        tracking_number: null,
        orders: { order_number: "#1001" },
      },
      print_jobs: [{ status: "PENDING", created_at: "2026-09-23T00:00:00Z" }],
    });

    expect(mapped.trackingNumber).toBe("CL214330016IN");
    expect(mapped.tracking_number).toBe("CL214330016IN");
    expect(mapped.orderNumber).toBe("#1001");
    expect(mapped.printStatus).toBe("WAITING");
  });

  it("falls back to tracking_number when barcode is empty", () => {
    expect(trackingIdFromShipment({ barcode: "  ", tracking_number: "CL556974704IN" })).toBe(
      "CL556974704IN"
    );
  });
});
