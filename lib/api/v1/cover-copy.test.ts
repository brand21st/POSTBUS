import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { handleInventoryRoutes } from "@/lib/api/v1/inventory";

const getPlatformOpenRouterConfig = vi.hoisted(() => vi.fn());
const getAiCreditsRemaining = vi.hoisted(() => vi.fn());
const consumeAiCredit = vi.hoisted(() => vi.fn());

vi.mock("@/modules/openrouter/platform-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/openrouter/platform-config")>();
  return { ...actual, getPlatformOpenRouterConfig };
});

vi.mock("@/modules/ai-credits/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-credits/service")>();
  return { ...actual, getAiCreditsRemaining, consumeAiCredit };
});

vi.mock("@/modules/ai-image/config", () => ({
  getImageStudioConfig: vi.fn(async () => ({ enabled: true, creditCost: 10, coverCreditCost: 10, maxVariations: 3 })),
}));

const ctx: TenantContext = {
  userId: "user-1",
  email: "merchant@example.com",
  fullName: "Merchant",
  organizationId: "org-1",
  organizationName: "Shop",
  role: "OWNER",
  permissions: ["products.write"],
};

async function route(body: unknown) {
  const request = new NextRequest("http://localhost:3000/api/v1/inventory/covers/ai-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleInventoryRoutes(request, {} as never, ctx, "POST inventory/covers/ai-copy", "POST", [
    "inventory",
    "covers",
    "ai-copy",
  ]);
}

describe("POST /api/v1/inventory/covers/ai-copy", () => {
  beforeEach(() => {
    getPlatformOpenRouterConfig.mockResolvedValue({
      enabled: true,
      flagEnabled: true,
      apiKey: "sk-or-test",
      model: "openai/gpt-4o-mini",
      source: "database",
      packSize: 500,
      packPaise: 9900,
    });
    getAiCreditsRemaining.mockReset();
    consumeAiCredit.mockReset();
    getAiCreditsRemaining.mockResolvedValue(12);
    consumeAiCredit.mockResolvedValue(11);
  });

  it("returns headlines and consumes one credit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headlines: [{ text: "Celebrate in Style", category: "Festival" }],
                  subheadline: "Festive edit",
                  hook: "Handloom for Onam",
                  cta: "Shop collection",
                }),
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const result = (await route({ action: "generate", productName: "Kasavu Saree" })) as {
      headlines: Array<{ text: string }>;
      creditsRemaining: number;
    };
    expect(result.headlines[0]?.text).toMatch(/Celebrate/);
    expect(result.creditsRemaining).toBe(11);
    expect(consumeAiCredit).toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("does not consume a credit when OpenRouter fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));
    await expect(route({ action: "generate", productName: "Saree" })).rejects.toThrow("Could not generate cover copy");
    expect(consumeAiCredit).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("blocks when the workspace has 0 AI credits", async () => {
    getAiCreditsRemaining.mockResolvedValue(0);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(route({ action: "generate" })).rejects.toThrow("You're out of AI Credits.");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
