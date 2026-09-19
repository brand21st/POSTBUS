import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { encryptSecret } from "@/lib/security/crypto";
import {
  normalizeShopDomain,
  resolveShopifyAppCredentials,
  resolveShopifyWebhookSecret,
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
    expect(normalizeShopDomain("https://demo.myshopify.com/")).toBe("demo.myshopify.com");
    expect(normalizeShopDomain("demo.myshopify.com")).toBe("demo.myshopify.com");
  });

  it("prefers encrypted org credentials over env fallbacks", () => {
    const row = {
      encrypted_api_key: encryptSecret("org-key"),
      encrypted_api_secret: encryptSecret("org-secret"),
      requested_scopes: "read_orders,write_orders",
    };
    expect(resolveShopifyAppCredentials(row)).toEqual({
      apiKey: "org-key",
      apiSecret: "org-secret",
      scopes: "read_orders,write_orders",
    });
    expect(resolveShopifyWebhookSecret(row)).toBe("org-secret");
    expect(shopifyAppConfiguredFor(row)).toBe(true);
  });

  it("builds an install URL from passed credentials", () => {
    const url = new URL(
      shopifyInstallUrl("https://demo.myshopify.com/", "state-1", {
        apiKey: "client-id",
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
