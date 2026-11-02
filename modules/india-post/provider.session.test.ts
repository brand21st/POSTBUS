import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
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

  it("does not treat tracking 403 as empty Routing Steps", async () => {
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
        status: 403,
        json: async () => ({ success: false, error: { message: "You are not authorized to access this API" } }),
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

    await expect(provider.trackShipment(["CX075364450IN"])).rejects.toMatchObject({
      status: 403,
      message: "You are not authorized to access this API",
    });
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
      indiaPostOperation: "login",
    });
  });

  it("keeps login HTTP 400 as HTTP_400 so booking classification stays unchanged", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ success: false, message: "Authentication failed" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
    });

    await expect(provider.login()).rejects.toMatchObject({
      code: "HTTP_400",
      status: 400,
      indiaPostOperation: "login",
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

  it("reuses a valid access token without AUTH01 or AUTH02", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("CEPT must not be called");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      encrypted_access_token: encryptSecret("cached-access"),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const session = await provider.ensureSession();
    expect(session.reused).toBe(true);
    expect(session.access_token).toBe("cached-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes with AUTH02 only when the access token is expired", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("TokenWithRtoken")) {
        expect(String((init?.headers as Record<string, string> | undefined)?.Authorization)).toBe("Bearer refresh-live");
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { access_token: "refreshed-access", expires_in: 1800, refresh_token: "rotated-refresh" },
          }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      encrypted_access_token: encryptSecret("old-access"),
      encrypted_refresh_token: encryptSecret("refresh-live"),
      expires_at: "2000-01-01T00:00:00.000Z",
      refresh_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const session = await provider.ensureSession();
    expect(session.access_token).toBe("refreshed-access");
    expect(session.tokens?.refresh_token).toBe("rotated-refresh");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/access/login"))).toBe(false);
  });

  it("keeps the previous refresh token when AUTH02 omits rotation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { access_token: "refreshed-access", expires_in: 1800 } }),
    })));
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      encrypted_refresh_token: encryptSecret("keep-refresh"),
      expires_at: "2000-01-01T00:00:00.000Z",
    });
    await provider.ensureSession();
    expect(decryptSecret((provider as unknown as { connection: { encrypted_refresh_token: string } }).connection.encrypted_refresh_token)).toBe("keep-refresh");
  });

  it("falls back to AUTH01 once when AUTH02 rejects the refresh token", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("TokenWithRtoken")) {
        return { ok: false, status: 400, json: async () => ({ success: false, error: { message: "Invalid refresh token" } }) };
      }
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { access_token: "login-access", refresh_token: "login-refresh", expires_in: 1800 },
          }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      encrypted_refresh_token: encryptSecret("dead-refresh"),
    });
    const session = await provider.ensureSession();
    expect(session.access_token).toBe("login-access");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("TokenWithRtoken"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/access/login"))).toHaveLength(1);
  });

  it("uses AUTH01 when no refresh token is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { access_token: "login-access", expires_in: 1800 } }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
    });
    await provider.ensureSession();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("TokenWithRtoken"))).toBe(false);
  });

  it("falls back to AUTH01 on a malformed AUTH02 body", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("TokenWithRtoken")) {
        return { ok: true, json: async () => ({ success: true, data: { expires_in: 1800 } }) };
      }
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { access_token: "login-access", expires_in: 1800 } }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      encrypted_refresh_token: encryptSecret("refresh-live"),
    });
    expect((await provider.ensureSession()).access_token).toBe("login-access");
  });

  it("does not fall back to AUTH01 on AUTH02 HTTP 500", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("TokenWithRtoken")) {
        return { ok: false, status: 500, json: async () => ({ success: false, message: "internal error" }) };
      }
      throw new Error("AUTH01 must not run after AUTH02 HTTP 500");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      encrypted_refresh_token: encryptSecret("refresh-live"),
    });
    await expect(provider.ensureSession()).rejects.toMatchObject({ status: 500, indiaPostOperation: "refresh" });
  });

  it("does not loop into AUTH01 when AUTH02 times out", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("TokenWithRtoken")) {
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      }
      throw new Error("AUTH01 must not run after AUTH02 timeout");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      encrypted_refresh_token: encryptSecret("refresh-live"),
    });
    await expect(provider.ensureSession()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not refresh on tracking 403 entitlement", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { access_token: "live-token", refresh_token: "refresh", expires_in: 3600 },
          }),
        };
      }
      if (String(url).includes("TokenWithRtoken")) throw new Error("AUTH02 must not run for tracking 403");
      return {
        ok: false,
        status: 403,
        json: async () => ({ success: false, error: { message: "You are not authorized to access this API" } }),
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
    await expect(provider.trackShipment(["CX075364450IN"])).rejects.toMatchObject({ code: "HTTP_403", status: 403 });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/tracking/bulk"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("TokenWithRtoken"))).toBe(false);
  });

  it("retries book once after HTTP 401 and stops on the second 401", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { access_token: "login-access", refresh_token: "refresh", expires_in: 3600 },
          }),
        };
      }
      return { ok: false, status: 401, json: async () => ({ success: false, message: "Unauthorized" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "cust-1",
    });
    await expect(provider.bookShipment({ articles: [] })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/access/login")).length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.filter(([url]) => !String(url).includes("/access/") ).length).toBe(2);
  });

  it("tracks a single article with TNT01 using the same session", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/access/login")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { access_token: "live-token", refresh_token: "refresh", expires_in: 3600 },
          }),
        };
      }
      if (String(url).includes("/tracking/bulk")) throw new Error("TNT02 must not run for trackArticle");
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [{ article_number: "CX075365044IN", tracking_details: [] }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
    });
    const result = await provider.trackArticle("CX075365044IN");
    expect(result.data?.[0]).toMatchObject({ article_number: "CX075365044IN" });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("/tracking/CX075365044IN");
  });

  it("never logs JWT or Bearer material", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("TokenWithRtoken")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { access_token: "eyJhbGciOiJIUzI1NiJ9.e30.aa", expires_in: 1800 },
          }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      id: "conn-log",
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      encrypted_refresh_token: encryptSecret("eyJrefresh"),
    } as never);
    await provider.ensureSession();
    const dumped = [...info.mock.calls, ...error.mock.calls].map((row) => JSON.stringify(row)).join("\n");
    expect(dumped).not.toMatch(/eyJ|Bearer /);
    info.mockRestore();
    error.mockRestore();
  });

  it("does not share in-memory tokens across two connections", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("TokenWithRtoken")) {
        const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
        const token = auth.includes("refresh-a") ? "access-a" : "access-b";
        return { ok: true, json: async () => ({ success: true, data: { access_token: token, expires_in: 1800 } }) };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const a = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user-a"),
      encrypted_password: encryptSecret("pass-a"),
      encrypted_refresh_token: encryptSecret("refresh-a"),
    });
    const b = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user-b"),
      encrypted_password: encryptSecret("pass-b"),
      encrypted_refresh_token: encryptSecret("refresh-b"),
    });
    const [sessionA, sessionB] = await Promise.all([a.ensureSession(), b.ensureSession()]);
    expect(sessionA.access_token).toBe("access-a");
    expect(sessionB.access_token).toBe("access-b");
  });
});
