import { describe, expect, it } from "vitest";
import { sanitizeSupportSearch, supportConversationsQueryString } from "@/modules/support/search";

describe("support inbox search", () => {
  it("sanitizes and drops PostgREST metacharacters", () => {
    expect(sanitizeSupportSearch("  Rahul, or=1  ")).toBe("Rahul or1");
    expect(sanitizeSupportSearch("PB-TKT-2026-000012")).toBe("PB-TKT-2026-000012");
    expect(sanitizeSupportSearch("#1052")).toBe("#1052");
    expect(sanitizeSupportSearch("9876543210")).toBe("9876543210");
    expect(sanitizeSupportSearch("")).toBe("");
  });

  it("puts q on the conversation list URL and resets other params", () => {
    expect(supportConversationsQueryString({ filter: "open", category: "product_return", q: "PB-TKT-2026-1" })).toBe(
      "/api/v1/support/conversations?filter=open&category=product_return&q=PB-TKT-2026-1"
    );
    expect(supportConversationsQueryString({ filter: "all", q: "  " })).toBe("/api/v1/support/conversations?filter=all");
  });
});
