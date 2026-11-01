import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isInboundWebhookPath } from "@/lib/api/v1/inbound-webhooks";
import { handleV1 } from "@/lib/api/v1/handle";

describe("existing v1 Shopify BYO path is unchanged", () => {
  it("still owns POST /api/v1/webhooks/shopify and not the public-app route", () => {
    expect(isInboundWebhookPath("webhooks/shopify")).toBe(true);
    expect(isInboundWebhookPath("shopify/webhooks")).toBe(false);
    expect(typeof handleV1).toBe("function");
  });

  it("does not mix the public-app secret into BYO HMAC verification", () => {
    const source = readFileSync("modules/shopify/oauth.ts", "utf8");
    expect(source).toContain("env.shopifyApiSecret");
    expect(source).not.toContain("shopifyPublicAppClientSecret");
  });
});
