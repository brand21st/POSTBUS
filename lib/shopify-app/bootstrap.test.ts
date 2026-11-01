import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";
import { buildShopifyBootstrap } from "@/lib/shopify-app/bootstrap";
import type { ShopifyAppContext } from "@/lib/shopify-app/context";

vi.mock("@/lib/shopify-app/backfill", () => ({
  startInstallBackfillOnce: async () => ({ started: false }),
}));

vi.mock("@/lib/shopify-app/tenant-admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify-app/tenant-admin")>(
    "@/lib/shopify-app/tenant-admin"
  );
  return {
    ...actual,
    createShopifyTenantAdmin: () => ({
      organizationId: "org-a",
      rpc: vi.fn(),
      from: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  };
});

const ctx: ShopifyAppContext = {
  shopDomain: "demo.myshopify.com",
  shopifyUserId: "user-1",
  organizationId: "org-a",
  installationId: "install-a",
  installationStatus: "CONNECTED",
  created: false,
};

describe("Shopify bootstrap payload", () => {
  it("rejects a client-supplied organization id for another shop", async () => {
    await expect(buildShopifyBootstrap(ctx, "org-b")).rejects.toBeInstanceOf(AppError);
  });

  it("marks India Post and shipping as future work", async () => {
    const payload = await buildShopifyBootstrap(ctx, "org-a");
    expect(payload.shopDomain).toBe("demo.myshopify.com");
    expect(payload.nextSteps.find((step) => step.id === "shopify")?.status).toBe("complete");
    expect(payload.nextSteps.find((step) => step.id === "organization")?.status).toBe("complete");
    expect(payload.nextSteps.find((step) => step.id === "india-post")?.status).toBe("upcoming");
    expect(payload.nextSteps.find((step) => step.id === "shipping")?.status).toBe("upcoming");
    expect(payload.nextSteps.find((step) => step.id === "ready")?.status).toBe("upcoming");
  });
});
