import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";

type InstallRow = { shop_domain: string; status: string } | null;

function mockInstallation(options: {
  lookup: InstallRow;
  full?: Record<string, unknown> | null;
  refresh?: (installation: Record<string, unknown>) => Promise<void>;
}) {
  vi.doMock("@/lib/supabase/admin", () => ({
    hasAdminClient: () => true,
    createAdminClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.lookup, error: null }) }) }),
        }),
      }),
    }),
  }));
  vi.doMock("@/lib/shopify-app/provision", () => ({
    loadShopifyAppInstallation: async () => options.full ?? null,
  }));
  vi.doMock("@/lib/shopify-app/offline-token", () => ({
    ensureOfflineToken: vi.fn(async (installation: Record<string, unknown>) => {
      await options.refresh?.(installation);
    }),
  }));
}

const fullRow = (overrides: Record<string, unknown> = {}) => ({
  id: "inst-1",
  shop_domain: "demo.myshopify.com",
  organization_id: "org-1",
  status: "CONNECTED",
  encrypted_access_token: encryptSecret("shpua_app_token"),
  ...overrides,
});

describe("Shopify token source", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/supabase/admin");
    vi.doUnmock("@/lib/shopify-app/provision");
    vi.doUnmock("@/lib/shopify-app/offline-token");
  });

  it("returns the connected app installation as a connection row", async () => {
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.resetModules();
    mockInstallation({ lookup: { shop_domain: "demo.myshopify.com", status: "CONNECTED" }, full: fullRow() });
    const { loadAppInstallationConnection } = await import("@/modules/shopify/token-source");
    await expect(loadAppInstallationConnection("org-1")).resolves.toMatchObject({
      source: "app_installation",
      shop_domain: "demo.myshopify.com",
      organization_id: "org-1",
    });
  });

  it("ignores installs that are not connected or belong to another org", async () => {
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.resetModules();
    mockInstallation({ lookup: { shop_domain: "demo.myshopify.com", status: "REAUTH_REQUIRED" }, full: fullRow() });
    let mod = await import("@/modules/shopify/token-source");
    await expect(mod.loadAppInstallationConnection("org-1")).resolves.toBeNull();

    vi.resetModules();
    mockInstallation({
      lookup: { shop_domain: "demo.myshopify.com", status: "CONNECTED" },
      full: fullRow({ organization_id: "org-2" }),
    });
    mod = await import("@/modules/shopify/token-source");
    await expect(mod.loadAppInstallationConnection("org-1")).resolves.toBeNull();
  });

  it("drops the install when a background refresh ends in REAUTH_REQUIRED", async () => {
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.resetModules();
    mockInstallation({
      lookup: { shop_domain: "demo.myshopify.com", status: "CONNECTED" },
      full: fullRow(),
      refresh: async (installation) => {
        installation.status = "REAUTH_REQUIRED";
      },
    });
    const { loadAppInstallationConnection } = await import("@/modules/shopify/token-source");
    await expect(loadAppInstallationConnection("org-1")).resolves.toBeNull();
  });

  it("never falls back to client credentials for an app installation token", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { resolveShopifyAdminToken } = await import("@/modules/shopify/orders");
    await expect(
      resolveShopifyAdminToken({
        source: "app_installation",
        shop_domain: "demo.myshopify.com",
        encrypted_access_token: encryptSecret("shpua_app_token"),
      })
    ).resolves.toBe("shpua_app_token");
    await expect(
      resolveShopifyAdminToken({ source: "app_installation", shop_domain: "demo.myshopify.com", encrypted_access_token: "garbage" })
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses REST Admin calls for a shop served by the App Store app", async () => {
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.resetModules();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mockInstallation({ lookup: { shop_domain: "demo.myshopify.com", status: "CONNECTED" }, full: fullRow() });
    const { loadAppInstallationConnection, isGraphqlOnlyShop } = await import("@/modules/shopify/token-source");
    await loadAppInstallationConnection("org-1");
    expect(isGraphqlOnlyShop("demo.myshopify.com")).toBe(true);
    expect(isGraphqlOnlyShop("https://demo.myshopify.com/admin/api/2025-01/orders.json")).toBe(true);
    expect(isGraphqlOnlyShop("other.myshopify.com")).toBe(false);

    const { fetchShopifyOrderPayment } = await import("@/modules/shopify/orders");
    await expect(fetchShopifyOrderPayment("demo.myshopify.com", "tok", "1")).rejects.toMatchObject({ code: "REST_DISABLED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

