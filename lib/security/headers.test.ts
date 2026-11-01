import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applySecurityHeaders,
  contentSecurityPolicy,
  isSameOriginFramePath,
  isShopifyEmbeddedPath,
  securityHeaderEntries,
  shopifyFrameAncestors,
} from "./headers";

describe("security headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets clickjacking and XSS controls Lighthouse looks for", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://www.youtube.com");
    expect(csp).toContain("https://www.youtube-nocookie.com");
    expect(csp).toContain("https://player.vimeo.com");
    expect(csp).toContain("https://www.facebook.com");
    expect(csp).toContain("https://www.instagram.com");
    expect(csp).not.toContain("tawk.to");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("form-action 'self'");
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

  it("keeps dashboard clickjacking protection", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { pathname: "/dashboard", includeHsts: false });
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("keeps admin clickjacking protection", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { pathname: "/admin", includeHsts: false });
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("allows only Shopify admin and the requesting shop to frame the app", () => {
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "true");
    const headers = new Headers();
    applySecurityHeaders(headers, { pathname: "/shopify", includeHsts: false, shop: "Demo-Store.myshopify.com" });
    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors https://demo-store.myshopify.com https://admin.shopify.com;");
    expect(csp).not.toContain("*.myshopify.com https://admin");
    expect(headers.get("X-Frame-Options")).toBeNull();
  });

  it("never interpolates an invalid shop into frame-ancestors", () => {
    for (const shop of [
      "evil.example",
      "x.myshopify.com; script-src *",
      "x.myshopify.com https://evil.example",
      "https://x.myshopify.com",
      "",
      null,
    ]) {
      expect(shopifyFrameAncestors(shop)).toBe("https://admin.shopify.com");
    }
  });

  it("does not embed Shopify Admin when the kill switch is off", () => {
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "false");
    const headers = new Headers();
    applySecurityHeaders(headers, { pathname: "/shopify", includeHsts: false });
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("recognizes only Shopify embedded path prefixes", () => {
    expect(isShopifyEmbeddedPath("/shopify")).toBe(true);
    expect(isShopifyEmbeddedPath("/api/shopify/bootstrap")).toBe(true);
    expect(isShopifyEmbeddedPath("/dashboard")).toBe(false);
    expect(isShopifyEmbeddedPath("/admin")).toBe(false);
    expect(isShopifyEmbeddedPath("/login")).toBe(false);
  });

  it("keeps login and tracking routes non-embeddable", () => {
    for (const pathname of ["/login", "/track", "/onboarding"]) {
      const headers = new Headers();
      applySecurityHeaders(headers, { pathname, includeHsts: false });
      expect(headers.get("X-Frame-Options")).toBe("DENY");
      expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    }
  });

  it("embeds Shopify nested routes when the flag is on without interpolating an invalid shop", () => {
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "true");
    for (const pathname of ["/shopify/onboarding", "/shopify/settings"]) {
      const headers = new Headers();
      applySecurityHeaders(headers, { pathname, includeHsts: false, shop: "attacker.example" });
      const csp = headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("frame-ancestors https://admin.shopify.com;");
      expect(csp).not.toContain("attacker.example");
      expect(headers.get("X-Frame-Options")).toBeNull();
    }
  });

  it("lets only the same origin frame the storefront preview page", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { pathname: "/store-preview", includeHsts: false });
    expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self';");
    expect(csp).not.toContain("frame-ancestors 'none'");
  });

  it("keeps public stores and nearby paths non-embeddable", () => {
    for (const pathname of ["/store/samanga", "/store-preview/x", "/store-previews", "/dashboard/inventory"]) {
      expect(isSameOriginFramePath(pathname)).toBe(false);
      const headers = new Headers();
      applySecurityHeaders(headers, { pathname, includeHsts: false });
      expect(headers.get("X-Frame-Options")).toBe("DENY");
      expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    }
  });
});
