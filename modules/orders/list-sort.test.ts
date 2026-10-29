import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { orderListQuery } from "@/modules/orders/schema";
import { listOrders, resolveOrderListSort } from "@/modules/orders/service";

vi.mock("@/modules/shopify/orders", () => ({
  enrichShopifyLineItemImagesFromCache: () => undefined,
  enrichShopifyLineItemImagesInOrders: async () => undefined,
}));

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OPERATOR",
  permissions: ["orders.read"],
};

describe("resolveOrderListSort", () => {
  it("defaults to newest first", () => {
    expect(resolveOrderListSort(undefined)).toEqual({ mode: "created", ascending: false });
    expect(resolveOrderListSort("-created_at")).toEqual({ mode: "created", ascending: false });
  });

  it("sorts by numeric order id", () => {
    expect(resolveOrderListSort("-order_number")).toEqual({ mode: "number", ascending: false });
    expect(resolveOrderListSort("order_number")).toEqual({ mode: "number", ascending: true });
  });
});

function listClient() {
  const orders: Array<{ column: string; options?: unknown }> = [];
  return {
    orders,
    from() {
      const self: Record<string, unknown> = {};
      let head = false;
      const chain = () => self;
      self.select = (_cols: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return self;
      };
      self.eq = chain;
      self.gte = chain;
      self.lte = chain;
      self.or = chain;
      self.order = (column: string, options?: unknown) => {
        if (!head) orders.push({ column, options });
        return self;
      };
      self.range = chain;
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
      return self;
    },
  };
}

describe("listOrders sort", () => {
  it("orders by created_at descending by default", async () => {
    const client = listClient();
    await listOrders(client as never, ctx, orderListQuery.parse({ page: "1", pageSize: "20" }));
    expect(client.orders).toEqual([{ column: "created_at", options: { ascending: false } }]);
  });

  it("orders by order_number_sort descending when sort is -order_number", async () => {
    const client = listClient();
    await listOrders(
      client as never,
      ctx,
      orderListQuery.parse({ page: "1", pageSize: "20", sort: "-order_number" })
    );
    expect(client.orders[0]).toEqual({
      column: "order_number_sort",
      options: { ascending: false, nullsFirst: false },
    });
  });
});
