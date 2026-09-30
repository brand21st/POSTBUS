import { describe, expect, it, vi } from "vitest";
import { fetchWithShopifyTimeout, shopifyHttpError } from "@/modules/shopify/http";

describe("fetchWithShopifyTimeout", () => {
  it("throws a retryable 429 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 429,
        ok: false,
        headers: new Headers(),
      })
    );
    await expect(fetchWithShopifyTimeout("https://example.myshopify.com/orders.json")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
    vi.unstubAllGlobals();
  });

  it("maps abort timeouts to ETIMEDOUT", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(fetchWithShopifyTimeout("https://example.myshopify.com/orders.json")).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
    vi.unstubAllGlobals();
  });
});

describe("shopifyHttpError", () => {
  it("attaches HTTP status for worker classification", () => {
    expect(shopifyHttpError("nope", 503).status).toBe(503);
  });
});
