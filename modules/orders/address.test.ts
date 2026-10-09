import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import { updateOrderShippingAddress } from "@/modules/orders/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OPERATOR",
  permissions: ["orders.write"],
};

const address = {
  name: "Asha Rao",
  phone: "9876543210",
  line1: "12 MG Road",
  line2: "Near park",
  city: "Kozhikode",
  state: "Kerala",
  pincode: "673602",
  country: "IN",
};

function addressClient(options: { shipmentStatus: string; shippingAddressId?: string | null }) {
  const updates: Array<{ table: string; values: unknown }> = [];
  const inserts: Array<{ table: string; values: unknown }> = [];
  const orderRow = {
    id: "ord-1",
    customer_id: "cust-1",
    shipping_address_id: options.shippingAddressId === undefined ? "addr-1" : options.shippingAddressId,
    order_number: "#1",
    customers: null,
    shipping_invoices: [],
    order_line_items: [],
    shipments: [{ id: "ship-1", status: options.shipmentStatus }],
    shipping_address: { id: "addr-1", ...address },
  };
  return {
    updates,
    inserts,
    from(table: string) {
      let data: unknown = {};
      if (table === "orders") data = orderRow;
      if (table === "shipments") data = [{ id: "ship-1", status: options.shipmentStatus }];
      if (table === "addresses") data = { id: "addr-new", ...address };
      const payload = { data, error: null };
      const self: Record<string, unknown> = {};
      self.select = () => self;
      self.eq = () => self;
      self.in = () => self;
      self.insert = (values: unknown) => {
        inserts.push({ table, values });
        return self;
      };
      self.update = (values: unknown) => {
        updates.push({ table, values });
        return self;
      };
      self.single = async () => payload;
      self.maybeSingle = async () => payload;
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(payload).then(resolve, reject);
      return self;
    },
  };
}

describe("updateOrderShippingAddress", () => {
  it("saves the shipping address on an open shipment", async () => {
    const client = addressClient({ shipmentStatus: "QUEUED" });
    await updateOrderShippingAddress(client as never, ctx, "ord-1", address);
    expect(client.updates).toEqual(
      expect.arrayContaining([
        {
          table: "addresses",
          values: {
            name: "Asha Rao",
            phone: "9876543210",
            line1: "12 MG Road",
            line2: "Near park",
            city: "Kozhikode",
            state: "Kerala",
            pincode: "673602",
            country: "IN",
          },
        },
      ])
    );
    expect(client.inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "audit_logs",
          values: expect.objectContaining({ action: "order.shipping_address_updated" }),
        }),
      ])
    );
  });

  it("rejects the save after India Post booking", async () => {
    const client = addressClient({ shipmentStatus: "BOOKED" });
    await expect(updateOrderShippingAddress(client as never, ctx, "ord-1", address)).rejects.toBeInstanceOf(
      AppError
    );
    expect(client.updates).toEqual([]);
  });

  it("inserts a shipping address when the order has none", async () => {
    const client = addressClient({ shipmentStatus: "DRAFT", shippingAddressId: null });
    await updateOrderShippingAddress(client as never, ctx, "ord-1", address);
    expect(client.inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "addresses" }),
        expect.objectContaining({ table: "audit_logs" }),
      ])
    );
    expect(client.updates).toEqual(
      expect.arrayContaining([{ table: "orders", values: { shipping_address_id: "addr-new" } }])
    );
  });
});
