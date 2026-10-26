import { describe, expect, it, vi } from "vitest";
import { shopifyAdminGraphql, throttleWaitMs, type ShopifyGraphqlDeps } from "@/modules/shopify/graphql/client";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const cost = (available: number, requested = 100, restore = 50) => ({
  requestedQueryCost: requested,
  throttleStatus: { maximumAvailable: 2000, currentlyAvailable: available, restoreRate: restore },
});

function deps(responses: Array<Response | Error>): ShopifyGraphqlDeps & { sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleeps,
    fetch: vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    }),
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
    }),
  };
}

describe("shopifyAdminGraphql", () => {
  it("returns data and does not pause while the bucket has room", async () => {
    const d = deps([json({ data: { shop: { name: "Demo" } }, extensions: { cost: cost(1900) } })]);
    const result = await shopifyAdminGraphql<{ shop: { name: string } }>("demo.myshopify.com", "tok", "{ shop { name } }", {}, d);
    expect(result.data.shop.name).toBe("Demo");
    expect(d.sleeps).toEqual([]);
    const [url, init] = vi.mocked(d.fetch).mock.calls[0];
    expect(url).toBe("https://demo.myshopify.com/admin/api/2026-04/graphql.json");
    expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("tok");
  });

  it("waits for the restore rate and retries when THROTTLED", async () => {
    const d = deps([
      json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: { cost: cost(20, 120, 50) } }),
      json({ data: { ok: true }, extensions: { cost: cost(1500) } }),
    ]);
    await expect(shopifyAdminGraphql("demo.myshopify.com", "tok", "q", {}, d)).resolves.toMatchObject({ data: { ok: true } });
    expect(d.sleeps).toEqual([2000]);
  });

  it("paces the next call when the bucket is nearly empty", async () => {
    const d = deps([json({ data: { ok: true }, extensions: { cost: cost(50, 150, 100) } })]);
    await shopifyAdminGraphql("demo.myshopify.com", "tok", "q", {}, d);
    expect(d.sleeps).toEqual([1000]);
  });

  it("backs off on HTTP 429 and gives up after repeated throttling", async () => {
    const limited = () => Object.assign(new Error("Shopify rate limited the request."), { status: 429 });
    const d = deps([limited(), limited(), limited(), limited(), limited()]);
    await expect(shopifyAdminGraphql("demo.myshopify.com", "tok", "q", {}, d)).rejects.toMatchObject({ status: 429 });
    expect(d.sleeps).toEqual([1000, 2000, 4000, 8000, 10000]);
  });

  it("surfaces an auth failure without retrying", async () => {
    const d = deps([json({ errors: "Invalid API key or access token" }, 401)]);
    await expect(shopifyAdminGraphql("demo.myshopify.com", "tok", "q", {}, d)).rejects.toMatchObject({
      status: 401,
      code: "SHOPIFY_AUTH",
    });
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws GraphQL errors that are not throttling", async () => {
    const d = deps([json({ errors: [{ message: "Field 'nope' doesn't exist" }] })]);
    await expect(shopifyAdminGraphql("demo.myshopify.com", "tok", "q", {}, d)).rejects.toThrow("Field 'nope' doesn't exist");
  });

  it("caps throttle waits", () => {
    expect(throttleWaitMs(cost(0, 1000, 1))).toBe(10_000);
    expect(throttleWaitMs(undefined)).toBe(0);
  });
});
