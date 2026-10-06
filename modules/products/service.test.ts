import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { adjustProductStock, createProduct, getProduct, listProducts, updateProduct } from "@/modules/products/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "owner@example.com",
  fullName: "Owner",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OWNER",
  permissions: ["products.read", "products.write"],
};

const productRow = {
  id: "prod-1",
  organization_id: "org-1",
  name: "Premium T-Shirt",
  sku: "TSHIRT-001",
  price: 999,
  weight_grams: 250,
  active: true,
  prepaid_enabled: true,
  cod_enabled: true,
  cod_advance_percent: 30,
  created_at: "2026-10-07T00:00:00.000Z",
  updated_at: "2026-10-07T00:00:00.000Z",
  image_urls: [] as string[],
  inventory_balances: [{ on_hand: 100, reserved: 0 }],
};

function chain(result: { data: unknown; error: unknown; count?: number | null }) {
  const query: Record<string, unknown> = { filters: {} as Record<string, unknown> };
  const self = () => query;
  query.select = self;
  query.insert = self;
  query.update = self;
  query.eq = (column: string, value: unknown) => {
    (query.filters as Record<string, unknown>)[column] = value;
    return query;
  };
  query.in = self;
  query.or = self;
  query.order = self;
  query.range = self;
  query.maybeSingle = () => {
    const filters = query.filters as Record<string, unknown>;
    if (filters.organization_id && filters.organization_id !== productRow.organization_id) {
      return Promise.resolve({ data: null, error: null });
    }
    if (filters.id && filters.id !== productRow.id) {
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: result.data, error: result.error });
  };
  query.single = () => Promise.resolve({ data: result.data, error: result.error });
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error, count: result.count ?? 1 }).then(resolve, reject);
  return query;
}

function mockClient(overrides?: { rpcError?: { code?: string; message: string } | null; rpcData?: unknown }) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Record<string, unknown>[] = [];
  return {
    rpcs,
    updates,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (overrides?.rpcError) return { data: null, error: overrides.rpcError };
      if (name === "inventory_product_page") {
        return {
          data: [{
            product_id: productRow.id,
            order_count: 2,
            units_sold: 3,
            revenue: 2997,
            sales_rank: 1,
            total_count: 1,
          }],
          error: null,
        };
      }
      return { data: overrides?.rpcData ?? "prod-1", error: null };
    },
    from: (table: string) => {
      if (table === "products") {
        const q = chain({ data: productRow, error: null, count: 1 });
        const originalUpdate = q.update as (row: unknown) => unknown;
        q.update = (row: unknown) => {
          updates.push(row as Record<string, unknown>);
          return originalUpdate(row);
        };
        q.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: [productRow], error: null, count: 1 }).then(resolve, reject);
        return q;
      }
      if (table === "product_category_members") {
        return chain({ data: [], error: null, count: 0 });
      }
      if (table === "product_recommendations") {
        return chain({ data: [], error: null, count: 0 });
      }
      if (table === "storefront_settings") {
        return chain({ data: { featured_product_ids: [] }, error: null, count: 0 });
      }
      throw new Error(table);
    },
  };
}

describe("product service", () => {
  it("creates a product through the atomic RPC", async () => {
    const client = mockClient();
    const created = await createProduct(client as never, ctx, {
      name: "Premium T-Shirt",
      sku: "TSHIRT-001",
      price: 999,
      weightGrams: 250,
      openingStock: 100,
      prepaidEnabled: true,
      codEnabled: true,
      codAdvancePercent: 30,
    });
    expect(client.rpcs[0]).toMatchObject({
      name: "create_inventory_product",
      args: {
        p_organization_id: "org-1",
        p_sku: "TSHIRT-001",
        p_opening_stock: 100,
        p_cod_advance_percent: 30,
      },
    });
    expect(created.onHand).toBe(100);
    expect(created.sku).toBe("TSHIRT-001");
  });

  it("lists only the current organization products", async () => {
    const client = mockClient();
    const listed = await listProducts(client as never, ctx, { page: 1, pageSize: 20 });
    expect(listed.items[0]?.id).toBe("prod-1");
    expect(listed.items[0]).toMatchObject({
      orderCount: 2,
      unitsSold: 3,
      revenue: 2997,
      bestSeller: true,
    });
    expect(listed.total).toBe(1);
    expect(client.rpcs[0]).toMatchObject({
      name: "inventory_product_page",
      args: { p_organization_id: "org-1" },
    });
  });

  it("updates catalog fields without calling stock RPC", async () => {
    const client = mockClient();
    await updateProduct(client as never, ctx, "prod-1", { price: 1099, active: false });
    expect(client.rpcs).toHaveLength(0);
    expect(client.updates[0]).toMatchObject({ price: 1099, active: false });
  });

  it("adjusts stock through adjust_inventory", async () => {
    const client = mockClient({ rpcData: { productId: "prod-1", onHand: 120, movementId: "mov-1" } });
    await adjustProductStock(client as never, ctx, "prod-1", { quantityDelta: 20, note: "New stock received" });
    expect(client.rpcs[0]).toMatchObject({
      name: "adjust_inventory",
      args: {
        p_organization_id: "org-1",
        p_product_id: "prod-1",
        p_quantity_delta: 20,
        p_reason: "ADJUSTMENT",
        p_note: "New stock received",
      },
    });
  });

  it("maps a unique SKU conflict", async () => {
    const client = mockClient({ rpcError: { code: "23505", message: "duplicate key" } });
    await expect(
      createProduct(client as never, ctx, {
        name: "Other",
        sku: "TSHIRT-001",
        price: 1,
        weightGrams: 1,
        openingStock: 0,
        prepaidEnabled: true,
        codEnabled: true,
        codAdvancePercent: 0,
      })
    ).rejects.toThrow(/SKU already exists/i);
  });

  it("does not return another organization's product", async () => {
    const client = mockClient();
    const other = { ...ctx, organizationId: "org-b" };
    await expect(getProduct(client as never, other, "prod-1")).rejects.toThrow(/not found/i);
  });
});
