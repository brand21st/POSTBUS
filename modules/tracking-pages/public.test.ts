import { describe, expect, it, vi } from "vitest";
import { apexTrackingPage } from "./apex";
import { resolveRequestSubdomain } from "./public";

describe("resolveRequestSubdomain", () => {
  it("prefers the merchant label from the host", () => {
    expect(resolveRequestSubdomain("priya.postbus.in", null, null)).toBe("priya");
  });

  it("returns null on the PostBus apex host", () => {
    expect(resolveRequestSubdomain("www.postbus.in", null, null)).toBeNull();
  });

  it("falls back to explicit subdomain values", () => {
    expect(resolveRequestSubdomain("www.postbus.in", null, "priya")).toBe("priya");
    expect(resolveRequestSubdomain("www.postbus.in", null, null, "priya")).toBe("priya");
  });
});

describe("apexTrackingPage", () => {
  it("builds the PostBus public tracking page config", () => {
    const page = apexTrackingPage();
    expect(page.storeName).toBe("PostBus");
    expect(page.publicUrl).toBe("https://www.postbus.in/track");
    expect(page.subdomain).toBe("");
  });
});
