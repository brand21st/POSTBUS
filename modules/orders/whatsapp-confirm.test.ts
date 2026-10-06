import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { confirmWhatsAppOrder } from "@/modules/orders/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "MANAGER",
  permissions: ["orders.write"],
};

const catalogLine = {
  id: "line-1",
  product_id: "11111111-1111-4111-8111-111111111111",
  title: "Premium T-Shirt",
  sku: "TSHIRT-001",
  quantity: 1,
  unit_price: 999,
  weight_grams: 250,
  image_url: "cover.jpg",
};

function mockClient(options?: { alreadyConfirmed?: boolean }) {
  const updates: Record<string, unknown>[] = [];
  let deletedLines = false;
  const order = {
    id: "order-1",
    source: "WHATSAPP",
    status: "IMPORTED",
    payment_status: "PENDING",
    customer_id: "cust-1",
    shipping_address_id: "addr-1",
    metadata: {},
    total_amount: 999,
  };
  return {
    updates,
    deletedLines: () => deletedLines,
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      const self = () => query;
      query.select = self;
      query.eq = self;
      query.insert = self;
      query.delete = () => {
        deletedLines = true;
        return query;
      };
      query.update = (row: unknown) => {
        updates.push(row as Record<string, unknown>);
        return query;
      };
      query.maybeSingle = async () => {
        if (table === "orders" && updates.length) {
          return { data: options?.alreadyConfirmed ? null : { ...order, ...updates[0] }, error: null };
        }
        if (table === "orders") return { data: order, error: null };
        return { data: null, error: null };
      };
      query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (table === "order_line_items") {
          return Promise.resolve({ data: [catalogLine], error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      };
      return query;
    },
  };
}

describe("confirmWhatsAppOrder catalog snapshot", () => {
  it("records the amount actually received without replacing catalog lines", async () => {
    const client = mockClient();
    await confirmWhatsAppOrder(client as never, ctx, "order-1", {
      paymentType: "COD",
      amount: 200,
      lineItems: [{ title: "hack", quantity: 1, unitPrice: 1 }],
    });
    expect(client.updates[0]).toMatchObject({
      payment_status: "PARTIAL",
      amount_paid: 200,
      cod_amount: 799,
      total_amount: 999,
      status: "READY",
    });
    expect(client.deletedLines()).toBe(false);
  });

  it("treats a zero received amount as full COD collect", async () => {
    const client = mockClient();
    await confirmWhatsAppOrder(client as never, ctx, "order-1", {
      paymentType: "COD",
      amount: 0,
    });
    expect(client.updates[0]).toMatchObject({
      payment_status: "COD",
      amount_paid: 0,
      cod_amount: 999,
    });
  });

  it("records a short prepaid receipt as partial instead of marking the order paid", async () => {
    const client = mockClient();
    await confirmWhatsAppOrder(client as never, ctx, "order-1", {
      paymentType: "PREPAID",
      amount: 299.7,
    });
    expect(client.updates[0]).toMatchObject({
      payment_status: "PARTIAL",
      amount_paid: 299.7,
      cod_amount: 699.3,
    });
  });
});
