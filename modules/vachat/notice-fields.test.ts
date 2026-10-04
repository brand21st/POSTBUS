import { describe, expect, it } from "vitest";
import { vachatAddressParam, vachatAmountParam, vachatSingleLine } from "@/modules/vachat/notice-fields";

describe("vachat notice fields", () => {
  it("formats money without a trailing .00", () => {
    expect(vachatAmountParam("238.00")).toBe("238");
    expect(vachatAmountParam(238.5)).toBe("238.50");
    expect(vachatAmountParam(null)).toBe("");
  });

  it("joins a delivery address onto one line", () => {
    expect(
      vachatAddressParam({
        line1: "Christian College Road",
        line2: "Bus stop",
        city: "Allapuzha",
        state: "Kerala",
        pincode: "689122",
      })
    ).toBe("Christian College Road, Bus stop, Allapuzha, Kerala, 689122");
  });

  it("strips line breaks from template values", () => {
    expect(vachatSingleLine("Ada\nDas")).toBe("Ada Das");
  });
});
