import { describe, expect, it } from "vitest";
import { patchSettingsSchema } from "@/modules/support/schema";

describe("patchSettingsSchema", () => {
  it("accepts enable or mode without a client-supplied provider secret", () => {
    expect(patchSettingsSchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(patchSettingsSchema.parse({ mode: "postbus_global" })).toEqual({ mode: "postbus_global" });
  });

  it("rejects an empty patch", () => {
    expect(() => patchSettingsSchema.parse({})).toThrow();
  });
});
