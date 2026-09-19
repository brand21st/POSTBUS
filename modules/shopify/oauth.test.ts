import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { verifyWebhookHmac } from "@/modules/shopify/oauth";

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
});
