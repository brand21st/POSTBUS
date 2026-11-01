import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: mocks.limit }));

import { GET } from "./route";

const code = "a".repeat(24);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("POSTBUS_AFFILIATES_ENABLED", "true");
  vi.stubEnv("POSTBUS_AFFILIATE_COOKIE_SECRET", "s".repeat(32));
  mocks.limit.mockReturnValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("referral click tracking", () => {
  it("rejects a short public code and still sends the visitor home", async () => {
    const response = await GET(new NextRequest("https://www.postbus.in/?ref=PB12345"));
    expect(response.headers.get("location")).toBe("https://www.postbus.in/");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("keeps the landing page available when tracking storage fails", async () => {
    mocks.admin.mockImplementation(() => { throw new Error("database unavailable"); });
    const response = await GET(new NextRequest(`https://www.postbus.in/?ref=${code}`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.postbus.in/");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not replace a valid first-touch cookie", async () => {
    const { signReferral } = await import("@/modules/affiliates/cookie");
    const first = "10000000-0000-4000-8000-000000000001";
    const cookie = signReferral({ link: first, visitor: "b".repeat(32), expires: Date.now() + 86_400_000 });
    mocks.admin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: "20000000-0000-4000-8000-000000000009", affiliate_id: "a" }, error: null }),
              }),
            }),
          }),
        }),
      }),
      rpc: async () => ({ data: null, error: null }),
    });
    const response = await GET(new NextRequest(`https://www.postbus.in/?ref=${code}`, { headers: { cookie: `pb_referral=${cookie}` } }));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBe("https://www.postbus.in/");
  });
});
