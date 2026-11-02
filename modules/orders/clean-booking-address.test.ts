import { describe, expect, it } from "vitest";
import { cleanBookingAddressLines } from "./clean-booking-address";

describe("cleanBookingAddressLines", () => {
  it("removes a repeated locality and leaves the house number", () => {
    const cleaned = cleanBookingAddressLines({
      line1: "House 22, , Main Road, Main Road, Kalpetta, , Wayanad",
    });
    expect(cleaned?.line1).toContain("House 22");
    expect(cleaned?.line1).toContain("Main Road");
    expect(cleaned?.line1.match(/Main Road/g)).toHaveLength(1);
    expect(cleaned?.changed.line1).toBe(true);
  });

  it("leaves a clean line alone", () => {
    expect(cleanBookingAddressLines({ line1: "House 22, Main Road", line2: "Near temple" })).toBeNull();
  });
});
