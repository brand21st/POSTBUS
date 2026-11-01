import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "@/lib/security/crypto";
import { encryptTokenSet, tokenNeedsRefresh, withShopRefreshLock } from "@/lib/shopify-app/token-exchange";

describe("Shopify offline token storage", () => {
  it("encrypts access tokens before they would be persisted", () => {
    const stored = encryptTokenSet({
      accessToken: "shpua_live_token",
      refreshToken: "shpur_refresh",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshExpiresAt: null,
      scope: "read_orders",
    });
    expect(stored.encrypted_access_token).not.toContain("shpua_live_token");
    expect(stored.encrypted_refresh_token).not.toContain("shpur_refresh");
    expect(decryptSecret(stored.encrypted_access_token!)).toBe("shpua_live_token");
    expect(decryptSecret(stored.encrypted_refresh_token!)).toBe("shpur_refresh");
  });

  it("refreshes only when expiry is near", () => {
    expect(tokenNeedsRefresh(null)).toBe(false);
    expect(tokenNeedsRefresh(new Date(Date.now() + 10 * 60_000).toISOString())).toBe(false);
    expect(tokenNeedsRefresh(new Date(Date.now() + 10_000).toISOString())).toBe(true);
  });

  it("serializes concurrent refresh work for the same shop", async () => {
    let active = 0;
    let maxActive = 0;
    const work = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return {
        accessToken: "a",
        scope: "read_orders",
        expiresAt: null,
        refreshExpiresAt: null,
      };
    };
    await Promise.all([
      withShopRefreshLock("demo.myshopify.com", work),
      withShopRefreshLock("demo.myshopify.com", work),
    ]);
    expect(maxActive).toBe(1);
  });
});

describe("Shopify token exchange HTTP", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("rejects a failed exchange without returning an access token", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", "public-client");
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", "public-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid" }), { status: 400 }))
    );
    const { exchangeIdTokenForOfflineAccess } = await import("@/lib/shopify-app/token-exchange");
    await expect(exchangeIdTokenForOfflineAccess("demo.myshopify.com", "id-token")).rejects.toMatchObject({
      code: "AUTH_UNAVAILABLE",
    });
  });
});
