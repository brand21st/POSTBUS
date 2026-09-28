import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import { updateOrderWeights } from "@/modules/orders/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OPERATOR",
  permissions: ["orders.write"],
};

const lineId = "11111111-1111-4111-8111-111111111111";

function weightsClient(shipmentStatus: string) {
  const updates: Array<{ table: string; values: unknown }> = [];
  const orderRow = {
    id: "ord-1",
    order_number: "#1",
    parcel_weight_mode: "manual",
    parcel_weight_grams: 750,
    customers: null,
    shipping_invoices: [],
    order_line_items: [{ id: lineId, title: "Kurta", quantity: 1, unit_price: 10, weight_grams: 500 }],
    shipments: [{ id: "ship-1", status: shipmentStatus }],
  };
  return {
    updates,
    from(table: string) {
      let data: unknown = {};
      if (table === "orders") data = orderRow;
      if (table === "shipments") data = [{ id: "ship-1", status: shipmentStatus }];
      if (table === "order_line_items") data = [{ id: lineId }];
      const payload = { data, error: null };
      const self: Record<string, unknown> = {};
      self.select = () => self;
      self.eq = () => self;
      self.in = () => self;
      self.update = (values: unknown) => {
        updates.push({ table, values });
        return self;
      };
      self.maybeSingle = async () => payload;
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(payload).then(resolve, reject);
      return self;
    },
  };
}

describe("updateOrderWeights", () => {
  it("saves each product weight and copies the manual box weight onto an open shipment", async () => {
    const client = weightsClient("QUEUED");
    await updateOrderWeights(client as never, ctx, "ord-1", {
      parcelWeightMode: "manual",
      parcelWeightGrams: 750,
      lineItems: [{ id: lineId, weightGrams: 500 }],
    });
    expect(client.updates).toEqual(
      expect.arrayContaining([
        { table: "order_line_items", values: { weight_grams: 500, weight_edited: true } },
        { table: "orders", values: { parcel_weight_mode: "manual", parcel_weight_grams: 750 } },
        { table: "shipments", values: { weight_grams: 750 } },
      ])
    );
  });

  it("rejects the save after India Post booking", async () => {
    const client = weightsClient("BOOKED");
    await expect(
      updateOrderWeights(client as never, ctx, "ord-1", {
        parcelWeightMode: "auto",
        lineItems: [{ id: lineId, weightGrams: 500 }],
      })
    ).rejects.toBeInstanceOf(AppError);
    expect(client.updates).toEqual([]);
  });

  it("keeps an auto product weight editable by Shopify", async () => {
    const client = weightsClient("DRAFT");
    await updateOrderWeights(client as never, ctx, "ord-1", {
      parcelWeightMode: "auto",
      lineItems: [{ id: lineId, weightGrams: 500, weightMode: "auto" }],
    });
    expect(client.updates).toEqual(
      expect.arrayContaining([{ table: "order_line_items", values: { weight_grams: 500, weight_edited: false } }])
    );
  });
});
