import { afterEach, describe, expect, it } from "vitest";
import { isStrictParcelDimensionsOrg, strictParcelDimensionsOrgAllowlist } from "@/modules/shopify/strict-parcel-dimensions";

const ORG = "d49a7ffc-c84f-45ba-a4c9-057e79453742";

afterEach(() => {
  delete process.env.POSTBUS_STRICT_PARCEL_DIMENSIONS_ORG_IDS;
});

describe("strict parcel dimension rollout", () => {
  it("keeps every merchant on the live fill when the allowlist is empty", () => {
    expect(strictParcelDimensionsOrgAllowlist("")).toEqual([]);
    expect(isStrictParcelDimensionsOrg(ORG)).toBe(false);
  });

  it("enables only listed organizations", () => {
    process.env.POSTBUS_STRICT_PARCEL_DIMENSIONS_ORG_IDS = `${ORG}, other`;
    expect(isStrictParcelDimensionsOrg(ORG)).toBe(true);
    expect(isStrictParcelDimensionsOrg("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(false);
  });

  it("opens every organization only when * is set", () => {
    process.env.POSTBUS_STRICT_PARCEL_DIMENSIONS_ORG_IDS = "*";
    expect(isStrictParcelDimensionsOrg(ORG)).toBe(true);
  });
});
