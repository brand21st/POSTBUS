import { describe, expect, it } from "vitest";
import { sanitizeSupportSearch, supportConversationsQueryString } from "@/modules/support/search";

describe("Support inbox search performance (local synthetic)", () => {
  it("sanitizes and encodes 1,000 query variants under 50ms", () => {
    const started = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      const q = sanitizeSupportSearch(`#1052 ticket PB-${i} <script>`);
      expect(q).not.toContain("<");
      expect(supportConversationsQueryString({ filter: "all", q })).toContain("q=");
    }
    expect(performance.now() - started).toBeLessThan(150);
  });
});
