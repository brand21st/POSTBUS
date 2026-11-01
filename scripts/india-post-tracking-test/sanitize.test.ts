import { describe, expect, it } from "vitest";
import { sanitizeJson, tokenPresence } from "./sanitize";

describe("india-post tracking diagnostic sanitize", () => {
  it("redacts token fields and keeps tracking event text", () => {
    const sanitized = sanitizeJson({
      success: true,
      data: { access_token: "eyJhbGciOi.test-token", article_number: "CX075364959IN" },
    }) as { data: { access_token: string; article_number: string } };
    expect(String(sanitized.data.access_token)).toContain("REDACTED");
    expect(sanitized.data.article_number).toBe("CX075364959IN");
  });

  it("does not treat empty strings as generated tokens", () => {
    expect(tokenPresence("")).toBe("MISSING");
    expect(tokenPresence("abc")).toBe("GENERATED");
  });
});
