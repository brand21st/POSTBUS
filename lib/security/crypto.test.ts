import { describe, expect, it, vi } from "vitest";

describe("crypto production key", () => {
  it("rejects a missing encryption key in production", async () => {
    const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.INTEGRATION_ENCRYPTION_KEY = "";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "");

    vi.resetModules();
    const { encryptSecret } = await import("@/lib/security/crypto");
    expect(() => encryptSecret("secret")).toThrow(/INTEGRATION_ENCRYPTION_KEY/);

    vi.unstubAllEnvs();
    if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
    if (previousNodeEnv) vi.stubEnv("NODE_ENV", previousNodeEnv);
    vi.resetModules();
  });

  it("encrypts in non-production without a configured key", async () => {
    vi.resetModules();
    const { encryptSecret } = await import("@/lib/security/crypto");
    expect(encryptSecret("hello").split(".").length).toBe(3);
  });
});
