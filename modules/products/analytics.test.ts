import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { getInventoryAnalytics } from "@/modules/products/analytics";
import { bulkUpdateProducts } from "@/modules/products/service";
import { replaceProductRecommendations } from "@/modules/products/recommendations";

const ctx: TenantContext = {
  userId: "user-1",
  email: "owner@example.com",
  fullName: "Owner",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OWNER",
  permissions: ["products.read", "products.write"],
};

describe("inventory analytics isolation", () => {
  it("passes the tenant organization into every analytics RPC", async () => {
    const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        return { data: name === "inventory_analytics_window" ? [{ total_products: 2, order_count: 0 }] : [], error: null };
      },
    };
    await getInventoryAnalytics(supabase as never, ctx, { range: "7d" });
    expect(rpcs.map((call) => call.name)).toEqual([
      "inventory_analytics_window",
      "inventory_top_products",
      "inventory_low_stock_products",
    ]);
    for (const call of rpcs) {
      expect(call.args.p_organization_id).toBe("org-1");
    }
  });
});

describe("bulk product updates", () => {
  it("updates only products in the current organization", async () => {
    const updates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
    const query: Record<string, unknown> = { filters: {} };
    const self = () => query;
    query.update = (patch: Record<string, unknown>) => {
      query.patch = patch;
      return query;
    };
    query.eq = (column: string, value: unknown) => {
      (query.filters as Record<string, unknown>)[column] = value;
      return query;
    };
    query.in = (column: string, value: unknown) => {
      (query.filters as Record<string, unknown>)[column] = value;
      return query;
    };
    query.select = self;
    query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      updates.push({
        patch: query.patch as Record<string, unknown>,
        filters: { ...(query.filters as Record<string, unknown>) },
      });
      return Promise.resolve({ data: [{ id: "p1" }], error: null }).then(resolve, reject);
    };
    const supabase = { from: () => query };
    const result = await bulkUpdateProducts(supabase as never, ctx, {
      ids: ["11111111-1111-4111-8111-111111111111"],
      storeVisible: false,
    });
    expect(result.updated).toBe(1);
    expect(updates[0]?.filters.organization_id).toBe("org-1");
    expect(updates[0]?.patch.store_visible).toBe(false);
  });
});

describe("product recommendations tenant checks", () => {
  it("rejects related products that are not in the organization", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ count: 0, error: null }),
          }),
        }),
      }),
    };
    await expect(
      replaceProductRecommendations(supabase as never, ctx, "11111111-1111-4111-8111-111111111111", {
        upsellProductIds: ["22222222-2222-4222-8222-222222222222"],
      })
    ).rejects.toThrow(/not found/i);
  });
});
