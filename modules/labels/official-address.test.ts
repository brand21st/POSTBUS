import { describe, expect, it } from "vitest";
import { officialAddressLines } from "@/modules/labels/official-address";

describe("officialAddressLines", () => {
  it("keeps street, city, pin and phone", () => {
    expect(
      officialAddressLines({
        line1: "House 12, MG Road",
        line2: "Near Metro",
        line3: "Ward 4",
        city: "Kochi",
        state: "Kerala",
        pin: "683565",
        mobile: "9876543210",
      })
    ).toEqual(["House 12, MG Road", "Near Metro", "Ward 4", "Kochi, Kerala", "- 683565", "Ph: 9876543210"]);
  });
});
