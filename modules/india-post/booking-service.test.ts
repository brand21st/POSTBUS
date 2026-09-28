import { describe, expect, it } from "vitest";
import {
  resolveOrderBookingService,
  shipmentServiceLocked,
} from "@/modules/india-post/booking-service";

describe("resolveOrderBookingService", () => {
  it("uses the order pin ahead of the top bar and the India Post default", () => {
    expect(
      resolveOrderBookingService({
        orderService: "SP_INLAND_PARCEL",
        workspaceOverride: "BUSINESS_PARCEL",
        defaultService: "BUSINESS_PARCEL",
      })
    ).toBe("SP_INLAND_PARCEL");
  });

  it("uses the top-bar choice when the order is not pinned", () => {
    expect(
      resolveOrderBookingService({
        orderService: null,
        workspaceOverride: "SP_INLAND_PARCEL",
        defaultService: "BUSINESS_PARCEL",
      })
    ).toBe("SP_INLAND_PARCEL");
  });

  it("uses the India Post default when the top bar is Default", () => {
    expect(
      resolveOrderBookingService({
        orderService: null,
        workspaceOverride: null,
        defaultService: "BUSINESS_PARCEL",
      })
    ).toBe("BUSINESS_PARCEL");
  });

  it("ignores Speed Post document and falls back to Speed Post parcel", () => {
    expect(
      resolveOrderBookingService({
        orderService: "SP_INLAND_DOC",
        workspaceOverride: "SP_INLAND_DOC",
        defaultService: "SP_INLAND_DOC",
      })
    ).toBe("SP_INLAND_PARCEL");
  });
});

describe("shipmentServiceLocked", () => {
  it("lets queued and failed shipments change service", () => {
    expect(shipmentServiceLocked("QUEUED")).toBe(false);
    expect(shipmentServiceLocked("FAILED")).toBe(false);
    expect(shipmentServiceLocked(null)).toBe(false);
  });

  it("keeps a booked shipment on the service already sent", () => {
    expect(shipmentServiceLocked("BOOKED")).toBe(true);
    expect(shipmentServiceLocked("LABEL_READY")).toBe(true);
  });
});
