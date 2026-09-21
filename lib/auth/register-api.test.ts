import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const signUp = vi.fn();
const eq = vi.fn();

vi.mock("@/lib/security/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 7 }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { signUp },
    from: () => ({
      update: () => ({ eq }),
    }),
  }),
}));

import { POST } from "@/app/api/v1/auth/register/route";

const validBody = {
  name: "Priya Stores",
  email: "priya@example.com",
  password: "shipfast1",
  whatsapp: "9876543210",
};

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost:3000/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/v1/auth/register", () => {
  beforeEach(() => {
    signUp.mockReset();
    eq.mockReset();
    eq.mockResolvedValue({ error: null });
  });

  it("rejects short and non-mobile WhatsApp numbers", async () => {
    const short = await post({ ...validBody, whatsapp: "987654321" });
    const invalidStart = await post({ ...validBody, whatsapp: "5876543210" });
    expect(short.status).toBe(422);
    expect(invalidStart.status).toBe(422);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("signs up with +91 E.164 WhatsApp metadata", async () => {
    signUp.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "t" } },
      error: null,
    });

    const response = await post(validBody);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.whatsappNumber).toBe("+919876543210");
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "priya@example.com",
        options: expect.objectContaining({
          data: {
            full_name: "Priya Stores",
            whatsapp_number: "+919876543210",
          },
          emailRedirectTo: expect.stringMatching(/\/auth\/callback\?next=%2Fdashboard$/),
        }),
      })
    );
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("skips profile update when email confirmation is required", async () => {
    signUp.mockResolvedValue({
      data: { user: { id: "user-1" }, session: null },
      error: null,
    });

    const json = await (await post(validBody)).json();
    expect(json.data.needsEmailConfirmation).toBe(true);
    expect(eq).not.toHaveBeenCalled();
  });
});
