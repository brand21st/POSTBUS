import { afterEach, describe, expect, it } from "vitest";
import {
  assertTrackingP0CanaryQuery,
  filterTrackingP0CanaryShipments,
  isTrackingP0CanaryAwb,
  isTrackingP0CanaryOrganization,
  trackingP0CanaryActive,
  TRACKING_P0_CANARY_AWB_MAX,
} from "@/modules/india-post/tracking-p0-canary";

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("tracking P0 canary isolation", () => {
  afterEach(() => {
    delete process.env.INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID;
    delete process.env.INDIA_POST_TRACKING_P0_CANARY_AWBS;
    delete process.env.INDIA_POST_TRACKING_P0_CANARY_SIDE_EFFECTS;
  });

  it("is off by default so the fleet stays on legacy tracking", () => {
    expect(trackingP0CanaryActive()).toBe(false);
    expect(isTrackingP0CanaryOrganization(ORG)).toBe(false);
  });

  it("allows at most 5 AWBs and ignores other organizations", () => {
    process.env.INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID = ORG;
    process.env.INDIA_POST_TRACKING_P0_CANARY_AWBS = "AW1,AW2,AW3,AW4,AW5,AW6";
    expect(isTrackingP0CanaryOrganization(ORG.toUpperCase())).toBe(true);
    expect(isTrackingP0CanaryOrganization("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).toBe(false);
    expect(isTrackingP0CanaryAwb(ORG, "aw1")).toBe(true);
    expect(isTrackingP0CanaryAwb(ORG, "AW6")).toBe(false);
    const rows = filterTrackingP0CanaryShipments(ORG, [
      { barcode: "AW1" },
      { barcode: "OTHER" },
      { barcode: "AW6" },
    ]);
    expect(rows).toEqual([{ barcode: "AW1" }]);
    expect(TRACKING_P0_CANARY_AWB_MAX).toBe(5);
  });

  it("refuses queries outside the allowlist", () => {
    process.env.INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID = ORG;
    process.env.INDIA_POST_TRACKING_P0_CANARY_AWBS = "AW1,AW2";
    expect(() => assertTrackingP0CanaryQuery(ORG, ["AW1", "AW9"])).toThrow(/allowlist/);
    expect(() => assertTrackingP0CanaryQuery("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", ["AW1"])).toThrow(
      /not the tracking P0 canary/
    );
  });
});
