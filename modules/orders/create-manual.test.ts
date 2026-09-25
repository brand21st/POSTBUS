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
  role: "OPERATOR",
  permissions: ["orders.write"],
};

const payload = {
  orderNumber: "PB-MANUAL-1",
  customer: { name: "Priya Stores", phone: "9876543210", email: "priya@example.com" },
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
  paymentStatus: "PAID" as const,
  lineItems: [{ title: "Cotton kurta", sku: "KURTA-1", quantity: 2, unitPrice: 499, weightGrams: 350 }],
};

function chain(result: { data: unknown; error: unknown; count?: number | null }) {
  const query: Record<string, unknown> = {};
  const self = () => query;
  query.select = self;
  query.insert = (row: unknown) => {
    query.inserted = row;
    return query;
  };
  query.eq = self;
  query.single = () => Promise.resolve({ data: result.data, error: result.error });
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error, count: result.count ?? null }).then(resolve, reject);
  return query;
}

function mockClient() {
  const inserts: Record<string, unknown> = {};
  return {
    inserts,
    from: (table: string) => {
      if (table === "customers") {
        const q = chain({ data: { id: "cust-1", name: "Priya Stores" }, error: null });
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
          data: {
            id: "order-1",
            order_number: "PB-MANUAL-1",
            source: "MANUAL",
            status: "READY",
          },
          error: null,
          count: 3,
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

describe("createOrderSchema", () => {
  it("accepts the dashboard/orders/new payload", () => {
    const parsed = createOrderSchema.parse({
      ...payload,
      createShipment: false,
    });
    expect(parsed.source).toBeUndefined();
    expect(parsed.customer.name).toBe("Priya Stores");
    expect(parsed.lineItems[0]?.unitPrice).toBe(499);
  });

  it("requires an advance for partial payment", () => {
    expect(() =>
      createOrderSchema.parse({
        ...payload,
        paymentStatus: "PARTIAL",
      })
    ).toThrow();
  });

  it("accepts a partial COD remainder", () => {
    const parsed = createOrderSchema.parse({
      ...payload,
      paymentStatus: "PARTIAL",
      amountPaid: 200,
    });
    expect(parsed.amountPaid).toBe(200);
  });

  it("rejects a bad pincode", () => {
    expect(() =>
      createOrderSchema.parse({
        ...payload,
        shippingAddress: { ...payload.shippingAddress, pincode: "6823" },
      })
    ).toThrow();
  });
});

describe("createManualOrder", () => {
  it("writes customer, address, MANUAL READY order, line items, and audit to the database", async () => {
    const client = mockClient();
    const result = await createManualOrder(client as never, ctx, createOrderSchema.parse(payload));

    expect(result.id).toBe("order-1");
    expect(client.inserts.customers).toMatchObject({
      organization_id: "org-1",
      name: "Priya Stores",
      phone: "9876543210",
    });
    expect(client.inserts.addresses).toMatchObject({
      organization_id: "org-1",
      customer_id: "cust-1",
      pincode: "682311",
      line1: "12 MG Road",
    });
    expect(client.inserts.orders).toMatchObject({
      organization_id: "org-1",
      source: "MANUAL",
      order_number: "PB-MANUAL-1",
      customer_id: "cust-1",
      shipping_address_id: "addr-1",
      billing_address_id: "addr-1",
      subtotal: 998,
      total_amount: 998,
      payment_status: "PAID",
      amount_paid: 998,
      cod_amount: 0,
      fulfillment_status: "UNFULFILLED",
      status: "READY",
    });
    expect(client.inserts.lineItems).toEqual([
      {
        organization_id: "org-1",
        order_id: "order-1",
        title: "Cotton kurta",
        sku: "KURTA-1",
        quantity: 2,
        unit_price: 499,
        weight_grams: 350,
      },
    ]);
    expect(client.inserts.audit).toMatchObject({
      action: "order.created",
      entity_type: "order",
      entity_id: "order-1",
      after: { orderNumber: "PB-MANUAL-1", source: "MANUAL" },
    });
  });

  it("stores full COD as the collect-on-delivery amount", async () => {
    const client = mockClient();
    await createManualOrder(
      client as never,
      ctx,
      createOrderSchema.parse({ ...payload, paymentStatus: "COD" })
    );
    expect(client.inserts.orders).toMatchObject({
      payment_status: "COD",
      amount_paid: 0,
      cod_amount: 998,
    });
  });

  it("stores partial payment and remaining COD", async () => {
    const client = mockClient();
    await createManualOrder(
      client as never,
      ctx,
      createOrderSchema.parse({ ...payload, paymentStatus: "PARTIAL", amountPaid: 300 })
    );
    expect(client.inserts.orders).toMatchObject({
      payment_status: "PARTIAL",
      amount_paid: 300,
      cod_amount: 698,
      total_amount: 998,
    });
  });

  it("auto-generates an order number and keeps createShipment for the API layer", async () => {
    const client = mockClient();
    const parsed = createOrderSchema.parse({ ...payload, orderNumber: undefined, createShipment: true });
    const result = await createManualOrder(client as never, ctx, parsed);
    expect((client.inserts.orders as { order_number: string }).order_number).toMatch(/^PB-/);
    expect(result.createShipment).toBe(true);
  });
});
