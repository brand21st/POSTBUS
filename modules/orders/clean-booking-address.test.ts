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

  it("drops a building name that was copied onto the next line", () => {
    const cleaned = cleanBookingAddressLines({
      line1: "Flat.No.28, Door.No.4A, Dhanalakshmi Apartments, Secretariat Colony, City Limit Road",
      line2: "near to NGO Colony Bus Depot, Dhanalakshmi Apartments",
    });
    expect(cleaned?.line1).toContain("Dhanalakshmi Apartments");
    expect(cleaned?.line1.match(/Dhanalakshmi Apartments/gi)).toHaveLength(1);
    expect(cleaned?.line2).toContain("NGO Colony");
    expect(cleaned?.line2).not.toContain("Dhanalakshmi");
    expect(`${cleaned?.line1} ${cleaned?.line2}`.match(/Dhanalakshmi Apartments/gi)).toHaveLength(1);
  });

  it("drops a repeated building name that is not its own comma piece", () => {
    const cleaned = cleanBookingAddressLines({
      line1: "Flat.No.28, Door.No.4A Dhanalakshmi Apartments, Secretariat Colony",
      line2: "near to NGO Colony Bus Depot Dhanalakshmi Apartments",
    });
    expect(`${cleaned?.line1} ${cleaned?.line2}`.match(/Dhanalakshmi Apartments/gi)).toHaveLength(1);
    expect(`${cleaned?.line1} ${cleaned?.line2}`).toContain("NGO Colony");
    expect(`${cleaned?.line1} ${cleaned?.line2}`).toContain("Secretariat Colony");
  });
});
