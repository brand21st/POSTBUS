import { describe, expect, it } from "vitest";
import { existingShipmentConflict } from "@/modules/shipments/existing-shipment-conflict";

describe("existingShipmentConflict", () => {
  it("returns the booking decision so the screen can open Force book", () => {
    const error = existingShipmentConflict([
      {
        orderId: "order-1",
        shipmentId: "ship-1",
        action: "BOOKING_OUTCOME_UNKNOWN",
        reason: "Booking outcome could not be confirmed. Please contact support before retrying.",
      },
    ]);
    expect(error.message).toContain("could not be confirmed");
    expect(error.details).toEqual({
      action: "BOOKING_OUTCOME_UNKNOWN",
      shipmentId: "ship-1",
      orderId: "order-1",
    });
  });

  it("keeps a link when the only fact is that a shipment already exists", () => {
    const error = existingShipmentConflict([{ orderId: "order-1", shipmentId: "ship-1" }]);
    expect(error.message).toContain("already has a shipment");
    expect(error.details).toMatchObject({ shipmentId: "ship-1", orderId: "order-1" });
  });
});
