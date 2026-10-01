import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  coolifyBaseUrl: "",
  coolifyApplicationUuid: "",
  coolifyApiToken: "",
}));

const afterMock = vi.hoisted(() => vi.fn((fn: () => unknown) => fn()));

vi.mock("@/lib/env", () => ({
  env: mockEnv,
}));

vi.mock("next/server", () => ({
  after: afterMock,
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

describe("ensureCoolifyTrackingDomain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    afterMock.mockClear();
  });

  describe("without Coolify config", () => {
    beforeEach(() => {
      mockEnv.coolifyBaseUrl = "";
      mockEnv.coolifyApplicationUuid = "";
      mockEnv.coolifyApiToken = "";
    });

    it("skips when Coolify env is not configured", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { ensureCoolifyTrackingDomain } = await import("./coolify-domain");
      const result = await ensureCoolifyTrackingDomain("saneesh-e");
      expect(result.synced).toBe(false);
      if (!result.synced) expect(result.reason).toBe("not_configured");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("with Coolify config", () => {
    beforeEach(() => {
      mockEnv.coolifyBaseUrl = "http://coolify.test";
      mockEnv.coolifyApplicationUuid = "app-uuid";
      mockEnv.coolifyApiToken = "token";
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.postbus.in");
    });

    it("returns failed without throwing when Coolify errors", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
      vi.stubGlobal("fetch", fetchMock);
      const { ensureCoolifyTrackingDomain } = await import("./coolify-domain");
      const result = await ensureCoolifyTrackingDomain("saneesh-e");
      expect(result).toMatchObject({
        synced: false,
        reason: "coolify_error",
        domain: "https://saneesh-e.postbus.in",
      });
    });

    it("returns live when the domain is already on the app", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ fqdn: "https://www.postbus.in,https://saneesh-e.postbus.in" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const { ensureCoolifyTrackingDomain, hostProvisioningFromSync } = await import("./coolify-domain");
      const result = await ensureCoolifyTrackingDomain("saneesh-e");
      expect(result).toMatchObject({ synced: true, added: false, restarted: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(hostProvisioningFromSync(result).status).toBe("live");
    });

    it("adds a missing domain and schedules restart after the response", async () => {
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
      const { ensureCoolifyTrackingDomain, hostProvisioningFromSync } = await import("./coolify-domain");
      const result = await ensureCoolifyTrackingDomain("saneesh-e");
      expect(result).toMatchObject({
        synced: true,
        domain: "https://saneesh-e.postbus.in",
        added: true,
        restarted: true,
      });
      expect(hostProvisioningFromSync(result).status).toBe("connecting");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/applications/app-uuid");
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
      expect(afterMock).toHaveBeenCalled();
    });
  });
});
