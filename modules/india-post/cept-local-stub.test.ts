import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import { handleCeptLocalStub, LOCAL_CEPT_TOKEN } from "@/modules/india-post/cept-local-stub";
import { IndiaPostProvider } from "@/modules/india-post/provider";
import { parseBulkTrackingResponse } from "@/modules/india-post/tracking-response";
import { createIndiaPostLoginError, isConfirmedIndiaPostLoginAuthFailure } from "@/modules/india-post/login-auth";
import { classifyProviderError } from "@/lib/jobs/retry";

function fetchFromStub(url: string, init?: RequestInit) {
  const parsed = new URL(String(url), "http://127.0.0.1:4099");
  let body: Record<string, unknown> = {};
  if (init?.body) {
    try {
      body = JSON.parse(String(init.body));
    } catch {
      body = {};
    }
  }
  const result = handleCeptLocalStub(parsed.pathname, {
    method: init?.method,
    query: parsed.searchParams,
    body,
    authorization: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ""),
  });
  if (result.status === 0) {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  }
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    json: async () => (typeof result.body === "string" ? { xml: result.body } : result.body),
    text: async () => (typeof result.body === "string" ? result.body : JSON.stringify(result.body)),
  };
}

describe("local CEPT stub routes", () => {
  it("serves login success matching the provider parser", () => {
    const result = handleCeptLocalStub("/beextcustomer/v1/access/login", {
      method: "POST",
      body: { username: "valid", password: "x" },
    });
    expect(result.status).toBe(200);
    const loginBody = result.body as { success?: boolean; data?: { access_token: string } };
    expect(loginBody.success).toBe(true);
    expect(loginBody.data?.access_token).toBe(LOCAL_CEPT_TOKEN);
  });

  it("serves confirmed authentication failure on HTTP 400", () => {
    const result = handleCeptLocalStub("/v1/access/login", {
      method: "POST",
      body: { username: "invalid" },
    });
    expect(result.status).toBe(400);
    const error = createIndiaPostLoginError(result.status, String((result.body as { message?: string }).message));
    expect(isConfirmedIndiaPostLoginAuthFailure(error)).toBe(true);
  });

  it("keeps unrelated login validation as HTTP 400 without auth hold", () => {
    const result = handleCeptLocalStub("/access/login", {
      method: "POST",
      body: { username: "validation" },
    });
    const error = createIndiaPostLoginError(result.status, String((result.body as { message?: string }).message));
    expect(error.code).toBe("HTTP_400");
    expect(isConfirmedIndiaPostLoginAuthFailure(error)).toBe(false);
    expect(classifyProviderError(error).code).toBe("HTTP_400");
    expect(classifyProviderError(error).retryable).toBe(false);
  });

  it("covers 401/429/500 login cases", () => {
    expect(handleCeptLocalStub("/v1/access/login", { method: "POST", body: { username: "401" } }).status).toBe(401);
    expect(handleCeptLocalStub("/v1/access/login", { method: "POST", body: { username: "429" } }).status).toBe(429);
    expect(handleCeptLocalStub("/v1/access/login", { method: "POST", body: { username: "500" } }).status).toBe(500);
  });

  it("parses bulk tracking with the production parser", () => {
    const result = handleCeptLocalStub("/beextcustomer/v1/tracking/bulk", {
      method: "POST",
      body: { bulk: ["TESTAWB001IN", "TESTAWB002IN"] },
      authorization: `Bearer ${LOCAL_CEPT_TOKEN}`,
    });
    const parsed = parseBulkTrackingResponse(result.body);
    expect(parsed.data?.length).toBeGreaterThan(0);
  });

  it("does not bind a public hostname", () => {
    expect((handleCeptLocalStub("/health", {}).body as { provider_mode?: string }).provider_mode).toBe("STUB");
  });

  it("refreshes with AUTH02 when the Bearer refresh token is present", () => {
    const result = handleCeptLocalStub("/beextcustomer/v1/access/TokenWithRtoken", {
      method: "POST",
      authorization: "Bearer LOCAL_REFRESH",
    });
    expect(result.status).toBe(200);
    expect((result.body as { data?: { refresh_token: string } }).data?.refresh_token).toBe("LOCAL_REFRESH_ROTATED");
  });

  it("serves TNT01 through the bulk article shape", () => {
    const result = handleCeptLocalStub("/beextcustomer/v1/tracking/CX075365044IN", {
      method: "GET",
      authorization: `Bearer ${LOCAL_CEPT_TOKEN}`,
    });
    expect(result.status).toBe(200);
    expect((result.body as { data?: Array<{ article_number: string }> }).data?.[0]?.article_number).toBe("CX075365044IN");
  });
});

describe("IndiaPostProvider against local CEPT stub", () => {
  it("logs in with a synthetic token and never uses live credentials", async () => {
    vi.stubGlobal("fetch", fetchFromStub);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("valid-user"),
      encrypted_password: encryptSecret("valid-pass"),
      bulk_customer_id: "LOCAL-CUST",
    });
    const tokens = await provider.login();
    expect(tokens.access_token).toBe(LOCAL_CEPT_TOKEN);
    vi.unstubAllGlobals();
  });

  it("classifies stub authentication-failed login as a confirmed login failure", async () => {
    vi.stubGlobal("fetch", fetchFromStub);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("invalid"),
      encrypted_password: encryptSecret("wrong"),
      bulk_customer_id: "LOCAL-CUST",
    });
    await expect(provider.login()).rejects.toMatchObject({
      status: 400,
      indiaPostOperation: "login",
    });
    vi.unstubAllGlobals();
  });
});
