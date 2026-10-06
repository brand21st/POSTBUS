import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { createOrderSchema } from "@/modules/orders/schema";
import { createManualOrder } from "@/modules/orders/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "MANAGER",
  permissions: ["orders.write", "products.write"],
};

const catalog = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Premium T-Shirt",
  sku: "TSHIRT-001",
  price: 999,
  weight_grams: 250,
  active: true,
  prepaid_enabled: true,
  cod_enabled: true,
  cod_advance_percent: 30,
  image_urls: [] as string[],
};

function chain(result: { data: unknown; error: unknown; count?: number | null }) {
  const query: Record<string, unknown> = {};
  const self = () => query;
  query.select = self;
  query.insert = (row: unknown) => {
    query.inserted = row;
    return query;
  };
  query.update = self;
  query.eq = self;
  query.in = self;
  query.maybeSingle = () => Promise.resolve({ data: result.data, error: result.error });
  query.single = () => Promise.resolve({ data: result.data, error: result.error });
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error, count: result.count ?? null }).then(resolve, reject);
  return query;
}

function mockClient(options?: { product?: typeof catalog | null; otherOrg?: boolean }) {
  const inserts: Record<string, unknown> = {};
  const product = options?.product === undefined ? catalog : options.product;
  return {
    inserts,
    from: (table: string) => {
      if (table === "products") {
        return chain({
          data: product ? [product] : [],
          error: null,
        });
      }
      if (table === "customers") {
        const q = chain({ data: { id: "cust-1" }, error: null });
        const originalInsert = q.insert as (row: unknown) => unknown;
        q.insert = (row: unknown) => {
          inserts.customers = row;
          return originalInsert(row);
        };
        return q;
      }
      if (table === "addresses") {
        const q = chain({ data: { id: "addr-1" }, error: null });
        const originalInsert = q.insert as (row: unknown) => unknown;
        q.insert = (row: unknown) => {
          inserts.addresses = row;
          return originalInsert(row);
        };
        return q;
      }
      if (table === "orders") {
        const q = chain({
          data: { id: "order-1", order_number: "PB-1", source: "MANUAL", status: "READY" },
          error: null,
          count: 1,
        });
        const originalInsert = q.insert as (row: unknown) => unknown;
        q.insert = (row: unknown) => {
          inserts.orders = row;
          return originalInsert(row);
        };
        return q;
      }
      if (table === "order_line_items") {
        const q = chain({ data: [{ id: "item-1" }], error: null });
        const originalInsert = q.insert as (row: unknown) => unknown;
        q.insert = (row: unknown) => {
          inserts.lineItems = row;
          return originalInsert(row);
        };
        return q;
      }
      if (table === "audit_logs") {
        const q = chain({ data: { id: "audit-1" }, error: null });
        const originalInsert = q.insert as (row: unknown) => unknown;
        q.insert = (row: unknown) => {
          inserts.audit = row;
          return originalInsert(row);
        };
        return q;
      }
      throw new Error(table);
    },
  };
}

const basePayload = {
  customer: { name: "Priya Stores", phone: "9876543210" },
  shippingAddress: {
    name: "Priya Stores",
    phone: "9876543210",
    line1: "12 MG Road",
    city: "Kochi",
    state: "Kerala",
    pincode: "682311",
    country: "IN",
  },
  billingSameAsShipping: true,
};

describe("createManualOrder catalog lines", () => {
  it("copies catalog name, sku, price, and weight and ignores client values", async () => {
    const client = mockClient();
    await createManualOrder(
      client as never,
      ctx,
      createOrderSchema.parse({
        ...basePayload,
        paymentStatus: "PAID",
        lineItems: [{ productId: catalog.id, quantity: 2, title: "hack", unitPrice: 1, weightGrams: 1 }],
      })
    );
    expect(client.inserts.lineItems).toEqual([
      {
        organization_id: "org-1",
        order_id: "order-1",
        product_id: catalog.id,
        title: "Premium T-Shirt",
        sku: "TSHIRT-001",
        quantity: 2,
        unit_price: 999,
        weight_grams: 250,
        image_url: null,
      },
    ]);
    expect(client.inserts.orders).toMatchObject({
      subtotal: 1998,
      total_amount: 1998,
      payment_status: "PAID",
      amount_paid: 1998,
      cod_amount: 0,
    });
  });

  it("applies 30% COD advance from the product", async () => {
    const client = mockClient();
    await createManualOrder(
      client as never,
      ctx,
      createOrderSchema.parse({
        ...basePayload,
        paymentStatus: "COD",
        lineItems: [{ productId: catalog.id, quantity: 1 }],
      })
    );
    expect(client.inserts.orders).toMatchObject({
      payment_status: "PARTIAL",
      amount_paid: 299.7,
      cod_amount: 699.3,
    });
  });

  it("blocks a product from another organization", async () => {
    const client = mockClient({ product: null });
    await expect(
      createManualOrder(
        client as never,
        ctx,
        createOrderSchema.parse({
          ...basePayload,
          paymentStatus: "PAID",
          lineItems: [{ productId: "22222222-2222-4222-8222-222222222222", quantity: 1 }],
        })
      )
    ).rejects.toThrow(/not found/i);
  });

  it("keeps a snapshot after the catalog price would have changed", async () => {
    const client = mockClient();
    await createManualOrder(
      client as never,
      ctx,
      createOrderSchema.parse({
        ...basePayload,
        paymentStatus: "PAID",
        lineItems: [{ productId: catalog.id, quantity: 1 }],
      })
    );
    const stored = client.inserts.lineItems as Array<{ unit_price: number; weight_grams: number }>;
    expect(stored[0]?.unit_price).toBe(999);
    expect(stored[0]?.weight_grams).toBe(250);
  });

  it("copies the catalog cover photo onto the line item", async () => {
    const client = mockClient({
      product: { ...catalog, image_urls: ["org-1/prod-1/cover.jpg"] },
    });
    await createManualOrder(
      client as never,
      ctx,
      createOrderSchema.parse({
        ...basePayload,
        paymentStatus: "PAID",
        lineItems: [{ productId: catalog.id, quantity: 1 }],
      })
    );
    const stored = client.inserts.lineItems as Array<{ image_url: string | null }>;
    expect(stored[0]?.image_url).toMatch(/cover\.jpg$/);
  });

  it("does not mark catalog COD advance as received on a pending storefront order", async () => {
    const client = mockClient();
    await createManualOrder(
      client as never,
      ctx,
      createOrderSchema.parse({
        ...basePayload,
        source: "WHATSAPP",
        paymentStatus: "PENDING",
        lineItems: [{ productId: catalog.id, quantity: 1 }],
        metadata: { storefront: { paymentPreference: "COD", expectedAdvance: 299.7 } },
      })
    );
    expect(client.inserts.orders).toMatchObject({
      payment_status: "PENDING",
      amount_paid: 0,
      source: "WHATSAPP",
    });
    expect((client.inserts.lineItems as Array<{ product_id: string }>)[0]?.product_id).toBe(catalog.id);
  });
});
