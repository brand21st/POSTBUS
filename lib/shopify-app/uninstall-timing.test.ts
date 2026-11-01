import { describe, expect, it } from "vitest";
import { isStaleUninstall } from "@/lib/shopify-app/uninstall-timing";

describe("stale uninstall detection", () => {
  it("ignores an uninstall that happened before the current install", () => {
    expect(
      isStaleUninstall("2026-10-01T00:00:00.000Z", "2026-10-20T00:00:00.000Z")
    ).toBe(true);
  });

  it("applies an uninstall that happened after the current install", () => {
    expect(
      isStaleUninstall("2026-10-20T12:00:00.000Z", "2026-10-20T00:00:00.000Z")
    ).toBe(false);
  });

  it("does not treat missing timestamps as stale", () => {
    expect(isStaleUninstall(null, "2026-10-20T00:00:00.000Z")).toBe(false);
    expect(isStaleUninstall("2026-10-20T00:00:00.000Z", null)).toBe(false);
  });
});
