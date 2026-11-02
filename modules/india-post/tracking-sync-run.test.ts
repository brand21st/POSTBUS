import { afterEach, describe, expect, it, vi } from "vitest";
import { runOrganizationTrackingSync } from "@/modules/india-post/tracking-sync-run";

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("runOrganizationTrackingSync canary vs legacy", () => {
  afterEach(() => {
    delete process.env.INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID;
    delete process.env.INDIA_POST_TRACKING_P0_CANARY_AWBS;
    delete process.env.INDIA_POST_TRACKING_P0_CANARY_SIDE_EFFECTS;
  });

  it("does not call CEPT when the canary org has no AWB allowlist", async () => {
    process.env.INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID = ORG;
    const trackShipment = vi.fn();
    const result = await runOrganizationTrackingSync({} as never, {
      organizationId: ORG,
      provider: { trackShipment },
    });
    expect(result.mode).toBe("canary-idle");
    expect(trackShipment).not.toHaveBeenCalled();
  });

  it("uses isolateFailures only for allowlisted canary AWBs", async () => {
    process.env.INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID = ORG;
    process.env.INDIA_POST_TRACKING_P0_CANARY_AWBS = "AW-CANARY";
    const trackShipment = vi.fn(async () => ({ data: [], outcomes: [{ barcode: "AW-CANARY", status: "absent" }] }));
    const updates: string[] = [];
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              not() {
                return this;
              },
              in() {
                return this;
              },
              or() {
                return this;
              },
              order() {
                return this;
              },
              limit: async () => ({
                data: [
                  { id: "s1", barcode: "AW-CANARY" },
                  { id: "s2", barcode: "AW-OTHER" },
                ],
              }),
            };
          },
          update() {
            return {
              eq(column: string, value: string) {
                if (column === "id") updates.push(value);
                return this;
              },
            };
          },
        };
      },
    };
    const result = await runOrganizationTrackingSync(supabase as never, {
      organizationId: ORG,
      provider: { trackShipment },
    });
    expect(result.mode).toBe("canary");
    expect(trackShipment).toHaveBeenCalledWith(["AW-CANARY"], expect.objectContaining({ isolateFailures: true }));
    expect(updates).toEqual(["s1"]);
  });

  it("keeps legacy isolateFailures false for non-canary organizations", async () => {
    process.env.INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID = ORG;
    process.env.INDIA_POST_TRACKING_P0_CANARY_AWBS = "AW-CANARY";
    const trackShipment = vi.fn(async () => ({ data: [] }));
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              not() {
                return this;
              },
              in() {
                return this;
              },
              or() {
                return this;
              },
              order() {
                return this;
              },
              limit: async () => ({ data: [{ id: "s9", barcode: "AW-FLEET" }] }),
            };
          },
          update() {
            return {
              eq() {
                return this;
              },
            };
          },
        };
      },
    };
    const result = await runOrganizationTrackingSync(supabase as never, {
      organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      provider: { trackShipment },
    });
    expect(result.mode).toBe("legacy");
    expect(trackShipment).toHaveBeenCalledWith(["AW-FLEET"], { isolateFailures: false });
  });
});
