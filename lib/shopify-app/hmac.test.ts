import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyShopifyAppWebhookHmac } from "@/lib/shopify-app/hmac";
import { verifyWebhookHmac } from "@/modules/shopify/oauth";

describe("public app webhook HMAC", () => {
  it("accepts a matching digest with timing-safe compare", () => {
    const digest = createHmac("sha256", "public-secret").update("{}", "utf8").digest("base64");
    expect(verifyShopifyAppWebhookHmac("{}", digest, "public-secret")).toBe(true);
  });

  it("rejects the BYO connector secret", () => {
    const digest = createHmac("sha256", "byo-secret").update("{}", "utf8").digest("base64");
    expect(verifyShopifyAppWebhookHmac("{}", digest, "public-secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyShopifyAppWebhookHmac("{}", null, "public-secret")).toBe(false);
  });
});

describe("BYO Shopify webhook HMAC remains unchanged", () => {
  it("still verifies with SHOPIFY_API_SECRET", () => {
    const previous = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = "byo-platform-secret";
    const digest = createHmac("sha256", "byo-platform-secret").update("{}", "utf8").digest("base64");
    expect(verifyWebhookHmac("{}", digest)).toBe(true);
    process.env.SHOPIFY_API_SECRET = previous;
  });
});
