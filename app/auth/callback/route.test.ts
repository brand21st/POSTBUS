import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();

vi.mock("@/lib/env", () => ({
  env: {
    appUrl: "https://www.postbus.in",
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (cookies: { name: string; value: string; options?: object }[]) => void;
      };
    }
  ) => ({
    auth: {
      exchangeCodeForSession: async (code: string) => {
        options.cookies.setAll([{ name: "sb-access-token", value: "session", options: { path: "/" } }]);
        return exchangeCodeForSession(code);
      },
      verifyOtp: async (args: unknown) => {
        options.cookies.setAll([{ name: "sb-access-token", value: "session", options: { path: "/" } }]);
        return verifyOtp(args);
      },
    },
  }),
}));

import { GET } from "@/app/auth/callback/route";

function callbackRequest(search: string) {
  return new NextRequest(`https://www.postbus.in/auth/callback${search}`);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    verifyOtp.mockReset();
  });

  it("exchanges the confirmation code and sets session cookies on the dashboard redirect", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(callbackRequest("?code=pkce-code&next=/dashboard"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.postbus.in/dashboard");
    expect(response.cookies.get("sb-access-token")?.value).toBe("session");
  });

  it("verifies token_hash confirmation emails", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const response = await GET(callbackRequest("?token_hash=abc&type=signup&next=/dashboard"));
    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc" });
    expect(response.headers.get("location")).toBe("https://www.postbus.in/dashboard");
  });

  it("rejects missing tokens", async () => {
    const response = await GET(callbackRequest("?next=/dashboard"));
    expect(response.headers.get("location")).toBe(
      "https://www.postbus.in/login?error=auth_callback_missing"
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("blocks open redirects", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(callbackRequest("?code=pkce-code&next=https://evil.example"));
    expect(response.headers.get("location")).toBe("https://www.postbus.in/dashboard");
  });
});
