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

function postEnhance(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/products/ai-image/enhance-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function route(request: NextRequest) {
  return handleInventoryRoutes(request, {} as never, ctx, "POST products/ai-image/enhance-prompt", "POST", [
    "products",
    "ai-image",
    "enhance-prompt",
  ]);
}

describe("POST /api/v1/products/ai-image/enhance-prompt", () => {
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

  it("returns an enhanced prompt and consumes one credit", { timeout: 20000 }, async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  prompt: "Soft cream backdrop, keep the kasavu border sharp, natural window light.",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = (await route(
      postEnhance({ prompt: "kasavu saree, cream bg", preset: "clean_ecommerce", productName: "Handloom Kasavu Saree" })
    )) as { prompt: string; creditsRemaining: number };

    expect(result.prompt).toMatch(/kasavu/i);
    expect(result.creditsRemaining).toBe(11);
    expect(consumeAiCredit).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.objectContaining({ reason: "AI_PROMPT_ENHANCE" })
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("openrouter.ai");
    fetchMock.mockRestore();
  });

  it("does not consume a credit when OpenRouter fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));
    await expect(route(postEnhance({ prompt: "gold light" }))).rejects.toThrow("Could not enhance the prompt");
    expect(consumeAiCredit).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("blocks when the workspace has 0 AI credits", async () => {
    getAiCreditsRemaining.mockResolvedValue(0);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(route(postEnhance({ prompt: "gold light" }))).rejects.toThrow("You're out of AI Credits.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consumeAiCredit).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
