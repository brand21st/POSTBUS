import { describe, expect, it } from "vitest";
import { returnPolicyLabel, summarizeReturnPolicy } from "@/modules/products/return-policy";

describe("product return policy", () => {
  it("labels return available and no return", () => {
    expect(returnPolicyLabel(true)).toBe("Return Available");
    expect(returnPolicyLabel(false)).toBe("No Return");
  });

  it("summarizes mixed cart policies", () => {
    expect(summarizeReturnPolicy([true, true]).label).toBe("Return Available");
    expect(summarizeReturnPolicy([false, false]).label).toBe("No Return");
    expect(summarizeReturnPolicy([true, false]).kind).toBe("mixed");
  });
});
