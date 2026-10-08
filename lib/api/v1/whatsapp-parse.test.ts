import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";

const getPlatformOpenRouterConfig = vi.hoisted(() => vi.fn());
const getAiCreditsRemaining = vi.hoisted(() => vi.fn());
const consumeAiCredit = vi.hoisted(() => vi.fn());
const getAiCreditsSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/modules/openrouter/platform-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/openrouter/platform-config")>();
  return { ...actual, getPlatformOpenRouterConfig };
});

vi.mock("@/modules/ai-credits/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-credits/service")>();
  return { ...actual, getAiCreditsRemaining, consumeAiCredit, getAiCreditsSnapshot };
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
      packSize: 500,
      packPaise: 9900,
    });
    getAiCreditsRemaining.mockReset();
    consumeAiCredit.mockReset();
    getAiCreditsSnapshot.mockReset();
    getAiCreditsRemaining.mockResolvedValue(500);
    consumeAiCredit.mockResolvedValue(499);
    getAiCreditsSnapshot.mockResolvedValue({
      remaining: 500,
      included: 500,
      packSize: 500,
      packPaise: 9900,
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
    expect(consumeAiCredit).not.toHaveBeenCalled();
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
      packSize: 500,
      packPaise: 9900,
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
    )) as { fields: Record<string, string>; source: string; creditsRemaining: number };

    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("openrouter.ai");
    expect(result.source).toBe("ai");
    expect(consumeAiCredit).toHaveBeenCalled();
    expect(result.creditsRemaining).toBe(499);
    expect(result.fields.phone).toBe("9876543210");
    expect(result.fields.pincode).toBe("680001");
    fetchMock.mockRestore();
  });

  it("skips OpenRouter when the workspace has 0 AI credits", async () => {
    getAiCreditsRemaining.mockResolvedValue(0);
    getPlatformOpenRouterConfig.mockResolvedValue({
      enabled: true,
      flagEnabled: true,
      apiKey: "sk-or-test",
      model: "openai/gpt-4o-mini",
      source: "database",
      packSize: 500,
      packPaise: 9900,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = (await handleCommerceRoutes(
      postParse({ text: LABELED }),
      {} as never,
      ctx,
      "POST orders/whatsapp-parse",
      "POST",
      ["orders", "whatsapp-parse"]
    )) as { source: string; creditsRemaining: number };

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consumeAiCredit).not.toHaveBeenCalled();
    expect(result.source).toBe("rules");
    expect(result.creditsRemaining).toBe(0);
    fetchMock.mockRestore();
  });

  it("GET /api/v1/ai-credits returns remaining pack info", async () => {
    const result = await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/ai-credits"),
      {} as never,
      ctx,
      "GET ai-credits",
      "GET",
      ["ai-credits"]
    );
    expect(result).toEqual({ remaining: 500, included: 500, packSize: 500, packPaise: 9900 });
    expect(getAiCreditsSnapshot).toHaveBeenCalled();
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
