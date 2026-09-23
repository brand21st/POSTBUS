import { describe, expect, it } from "vitest";
import { mapLabelRow, trackingIdFromShipment } from "@/modules/labels/map";
import { pickOfficialPreviewLabel } from "@/modules/labels/preview-pick";

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
      kind: "INDIA_POST",
    });

    expect(mapped.trackingNumber).toBe("CL214330016IN");
    expect(mapped.tracking_number).toBe("CL214330016IN");
    expect(mapped.orderNumber).toBe("#1001");
    expect(mapped.printStatus).toBe("WAITING");
    expect(mapped.kind).toBe("INDIA_POST");
  });

  it("falls back to tracking_number when barcode is empty", () => {
    expect(trackingIdFromShipment({ barcode: "  ", tracking_number: "CL556974704IN" })).toBe(
      "CL556974704IN"
    );
  });

  it("exposes the stored file URL for preview", () => {
    const mapped = mapLabelRow({
      id: "label-1",
      status: "READY",
      kind: "INDIA_POST",
      file_url: "https://example.com/india-post.pdf",
    });
    expect(mapped.fileUrl).toBe("https://example.com/india-post.pdf");
    expect(mapped.file_url).toBe("https://example.com/india-post.pdf");
  });

  it("prefers an official label that already has a file URL", () => {
    const picked = pickOfficialPreviewLabel([
      { kind: "INDIA_POST", status: "READY", file_url: null },
      { kind: "INDIA_POST", status: "READY", file_url: "https://example.com/label.pdf" },
    ]);
    expect(picked?.file_url).toBe("https://example.com/label.pdf");
  });
});
