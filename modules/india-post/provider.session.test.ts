import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import { IndiaPostProvider } from "@/modules/india-post/provider";

describe("IndiaPostProvider in-memory session", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats tracking 400 as empty scans instead of failing the shipment", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              access_token: "live-token",
              refresh_token: "refresh",
              id_token: "id",
              expires_in: 3600,
              refresh_expires_in: 7200,
            },
          }),
        };
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: "article not found" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "cust-1",
    });

    const result = (await provider.trackShipment(["AW123456789IN"])) as { data?: unknown[] };
    expect(result.data).toEqual([]);
  });

  it("treats HTTP 200 with success false as a tracking failure", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              access_token: "live-token",
              refresh_token: "refresh",
              id_token: "id",
              expires_in: 3600,
              refresh_expires_in: 7200,
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: false, status_code: 503, message: "lookup failed", data: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "cust-1",
    });

    await expect(provider.trackShipment(["AW123456789IN"])).rejects.toMatchObject({
      code: "TEMPORARY_PROVIDER_FAILURE",
      status: 503,
    });
  });

  it("treats tracking login 401 as a permanent authentication error", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ success: false, message: "invalid credentials" }),
        };
      }
      throw new Error("tracking must not run after auth failure");
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "cust-1",
    });

    await expect(provider.trackShipment(["AW123456789IN"])).rejects.toMatchObject({
      code: "PERMANENT_AUTH_ERROR",
      status: 401,
    });
  });

  it("surfaces a CEPT tracking timeout without classifying the shipment", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              access_token: "live-token",
              refresh_token: "refresh",
              id_token: "id",
              expires_in: 3600,
              refresh_expires_in: 7200,
            },
          }),
        };
      }
      const error = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      throw error;
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "cust-1",
    });

    await expect(provider.trackShipment(["AW123456789IN"])).rejects.toMatchObject({ name: "AbortError" });
  });

  it("calls login once across ensureSession then bookShipment", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              access_token: "live-token",
              refresh_token: "refresh",
              id_token: "id",
              expires_in: 3600,
              refresh_expires_in: 7200,
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ success: true, data: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "cust-1",
    });

    await provider.ensureSession();
    await provider.bookShipment({ articles: [] });

    const logins = fetchMock.mock.calls.filter(([url]) => String(url).includes("/access/login"));
    expect(logins).toHaveLength(1);
  });
});
