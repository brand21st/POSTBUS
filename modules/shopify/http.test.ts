import { describe, expect, it, vi } from "vitest";
import {
  fetchWithShopifyTimeout,
  isShopifyHostLookupFailure,
  shopifyHttpError,
} from "@/modules/shopify/http";

describe("fetchWithShopifyTimeout", () => {
  it("throws a retryable 429 error", async () => {
    const deps = {
      fetch: vi.fn().mockResolvedValue({
        status: 429,
        ok: false,
        headers: new Headers(),
      }),
      fetchViaPublicDns: vi.fn(),
    };
    await expect(fetchWithShopifyTimeout("https://example.myshopify.com/orders.json", {}, 20_000, deps)).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
    expect(deps.fetchViaPublicDns).not.toHaveBeenCalled();
  });

  it("maps abort timeouts to ETIMEDOUT", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const deps = {
      fetch: vi.fn().mockRejectedValue(abort),
      fetchViaPublicDns: vi.fn(),
    };
    await expect(fetchWithShopifyTimeout("https://example.myshopify.com/orders.json", {}, 20_000, deps)).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
    expect(deps.fetchViaPublicDns).not.toHaveBeenCalled();
  });

  it("retries after an OS DNS miss using public DNS", async () => {
    const missing = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    });
    const deps = {
      fetch: vi.fn().mockRejectedValue(missing),
      fetchViaPublicDns: vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers() }),
    };
    const response = await fetchWithShopifyTimeout("https://example.myshopify.com/orders.json", {}, 20_000, deps);
    expect(response.status).toBe(200);
    expect(deps.fetchViaPublicDns).toHaveBeenCalledTimes(1);
  });
});

describe("isShopifyHostLookupFailure", () => {
  it("detects nested ENOTFOUND from undici fetch", () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND shop.myshopify.com"), { code: "ENOTFOUND" }),
    });
    expect(isShopifyHostLookupFailure(error)).toBe(true);
  });
});

describe("shopifyHttpError", () => {
  it("attaches HTTP status for worker classification", () => {
    expect(shopifyHttpError("nope", 503).status).toBe(503);
  });
});
