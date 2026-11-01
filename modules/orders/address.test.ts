import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import {
  acceptOrderShippingAddress,
  restoreOrderShippingAddress,
  revalidateOrderShippingAddress,
  updateOrderShippingAddress,
} from "@/modules/orders/service";

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
          values: expect.objectContaining({
            name: "Asha Rao",
            phone: "9876543210",
            line1: "12 MG Road",
            line2: "Near park",
            city: "Kozhikode",
            state: "Kerala",
            pincode: "673602",
            country: "IN",
            address_manual_override: true,
            address_validation_status: "READY",
            address_review_required: false,
            address_normalization_source: "manual",
          }),
        },
      ])
    );
    expect(client.updates).toEqual(
      expect.arrayContaining([
        {
          table: "customers",
          values: { name: "Asha Rao", phone: "9876543210" },
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

  it("writes a 91-prefixed number as 10 digits on both customer and address", async () => {
    const client = addressClient({ shipmentStatus: "QUEUED" });
    await updateOrderShippingAddress(client as never, ctx, "ord-1", {
      ...address,
      phone: "919876543210",
    });
    expect(client.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "addresses", values: expect.objectContaining({ phone: "9876543210" }) }),
        expect.objectContaining({ table: "customers", values: expect.objectContaining({ phone: "9876543210" }) }),
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

function reviewClient(addressRow: Record<string, unknown>, options?: { updateData?: unknown }) {
  const updates: Array<{ table: string; values: unknown }> = [];
  const eqs: Array<{ table: string; column: string; value: unknown }> = [];
  let addressReads = 0;
  const orderRow = {
    id: "ord-1",
    customer_id: "cust-1",
    shipping_address_id: "addr-1",
    order_number: "#1",
    customers: null,
    shipping_invoices: [],
    order_line_items: [],
    shipments: [{ id: "ship-1", status: "QUEUED" }],
    shipping_address: { id: "addr-1", ...addressRow },
  };
  return {
    updates,
    eqs,
    from(table: string) {
      let data: unknown = {};
      if (table === "orders") data = orderRow;
      if (table === "shipments") data = [{ id: "ship-1", status: "QUEUED" }];
      if (table === "addresses") data = { id: "addr-1", ...addressRow };
      const payload = { data, error: null };
      const self: Record<string, unknown> = {};
      self.select = () => self;
      self.eq = (column: string, value: unknown) => {
        eqs.push({ table, column, value });
        return self;
      };
      self.in = () => self;
      self.insert = () => self;
      self.update = (values: unknown) => {
        updates.push({ table, values });
        return self;
      };
      self.single = async () => ({ data, error: null });
      self.maybeSingle = async () => {
        if (table === "addresses") {
          addressReads += 1;
          if (options && "updateData" in options && addressReads > 1) {
            return { data: options.updateData, error: null };
          }
        }
        return payload;
      };
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(payload).then(resolve, reject);
      return self;
    },
  };
}

const shopifyOriginal = {
  name: "Rahul K",
  first_name: "Rahul",
  last_name: "K",
  phone: "9876543210",
  company: "",
  address1: "Rose Villa, Rose Villa, Kalpetta, Kerala, Kerala",
  address2: "",
  city: "Kalpetta",
  province: "Kerala",
  zip: "673121",
  country: "IN",
};

describe("address review actions", () => {
  it("P0-01 accepts only a fully eligible suggestion", async () => {
    const client = reviewClient({
      ...address,
      address_validation_status: "NEEDS_REVIEW",
      address_normalized_at: "2026-10-30T10:00:00.000Z",
    });
    await acceptOrderShippingAddress(client as never, ctx, "ord-1");
    expect(client.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "addresses",
          values: expect.objectContaining({
            address_validation_status: "READY",
            address_manual_override: true,
          }),
        }),
      ])
    );
    expect(client.eqs).toEqual(expect.arrayContaining([expect.objectContaining({ column: "organization_id", value: "org-1" })]));
  });

  it("P0-01 rejects invalid phone, PIN, city, recipient, and over-long lines", async () => {
    await expect(
      acceptOrderShippingAddress(
        reviewClient({ ...address, phone: "12345", address_validation_status: "NEEDS_REVIEW" }) as never,
        ctx,
        "ord-1"
      )
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      acceptOrderShippingAddress(
        reviewClient({ ...address, pincode: "12", address_validation_status: "NEEDS_REVIEW" }) as never,
        ctx,
        "ord-1"
      )
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      acceptOrderShippingAddress(
        reviewClient({ ...address, city: "", address_validation_status: "NEEDS_REVIEW" }) as never,
        ctx,
        "ord-1"
      )
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      acceptOrderShippingAddress(
        reviewClient({ ...address, name: "", address_validation_status: "NEEDS_REVIEW" }) as never,
        ctx,
        "ord-1"
      )
    ).rejects.toBeInstanceOf(AppError);
    const longLine = "X".repeat(81);
    await expect(
      acceptOrderShippingAddress(
        reviewClient({
          ...address,
          line1: longLine,
          line2: longLine,
          line3: longLine,
          address_validation_status: "NEEDS_REVIEW",
        }) as never,
        ctx,
        "ord-1"
      )
    ).rejects.toBeInstanceOf(AppError);
  });

  it("P0-01 rejects a concurrent overwrite", async () => {
    await expect(
      acceptOrderShippingAddress(
        reviewClient(
          {
            ...address,
            address_validation_status: "NEEDS_REVIEW",
            address_normalized_at: "2026-10-30T10:00:00.000Z",
          },
          { updateData: null }
        ) as never,
        ctx,
        "ord-1"
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("P0-05 revalidate keeps a manual override and the merchant street", async () => {
    const client = reviewClient({
      ...address,
      line1: "Merchant corrected house",
      address_manual_override: true,
      original_shipping: shopifyOriginal,
    });
    await revalidateOrderShippingAddress(client as never, ctx, "ord-1");
    expect(client.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "addresses",
          values: expect.objectContaining({
            address_manual_override: true,
            address_normalization_source: "revalidate",
          }),
        }),
      ])
    );
    const patch = client.updates.find((row) => row.table === "addresses")?.values as Record<string, unknown>;
    expect(patch.line1).toBeUndefined();
  });

  it("P0-06 restore writes the original fields and a status for those fields", async () => {
    const client = reviewClient({
      ...address,
      line1: "Merchant street",
      original_shipping: shopifyOriginal,
    });
    await restoreOrderShippingAddress(client as never, ctx, "ord-1");
    expect(client.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "addresses",
          values: expect.objectContaining({
            line1: shopifyOriginal.address1,
            city: "Kalpetta",
            pincode: "673121",
            address_manual_override: true,
            address_normalization_source: "restore",
            address_validation_status: "READY",
          }),
        }),
      ])
    );
  });

  it("P0-06 restore of an invalid original stays invalid", async () => {
    const client = reviewClient({
      ...address,
      original_shipping: { ...shopifyOriginal, zip: "12", phone: "12345" },
    });
    await restoreOrderShippingAddress(client as never, ctx, "ord-1");
    const patch = client.updates.find((row) => row.table === "addresses")?.values as Record<string, unknown>;
    expect(patch.pincode).toBe("12");
    expect(patch.phone).toBe("12345");
    expect(patch.address_validation_status).toBe("INVALID");
  });

  it("blocks restore after booking", async () => {
    const client = addressClient({ shipmentStatus: "BOOKED" });
    await expect(restoreOrderShippingAddress(client as never, ctx, "ord-1")).rejects.toBeInstanceOf(AppError);
  });
});
