import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn();

vi.mock("@/lib/env", () => ({
  env: {
    supabaseUrl: "https://abc123.supabase.co",
    supabaseAnonKey: "anon-key",
    platformAdminEmail: "",
  },
}));

vi.mock("@/lib/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/admin/access", () => ({
  hasPlatformAdminRow: async () => false,
  matchesPlatformAdminEmail: () => false,
  signedInHomePath: (isAdmin: boolean) => (isAdmin ? "/admin" : "/dashboard"),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: { name: string; value: string; options?: object }[]
        ) => void;
      };
    }
  ) => ({
    auth: {
      getUser: async () => {
        const result = getUser();
        if (result?.sessionCookie) {
          options.cookies.setAll([
            { name: "sb-abc123-auth-token", value: result.sessionCookie, options: { path: "/" } },
          ]);
        }
        return { data: { user: result?.user ?? null }, error: result?.error ?? null };
      },
    },
  }),
}));

import { updateSession } from "@/lib/supabase/proxy";

describe("updateSession", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("does not call getUser on API routes", async () => {
    const request = new NextRequest("https://www.postbus.in/api/v1/me");
    const response = await updateSession(request);
    expect(getUser).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("redirects to login when the session is missing", async () => {
    getUser.mockReturnValue({ user: null, error: null });
    const request = new NextRequest("https://www.postbus.in/dashboard/orders");
    const response = await updateSession(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?next=%2Fdashboard%2Forders");
  });

  it("does not redirect to login on a transient refresh failure", async () => {
    getUser.mockReturnValue({
      user: null,
      error: { code: "refresh_token_already_used", status: 400 },
    });
    const request = new NextRequest("https://www.postbus.in/dashboard/orders");
    request.headers.set("cookie", "sb-abc123-auth-token=chunk");
    const response = await updateSession(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps Set-Cookie headers from session refresh", async () => {
    getUser.mockReturnValue({
      user: { id: "user-1", email: "a@example.com" },
      sessionCookie: "refreshed",
    });
    const request = new NextRequest("https://www.postbus.in/dashboard/orders");
    const response = await updateSession(request);
    expect(response.cookies.get("sb-abc123-auth-token")?.value).toBe("refreshed");
    const setCookie = response.headers.getSetCookie();
    expect(setCookie.some((value) => value.includes("Domain=.postbus.in") && value.includes("Max-Age=0"))).toBe(
      true
    );
  });
});
