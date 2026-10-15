import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { confirmShopifyPayment } from "@/modules/orders/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "MANAGER",
  permissions: ["orders.write"],
};

function mockClient(order: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      const self = () => query;
      query.select = self;
      query.eq = self;
      query.in = self;
      query.is = self;
      query.insert = self;
      query.update = (row: unknown) => {
        if (table === "orders" || table === "shipments") updates.push({ table, ...(row as object) });
        return query;
      };
      query.maybeSingle = async () => {
        if (table === "orders" && updates.some((row) => row.table === "orders")) {
          return { data: { ...order, ...updates.find((row) => row.table === "orders") }, error: null };
        }
        if (table === "orders") return { data: order, error: null };
        return { data: order, error: null };
      };
      query.single = query.maybeSingle;
      query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: table === "orders" ? order : [], error: null }).then(resolve, reject);
      return query;
    },
  };
}

describe("confirmShopifyPayment", () => {
  it("confirms a tenant-scoped Shopify PENDING order as COD", async () => {
    const client = mockClient({
      id: "order-1",
      source: "SHOPIFY",
      payment_status: "PENDING",
      total_amount: 499,
      metadata: {},
      organization_id: "org-1",
    });
    await confirmShopifyPayment(client as never, ctx, "order-1", "COD");
    expect(client.updates.find((row) => row.table === "orders")).toEqual(
      expect.objectContaining({ payment_status: "COD", amount_paid: 0, cod_amount: 499 })
    );
  });

  it("rejects confirmation for another organization's order", async () => {
    const client = {
      from: () => ({
        select: () => client.from(),
        eq: () => client.from(),
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    };
    await expect(confirmShopifyPayment(client as never, ctx, "order-other", "PREPAID")).rejects.toBeInstanceOf(AppError);
  });

  it("confirms prepaid as booking PAID without treating it as a captured Shopify payment", async () => {
    const client = mockClient({
      id: "order-1",
      source: "SHOPIFY",
      payment_status: "PENDING",
      total_amount: 320,
      metadata: {},
      organization_id: "org-1",
    });
    await confirmShopifyPayment(client as never, ctx, "order-1", "PREPAID");
    expect(client.updates.find((row) => row.table === "orders")).toEqual(
      expect.objectContaining({
        payment_status: "PAID",
        amount_paid: 320,
        cod_amount: 0,
        metadata: expect.objectContaining({
          shopifyPayment: expect.objectContaining({
            collectionMode: "PREPAID",
            reason: "merchant_override:prepaid",
          }),
        }),
      })
    );
    expect(client.updates.find((row) => row.table === "shipments")).toEqual(
      expect.objectContaining({ payment_mode: "PREPAID", cod_amount: 0 })
    );
  });

  it("rejects a duplicate confirmation after the order is no longer PENDING", async () => {
    const client = mockClient({
      id: "order-1",
      source: "SHOPIFY",
      payment_status: "PAID",
      total_amount: 320,
      metadata: {},
    });
    await expect(confirmShopifyPayment(client as never, ctx, "order-1", "PREPAID")).rejects.toBeInstanceOf(AppError);
  });

  it("does not confirm non-Shopify orders", async () => {
    const client = mockClient({
      id: "order-1",
      source: "MANUAL",
      payment_status: "PENDING",
      total_amount: 100,
      metadata: {},
    });
    await expect(confirmShopifyPayment(client as never, ctx, "order-1", "PREPAID")).rejects.toBeInstanceOf(AppError);
  });
});
