import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy, securityHeaderEntries } from "./headers";

describe("security headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("allows eval in development so Next.js can reconstruct React stacks", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(contentSecurityPolicy()).toContain("'unsafe-eval'");
  });

  it("keeps eval out of production CSP", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(contentSecurityPolicy()).not.toContain("unsafe-eval");
  });

  it("skips HSTS when asked so local HTTP is not pinned", () => {
    const keys = securityHeaderEntries({ includeHsts: false }).map((header) => header.key);
    expect(keys).not.toContain("Strict-Transport-Security");
  });
});
