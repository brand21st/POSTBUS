import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaderEntries } from "./headers";

describe("security headers", () => {
  it("sets clickjacking and XSS controls Lighthouse looks for", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");

    const keys = securityHeaderEntries({ includeHsts: true }).map((header) => header.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Content-Security-Policy",
        "Cross-Origin-Opener-Policy",
        "Strict-Transport-Security",
        "X-Frame-Options",
      ])
    );
  });

  it("skips HSTS when asked so local HTTP is not pinned", () => {
    const keys = securityHeaderEntries({ includeHsts: false }).map((header) => header.key);
    expect(keys).not.toContain("Strict-Transport-Security");
  });
});
