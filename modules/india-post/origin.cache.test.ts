import { describe, expect, it } from "vitest";
import { cachedOfficeLookup } from "@/modules/india-post/origin";

describe("cachedOfficeLookup", () => {
  it("calls the India Post pincode search once per unique pin", async () => {
    const calls: string[] = [];
    const lookup = cachedOfficeLookup({
      async searchPostOffices(pin) {
        calls.push(pin);
        return [{ office_id: "1", office_name: pin, pincode: pin }];
      },
    });
    await Promise.all([
      lookup.searchPostOffices("682311"),
      lookup.searchPostOffices("682311"),
      lookup.searchPostOffices("626003"),
    ]);
    expect(calls).toEqual(["682311", "626003"]);
  });
});
