import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

describe("Shopify BFF handle", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns 404 when the embedded app flag is off", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "false");
    const [{ handleShopifyAppApi }, { AppError: FreshAppError }] = await Promise.all([
      import("@/lib/shopify-app/handle"),
      import("@/lib/api/errors"),
    ]);
    const request = new NextRequest("http://localhost:3000/api/shopify/bootstrap");
    await expect(handleShopifyAppApi(request, ["bootstrap"])).rejects.toBeInstanceOf(FreshAppError);
  });

  it("still accepts public-app webhooks when the merchant UI flag is off", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "false");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", "public-secret");
    vi.doMock("@/lib/shopify-app/webhooks", () => ({
      handleShopifyPublicAppWebhook: async () => ({ ok: true, topic: "app/uninstalled" }),
    }));
    const { handleShopifyAppApi } = await import("@/lib/shopify-app/handle");
    const request = new NextRequest("http://localhost:3000/api/shopify/webhooks", { method: "POST" });
    await expect(handleShopifyAppApi(request, ["webhooks"])).resolves.toEqual({
      ok: true,
      topic: "app/uninstalled",
    });
  });

  it("does not trust a query organization_id over the verified shop", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "true");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", "public-secret");
    vi.doMock("@/lib/shopify-app/id-token", () => ({
      readBearerToken: () => "token",
      verifyShopifyIdToken: async () => ({ shopDomain: "shop-a.myshopify.com" }),
    }));
    vi.doMock("@/lib/security/shared-rate-limit", () => ({
      sharedRateLimit: async () => ({ ok: true, remaining: 10 }),
    }));
    vi.doMock("@/lib/shopify-app/context", () => ({
      assertShopifyEmbeddedEnabled: () => undefined,
      requireShopifyAppContext: async () => ({
        shopDomain: "shop-a.myshopify.com",
        shopifyUserId: "1",
        organizationId: "org-a",
        installationId: "install-a",
        installationStatus: "CONNECTED",
        created: false,
      }),
    }));
    vi.doMock("@/lib/shopify-app/bootstrap", () => ({
      buildShopifyBootstrap: async (_ctx: { organizationId: string }, requested?: string | null) => {
        if (requested && requested !== "org-a") throw new AppError(ERROR_CODES.FORBIDDEN, "no");
        return { organization: { id: "org-a" } };
      },
    }));
    const { handleShopifyAppApi } = await import("@/lib/shopify-app/handle");
    const request = new NextRequest("http://localhost:3000/api/shopify/bootstrap?organization_id=org-b");
    await expect(handleShopifyAppApi(request, ["bootstrap"])).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it("rate limits per verified shop", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "true");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", "public-secret");
    const keys: string[] = [];
    vi.doMock("@/lib/shopify-app/id-token", () => ({
      readBearerToken: () => "token",
      verifyShopifyIdToken: async () => ({ shopDomain: "shop-a.myshopify.com" }),
    }));
    vi.doMock("@/lib/security/shared-rate-limit", () => ({
      sharedRateLimit: async (key: string) => {
        keys.push(key);
        return { ok: false, remaining: 0 };
      },
    }));
    vi.doMock("@/lib/shopify-app/context", () => ({
      assertShopifyEmbeddedEnabled: () => undefined,
      requireShopifyAppContext: async () => {
        throw new Error("should not reach the tenant");
      },
    }));
    const { handleShopifyAppApi } = await import("@/lib/shopify-app/handle");
    const request = new NextRequest("http://localhost:3000/api/shopify/bootstrap");
    await expect(handleShopifyAppApi(request, ["bootstrap"])).rejects.toMatchObject({
      code: ERROR_CODES.RATE_LIMITED,
    });
    expect(keys).toEqual(["shopify-app:shop:shop-a.myshopify.com"]);
  });

  it("auth callback keeps a valid shop/host and drops anything else", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "true");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", "public-secret");
    const { handleShopifyAppApi } = await import("@/lib/shopify-app/handle");
    const ok = (await handleShopifyAppApi(
      new NextRequest("http://localhost:3000/api/shopify/auth/callback?shop=demo.myshopify.com&host=YWRtaW4"),
      ["auth", "callback"]
    )) as Response;
    expect(ok.headers.get("location")).toBe("http://localhost:3000/shopify?shop=demo.myshopify.com&host=YWRtaW4");
    const bad = (await handleShopifyAppApi(
      new NextRequest("http://localhost:3000/api/shopify/auth/callback?shop=evil.example&host=x"),
      ["auth", "callback"]
    )) as Response;
    expect(bad.headers.get("location")).toBe("http://localhost:3000/shopify");
  });

  it("404s an unlisted v1 route before doing any Shopify auth work", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "true");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", "public-secret");
    let tenantResolved = false;
    vi.doMock("@/lib/shopify-app/id-token", () => ({
      readBearerToken: () => "token",
      verifyShopifyIdToken: async () => ({ shopDomain: "shop-a.myshopify.com" }),
    }));
    vi.doMock("@/lib/security/shared-rate-limit", () => ({
      sharedRateLimit: async () => ({ ok: true, remaining: 10 }),
    }));
    vi.doMock("@/lib/shopify-app/tenant", () => ({
      requireShopifyTenant: async () => {
        tenantResolved = true;
        throw new Error("should not resolve");
      },
    }));
    const { handleShopifyAppApi } = await import("@/lib/shopify-app/handle");
    const request = new NextRequest("http://localhost:3000/api/shopify/v1/api-keys", { method: "POST" });
    await expect(handleShopifyAppApi(request, ["v1", "api-keys"])).rejects.toMatchObject({
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
    });
    expect(tenantResolved).toBe(false);
  });

  it("dispatches an allowed v1 route as the shop principal with the v1 prefix stripped", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "true");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", "public-secret");
    const principalClient = { principal: true };
    const ctx = { organizationId: "org-a", userId: "principal-a", role: "OWNER" };
    const calls: unknown[] = [];
    vi.doMock("@/lib/shopify-app/id-token", () => ({
      readBearerToken: () => "token",
      verifyShopifyIdToken: async () => ({ shopDomain: "shop-a.myshopify.com" }),
    }));
    vi.doMock("@/lib/security/shared-rate-limit", () => ({
      sharedRateLimit: async () => ({ ok: true, remaining: 10 }),
    }));
    vi.doMock("@/lib/shopify-app/tenant", () => ({
      requireShopifyTenant: async () => ({ ctx, supabase: principalClient, shop: {} }),
    }));
    vi.doMock("@/lib/api/v1/dispatch", () => ({
      dispatchTenantRoutes: async (...args: unknown[]) => {
        calls.push(args.slice(1));
        return { ok: true };
      },
    }));
    const { handleShopifyAppApi } = await import("@/lib/shopify-app/handle");
    const request = new NextRequest("http://localhost:3000/api/shopify/v1/orders/ord-1/weights", { method: "PATCH" });
    await expect(handleShopifyAppApi(request, ["v1", "orders", "ord-1", "weights"])).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      [
        principalClient,
        ctx,
        { key: "PATCH orders/ord-1/weights", path: "orders/ord-1/weights", method: "PATCH", slugs: ["orders", "ord-1", "weights"] },
      ],
    ]);
  });
});

