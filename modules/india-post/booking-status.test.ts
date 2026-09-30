import { describe, expect, it } from "vitest";
import {
  isIndiaPostAcceptedStatus,
  isIndiaPostBookingInFlight,
} from "@/modules/india-post/booking-status";

describe("India Post booking statuses", () => {
  it("treats booked later states as accepted so they are not rebooked", () => {
    expect(isIndiaPostAcceptedStatus("BOOKED")).toBe(true);
    expect(isIndiaPostAcceptedStatus("LABEL_PENDING")).toBe(true);
    expect(isIndiaPostAcceptedStatus("LABEL_READY")).toBe(true);
    expect(isIndiaPostAcceptedStatus("QUEUED")).toBe(false);
    expect(isIndiaPostAcceptedStatus("FAILED")).toBe(false);
  });

  it("marks queue, booking, and label generation as in flight", () => {
    expect(isIndiaPostBookingInFlight("QUEUED")).toBe(true);
    expect(isIndiaPostBookingInFlight("BOOKING")).toBe(true);
    expect(isIndiaPostBookingInFlight("LABEL_PENDING")).toBe(true);
    expect(isIndiaPostBookingInFlight("LABEL_READY")).toBe(false);
    expect(isIndiaPostBookingInFlight("BOOKED")).toBe(false);
  });
});
