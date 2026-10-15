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

const ctx: TenantContext = {
  userId: "user-1",
  email: "merchant@example.com",
  fullName: "Merchant",
  organizationId: "org-1",
  organizationName: "Shop",
  role: "OWNER",
  permissions: ["products.write"],
};

function postCopy(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/products/ai-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function route(request: NextRequest) {
  return handleInventoryRoutes(request, {} as never, ctx, "POST products/ai-copy", "POST", [
    "products",
    "ai-copy",
  ]);
}

describe("POST /api/v1/products/ai-copy", () => {
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

  it("returns title and description and consumes one credit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Handloom Cotton Saree for Weddings",
                  description: "Soft drape for festive days in Kozhikode.",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = (await route(postCopy({ prompt: "Handloom cotton saree, Kozhikode, weddings" }))) as {
      title: string;
      description: string;
      creditsRemaining: number;
    };

    expect(result.title).toContain("Saree");
    expect(result.description).toContain("Kozhikode");
    expect(result.creditsRemaining).toBe(11);
    expect(consumeAiCredit).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.objectContaining({ reason: "AI_PRODUCT_COPY" })
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("openrouter.ai");
    fetchMock.mockRestore();
  });

  it("does not consume a credit when OpenRouter fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));
    await expect(route(postCopy({ prompt: "Cotton shirt" }))).rejects.toThrow(
      "Could not generate title and description"
    );
    expect(consumeAiCredit).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("blocks when the workspace has 0 AI credits", async () => {
    getAiCreditsRemaining.mockResolvedValue(0);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(route(postCopy({ prompt: "Cotton shirt" }))).rejects.toThrow("You're out of AI Credits.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consumeAiCredit).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
