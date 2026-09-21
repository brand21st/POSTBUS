import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: async () => NextResponse.next(),
}));

import { proxy } from "@/proxy";

describe("proxy host canonicalization", () => {
  it("sends apex postbus.in to www so auth cookies stay on one host", async () => {
    const request = new NextRequest("https://postbus.in/auth/callback?code=abc");
    request.headers.set("host", "postbus.in");
    const response = await proxy(request);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://www.postbus.in/auth/callback?code=abc");
  });
});
