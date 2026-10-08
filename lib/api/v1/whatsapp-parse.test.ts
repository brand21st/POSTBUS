import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";

const getPlatformOpenRouterConfig = vi.hoisted(() => vi.fn());

vi.mock("@/modules/openrouter/platform-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/openrouter/platform-config")>();
  return { ...actual, getPlatformOpenRouterConfig };
});

const ctx: TenantContext = {
  userId: "user-1",
  email: "merchant@example.com",
  fullName: "Merchant",
  organizationId: "org-1",
  organizationName: "Shop",
  role: "OWNER",
  permissions: ["orders.write"],
};

const LABELED = `Name: Rahul
Phone: 9876543210
Address: 12 ABC House, Main Road
City: Kozhikode
State: Kerala
PIN: 673001`;

function postParse(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/orders/whatsapp-parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/orders/whatsapp-parse", () => {
  beforeEach(() => {
    getPlatformOpenRouterConfig.mockResolvedValue({
      enabled: false,
      flagEnabled: false,
      apiKey: "",
      model: "openai/gpt-4o-mini",
      source: "none",
    });
  });

  it("fills fields from labeled text when OpenRouter is off (rules fallback)", async () => {
    const result = (await handleCommerceRoutes(
      postParse({ text: LABELED }),
      {} as never,
      ctx,
      "POST orders/whatsapp-parse",
      "POST",
      ["orders", "whatsapp-parse"]
    )) as { fields: Record<string, string>; source: string };

    expect(result.source).toBe("rules");
    expect(result.fields).toMatchObject({
      name: "Rahul",
      phone: "9876543210",
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673001",
    });
  });

  it("uses validated OpenRouter JSON when AI is enabled", async () => {
    getPlatformOpenRouterConfig.mockResolvedValue({
      enabled: true,
      flagEnabled: true,
      apiKey: "sk-or-test",
      model: "openai/gpt-4o-mini",
      source: "database",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "Meera",
                  phone: "9876543210",
                  line1: "8 Lake View",
                  city: "Thrissur",
                  state: "Kerala",
                  pincode: "680001",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = (await handleCommerceRoutes(
      postParse({ text: "pls send to meera lake view thrissur 680001 9876543210" }),
      {} as never,
      ctx,
      "POST orders/whatsapp-parse",
      "POST",
      ["orders", "whatsapp-parse"]
    )) as { fields: Record<string, string>; source: string };

    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("openrouter.ai");
    expect(result.source).toBe("ai");
    expect(result.fields.phone).toBe("9876543210");
    expect(result.fields.pincode).toBe("680001");
    fetchMock.mockRestore();
  });

  it("rejects an empty paste", async () => {
    await expect(
      handleCommerceRoutes(
        postParse({ text: "   " }),
        {} as never,
        ctx,
        "POST orders/whatsapp-parse",
        "POST",
        ["orders", "whatsapp-parse"]
      )
    ).rejects.toThrow();
  });
});
