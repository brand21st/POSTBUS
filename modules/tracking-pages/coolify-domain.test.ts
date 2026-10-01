import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  coolifyBaseUrl: "",
  coolifyApplicationUuid: "",
  coolifyApiToken: "",
}));

vi.mock("@/lib/env", () => ({
  env: mockEnv,
}));

describe("ensureCoolifyTrackingDomain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("without Coolify config", () => {
    beforeEach(() => {
      mockEnv.coolifyBaseUrl = "";
      mockEnv.coolifyApplicationUuid = "";
      mockEnv.coolifyApiToken = "";
    });

    it("skips when Coolify env is not configured", async () => {
      const { ensureCoolifyTrackingDomain } = await import("./coolify-domain");
      const result = await ensureCoolifyTrackingDomain("saneesh-e");
      expect(result).toEqual({ synced: false, reason: "not_configured" });
    });
  });

  describe("with Coolify config", () => {
    beforeEach(() => {
      mockEnv.coolifyBaseUrl = "http://coolify.test";
      mockEnv.coolifyApplicationUuid = "app-uuid";
      mockEnv.coolifyApiToken = "token";
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.postbus.in");
    });

    it("adds a missing domain and restarts the app", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ fqdn: "https://www.postbus.in" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ uuid: "app-uuid" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ message: "Restart request queued." }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const { ensureCoolifyTrackingDomain } = await import("./coolify-domain");
      const result = await ensureCoolifyTrackingDomain("saneesh-e");
      expect(result).toEqual({
        synced: true,
        domain: "https://saneesh-e.postbus.in",
        added: true,
        restarted: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
