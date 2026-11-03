import { describe, expect, it } from "vitest";
import { orderVisibleStatus } from "@/components/dashboard/status-badge";

describe("orderVisibleStatus", () => {
  it("shows Failed when booking failed while the order is still Processing", () => {
    expect(orderVisibleStatus({ status: "PROCESSING", shipment: { status: "FAILED" } })).toBe("FAILED");
  });

  it("keeps Processing while the shipment is still booking", () => {
    expect(orderVisibleStatus({ status: "PROCESSING", shipment: { status: "BOOKING" } })).toBe("PROCESSING");
    expect(orderVisibleStatus({ status: "PROCESSING", shipment: { status: "QUEUED" } })).toBe("PROCESSING");
    expect(orderVisibleStatus({ status: "PROCESSING", shipment: { status: "VALIDATING" } })).toBe("PROCESSING");
    expect(orderVisibleStatus({ status: "PROCESSING", shipment: { status: "RECOVERY_REQUIRED" } })).toBe(
      "PROCESSING"
    );
  });

  it("leaves other order statuses unchanged", () => {
    expect(orderVisibleStatus({ status: "READY", shipment: { status: "FAILED" } })).toBe("READY");
    expect(orderVisibleStatus({ status: "BOOKED" })).toBe("BOOKED");
  });
});
