import { afterEach, describe, expect, it, vi } from "vitest";

describe("auth urls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps only same-origin next paths", async () => {
    const { safeAuthNext } = await import("@/lib/auth/urls");
    expect(safeAuthNext("/dashboard")).toBe("/dashboard");
    expect(safeAuthNext("/onboarding")).toBe("/onboarding");
    expect(safeAuthNext("https://evil.example/phish")).toBe("/dashboard");
    expect(safeAuthNext("//evil.example")).toBe("/dashboard");
    expect(safeAuthNext(null)).toBe("/dashboard");
  });

  it("builds the confirmation callback on the public app host", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.postbus.in");
    vi.resetModules();
    const { authCallbackUrl } = await import("@/lib/auth/urls");
    expect(authCallbackUrl()).toBe("https://www.postbus.in/auth/callback?next=%2Fdashboard");
    expect(authCallbackUrl("/reset-password")).toBe(
      "https://www.postbus.in/auth/callback?next=%2Freset-password"
    );
  });

  it("does not send production users to localhost", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { publicAppOrigin, requestPublicOrigin } = await import("@/lib/auth/urls");
    expect(publicAppOrigin()).toBe("https://www.postbus.in");
    expect(
      requestPublicOrigin({
        nextUrl: new URL("http://localhost:3000/auth/callback"),
        headers: new Headers({ "x-forwarded-host": "www.postbus.in", "x-forwarded-proto": "https" }),
      })
    ).toBe("https://www.postbus.in");
  });
});
