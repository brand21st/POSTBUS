import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { encryptSecret } from "@/lib/security/crypto";
import {
  createShopifyOAuthState,
  normalizeShopDomain,
  oauthStateMatches,
  parseShopifyOAuthState,
  pickShopifyConnectionForShop,
  shouldDisconnectShopifyOnCredentialChange,
  resolveShopifyAppCredentials,
  resolveShopifyWebhookSecrets,
  shopifyAppConfiguredFor,
  shopifyInstallUrl,
  shopifyWebhookUrl,
  verifyShopifyHmac,
  verifyWebhookHmac,
} from "@/modules/shopify/oauth";

describe("shopify webhook hmac", () => {
  it("rejects missing secret or header", () => {
    expect(verifyWebhookHmac("{}", null)).toBe(false);
  });

  it("accepts a matching digest when secret is present", () => {
    const previous = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = "test-secret";
    const digest = createHmac("sha256", "test-secret").update("{}", "utf8").digest("base64");
    expect(verifyWebhookHmac("{}", digest)).toBe(true);
    process.env.SHOPIFY_API_SECRET = previous;
  });

  it("accepts a matching digest when a per-org secret is passed", () => {
    const previous = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = "";
    const digest = createHmac("sha256", "org-secret").update("{}", "utf8").digest("base64");
    expect(verifyWebhookHmac("{}", digest, "org-secret")).toBe(true);
    expect(verifyWebhookHmac("{}", digest, "wrong")).toBe(false);
    process.env.SHOPIFY_API_SECRET = previous;
  });

  it("accepts HMAC signed with the previous client secret during rotation", () => {
    const previous = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = "";
    const digest = createHmac("sha256", "old-secret").update("{}", "utf8").digest("base64");
    expect(verifyWebhookHmac("{}", digest, ["new-secret", "old-secret"])).toBe(true);
    process.env.SHOPIFY_API_SECRET = previous;
  });
});

describe("shopify oauth hmac", () => {
  it("accepts a matching query hmac for the provided secret", () => {
    const query = new URLSearchParams({ shop: "demo.myshopify.com", state: "abc", timestamp: "1" });
    const message = [...query.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    query.set("hmac", createHmac("sha256", "app-secret").update(message).digest("hex"));
    expect(verifyShopifyHmac(query, "app-secret")).toBe(true);
    expect(verifyShopifyHmac(query, "wrong")).toBe(false);
  });
});

describe("shopify credential helpers", () => {
  it("normalizes shop domains", () => {
    expect(normalizeShopDomain("https://Demo.myshopify.com/")).toBe("demo.myshopify.com");
    expect(normalizeShopDomain("demo.myshopify.com")).toBe("demo.myshopify.com");
  });

  it("disconnects a connected store when Client ID, secret, or shop changes", () => {
    const connected = {
      status: "CONNECTED",
      shop_domain: "demo.myshopify.com",
      client_id: "client-a",
    };
    expect(
      shouldDisconnectShopifyOnCredentialChange(connected, {
        shopDomain: "demo.myshopify.com",
        clientId: "client-a",
      })
    ).toBe(false);
    expect(
      shouldDisconnectShopifyOnCredentialChange(connected, {
        shopDomain: "other.myshopify.com",
        clientId: "client-a",
      })
    ).toBe(true);
    expect(
      shouldDisconnectShopifyOnCredentialChange(connected, {
        shopDomain: "demo.myshopify.com",
        clientId: "client-b",
      })
    ).toBe(true);
    expect(
      shouldDisconnectShopifyOnCredentialChange(connected, {
        shopDomain: "demo.myshopify.com",
        clientId: "client-a",
        incomingSecret: "new-secret",
      })
    ).toBe(true);
    expect(
      shouldDisconnectShopifyOnCredentialChange(
        { ...connected, status: "NOT_CONNECTED" },
        { shopDomain: "demo.myshopify.com", clientId: "client-b" }
      )
    ).toBe(false);
  });

  it("routes a shop webhook to the connected workspace", () => {
    expect(
      pickShopifyConnectionForShop(
        [
          { shop_domain: "other.myshopify.com", status: "CONNECTED" },
          { shop_domain: "https://Demo.myshopify.com/", status: "DISCONNECTED" },
          { shop_domain: "demo.myshopify.com", status: "CONNECTED" },
        ],
        "Demo.myshopify.com"
      )
    ).toEqual({ shop_domain: "demo.myshopify.com", status: "CONNECTED" });
  });

  it("prefers Client ID and encrypted Client secret from the connection row", () => {
    const row = {
      client_id: "org-client-id",
      encrypted_client_secret: encryptSecret("org-secret"),
      requested_scopes: "read_orders,write_orders",
    };
    expect(resolveShopifyAppCredentials(row)).toEqual({
      clientId: "org-client-id",
      clientSecret: "org-secret",
      scopes: "read_orders,write_orders",
    });
    expect(resolveShopifyWebhookSecrets(row)).toContain("org-secret");
    expect(shopifyAppConfiguredFor(row)).toBe(true);
  });

  it("falls back to legacy encrypted API key columns", () => {
    const row = {
      encrypted_api_key: encryptSecret("legacy-id"),
      encrypted_api_secret: encryptSecret("legacy-secret"),
    };
    expect(resolveShopifyAppCredentials(row)).toMatchObject({
      clientId: "legacy-id",
      clientSecret: "legacy-secret",
    });
  });

  it("builds an install URL from passed credentials", () => {
    const url = new URL(
      shopifyInstallUrl("https://demo.myshopify.com/", "state-1", {
        clientId: "client-id",
        scopes: "read_orders",
      })
    );
    expect(url.origin).toBe("https://demo.myshopify.com");
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("scope")).toBe("read_orders");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toContain("/api/v1/integrations/shopify/callback");
  });

  it("returns the platform webhook URL", () => {
    expect(shopifyWebhookUrl()).toMatch(/\/api\/v1\/webhooks\/shopify$/);
  });
});

describe("shopify oauth state", () => {
  it("binds state to an organization and rejects mismatched cookies", () => {
    const state = createShopifyOAuthState("org-123");
    expect(parseShopifyOAuthState(state)).toEqual({
      organizationId: "org-123",
      nonce: state.slice("org-123.".length),
    });
    expect(oauthStateMatches(state, state)).toBe(true);
    expect(oauthStateMatches(state, createShopifyOAuthState("org-123"))).toBe(false);
    expect(oauthStateMatches(undefined, state)).toBe(false);
    expect(parseShopifyOAuthState("not-a-state")).toBeNull();
  });
});
