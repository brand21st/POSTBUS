import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import {
  setOrderShipmentDimensions,
  updateShipmentDimensions,
  updateShipmentDimensionsSchema,
} from "@/modules/shipments/service";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import { validateIndiaPostArticle } from "@/modules/india-post/article-validator";
import type { ShipmentRow } from "@/modules/india-post/article-types";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops Admin",
  organizationId: "org-1",
  organizationName: "PostBus Store",
  role: "OWNER",
  permissions: ["*"],
};

function createMockSupabase(options?: {
  shipmentRow?: Record<string, unknown> | null;
  orderRow?: Record<string, unknown> | null;
}) {
  const updates: Array<{ table: string; values: unknown }> = [];
  const inserts: Array<{ table: string; values: unknown }> = [];

  const defaultShipment = {
    id: "ship-1",
    organization_id: "org-1",
    order_id: "ord-1",
    status: "DRAFT",
    weight_grams: 500,
    length_cm: null,
    width_cm: null,
    height_cm: null,
    service_code: "SP_INLAND_PARCEL",
    orders: { order_number: "#1001", total_amount: 1500, created_at: "2026-10-01" },
    customers: { name: "Alice", phone: "9876543210" },
    addresses: [{ city: "New Delhi", state: "Delhi", pincode: "110001" }],
    pickup_locations: [{ city: "Mumbai", name: "Hub" }],
    shipping_invoices: [],
  };

  const defaultOrder = {
    id: "ord-1",
    organization_id: "org-1",
    order_number: "#1001",
    customer_id: "cust-1",
    shipping_address_id: "addr-1",
    india_post_service: "SP_INLAND_PARCEL",
    parcel_weight_mode: "auto",
    parcel_weight_grams: null,
    order_line_items: [{ quantity: 1, weight_grams: 500, unit_price: 1500 }],
    shipments: [{ id: "ship-1", status: "DRAFT", created_at: "2026-10-01" }],
  };

  const shipmentData = options?.shipmentRow !== undefined ? options.shipmentRow : defaultShipment;
  const orderData = options?.orderRow !== undefined ? options.orderRow : defaultOrder;

  return {
    updates,
    inserts,
    from(table: string) {
      const self: Record<string, unknown> = {};
      self.select = () => self;
      self.eq = (field: string, value: unknown) => {
        // Enforce organization isolation
        if (field === "organization_id" && value !== "org-1") {
          return {
            ...self,
            maybeSingle: async () => ({ data: null, error: null }),
            single: async () => ({ data: null, error: new Error("Not found") }),
          };
        }
        return self;
      };
      self.in = () => self;
      self.update = (values: unknown) => {
        updates.push({ table, values });
        return self;
      };
      self.insert = (values: unknown) => {
        inserts.push({ table, values });
        return self;
      };
      self.maybeSingle = async () => {
        if (table === "shipments") return { data: shipmentData, error: null };
        if (table === "orders") return { data: orderData, error: null };
        if (table === "india_post_connections") return { data: null, error: null };
        if (table === "india_post_contracts") return { data: [], error: null };
        return { data: null, error: null };
      };
      self.single = async () => {
        if (table === "shipments") {
          const merged = { ...shipmentData, ...(updates[updates.length - 1]?.values as Record<string, unknown> ?? {}) };
          return { data: merged, error: null };
        }
        return { data: {}, error: null };
      };
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return self;
    },
  };
}

describe("updateShipmentDimensionsSchema", () => {
  it("accepts valid parcel dimensions (within limits: L 14-150, W 9-150, H 1-150)", () => {
    const parsed = updateShipmentDimensionsSchema.parse({
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    });
    expect(parsed.lengthCm).toBe(20);
    expect(parsed.widthCm).toBe(15);
    expect(parsed.heightCm).toBe(10);
  });

  it("accepts snake_case dimension input", () => {
    const parsed = updateShipmentDimensionsSchema.parse({
      length_cm: 25.5,
      width_cm: 18,
      height_cm: 12,
    });
    expect(parsed.lengthCm).toBe(25.5);
    expect(parsed.widthCm).toBe(18);
    expect(parsed.heightCm).toBe(12);
  });

  it("coerces valid numeric strings", () => {
    const parsed = updateShipmentDimensionsSchema.parse({
      lengthCm: "20",
      widthCm: "15",
      heightCm: "10",
    });
    expect(parsed.lengthCm).toBe(20);
    expect(parsed.widthCm).toBe(15);
    expect(parsed.heightCm).toBe(10);
  });

  it("rejects length under 14 cm", () => {
    expect(() =>
      updateShipmentDimensionsSchema.parse({
        lengthCm: 13.9,
        widthCm: 15,
        heightCm: 10,
      })
    ).toThrow();
  });

  it("rejects width under 9 cm", () => {
    expect(() =>
      updateShipmentDimensionsSchema.parse({
        lengthCm: 20,
        widthCm: 8.5,
        heightCm: 10,
      })
    ).toThrow();
  });

  it("rejects height under 1 cm", () => {
    expect(() =>
      updateShipmentDimensionsSchema.parse({
        lengthCm: 20,
        widthCm: 15,
        heightCm: 0,
      })
    ).toThrow();
  });

  it("rejects dimensions exceeding 150 cm", () => {
    expect(() =>
      updateShipmentDimensionsSchema.parse({
        lengthCm: 151,
        widthCm: 15,
        heightCm: 10,
      })
    ).toThrow();
  });

  it("rejects negative dimensions", () => {
    expect(() =>
      updateShipmentDimensionsSchema.parse({
        lengthCm: -20,
        widthCm: 15,
        heightCm: 10,
      })
    ).toThrow();
  });

  it("rejects non-numeric input", () => {
    expect(() =>
      updateShipmentDimensionsSchema.parse({
        lengthCm: "twenty",
        widthCm: 15,
        heightCm: 10,
      })
    ).toThrow();
  });
});

describe("updateShipmentDimensions service", () => {
  it("updates length_cm, width_cm, height_cm on shipment and logs audit entry", async () => {
    const client = createMockSupabase();
    const result = await updateShipmentDimensions(client as never, ctx, "ship-1", {
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    });

    expect(client.updates).toHaveLength(1);
    expect(client.updates[0]).toEqual({
      table: "shipments",
      values: {
        length_cm: 20,
        width_cm: 15,
        height_cm: 10,
      },
    });

    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0].table).toBe("audit_logs");

    expect(result.lengthCm).toBe(20);
    expect(result.widthCm).toBe(15);
    expect(result.heightCm).toBe(10);
  });

  it("rejects update if shipment is already booked with India Post", async () => {
    const client = createMockSupabase({
      shipmentRow: {
        id: "ship-1",
        organization_id: "org-1",
        status: "BOOKED",
      },
    });

    await expect(
      updateShipmentDimensions(client as never, ctx, "ship-1", {
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      })
    ).rejects.toThrow(AppError);
  });

  it("rejects update for shipment of another organization", async () => {
    const client = createMockSupabase({ shipmentRow: null });
    await expect(
      updateShipmentDimensions(client as never, ctx, "ship-other", {
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      })
    ).rejects.toThrow(AppError);
  });
});

describe("setOrderShipmentDimensions service", () => {
  it("updates existing draft shipment if order already has one", async () => {
    const client = createMockSupabase();
    const result = await setOrderShipmentDimensions(client as never, ctx, "ord-1", {
      lengthCm: 22,
      widthCm: 16,
      heightCm: 11,
    });

    expect(client.updates).toHaveLength(1);
    expect(client.updates[0].values).toEqual({
      length_cm: 22,
      width_cm: 16,
      height_cm: 11,
    });
    expect(result.lengthCm).toBe(22);
  });

  it("creates a draft shipment with dimensions if order has no shipment yet", async () => {
    const client = createMockSupabase({
      orderRow: {
        id: "ord-1",
        organization_id: "org-1",
        order_number: "#1001",
        customer_id: "cust-1",
        shipping_address_id: "addr-1",
        india_post_service: "SP_INLAND_PARCEL",
        parcel_weight_mode: "auto",
        parcel_weight_grams: null,
        order_line_items: [{ quantity: 1, weight_grams: 600, unit_price: 1500 }],
        shipments: [],
      },
      shipmentRow: {
        id: "ship-new",
        organization_id: "org-1",
        order_id: "ord-1",
        status: "DRAFT",
        weight_grams: 600,
        length_cm: 25,
        width_cm: 18,
        height_cm: 12,
        orders: { order_number: "#1001", total_amount: 1500, created_at: "2026-10-01" },
        customers: { name: "Alice", phone: "9876543210" },
        addresses: [{ city: "New Delhi", state: "Delhi", pincode: "110001" }],
        pickup_locations: [{ city: "Mumbai", name: "Hub" }],
        shipping_invoices: [],
      },
    });

    const result = await setOrderShipmentDimensions(client as never, ctx, "ord-1", {
      lengthCm: 25,
      widthCm: 18,
      heightCm: 12,
    });

    expect(client.inserts.some((ins) => ins.table === "shipments")).toBe(true);
    const shipmentInsert = client.inserts.find((ins) => ins.table === "shipments")?.values as Record<string, unknown>;
    expect(shipmentInsert.length_cm).toBe(25);
    expect(shipmentInsert.width_cm).toBe(18);
    expect(shipmentInsert.height_cm).toBe(12);
    expect(shipmentInsert.status).toBe("DRAFT");
    expect(result.lengthCm).toBe(25);
  });
});

describe("India Post booking pipeline end-to-end integration with saved dimensions", () => {
  function toDraft(overrides: {
    serviceCode: string;
    weightGrams: number;
    lengthCm?: number | null;
    widthCm?: number | null;
    heightCm?: number | null;
  }) {
    return mapShipmentToArticle({
      orderId: "ord-1",
      orderNumber: "#1001",
      shipmentId: "ship-1",
      serviceCode: overrides.serviceCode,
      customerId: "1788590988",
      contractId: "41793509",
      barcode: "ET214330016IN",
      officeId: "22660454",
      originPin: "682311",
      weightGrams: overrides.weightGrams,
      lengthCm: overrides.lengthCm,
      widthCm: overrides.widthCm,
      heightCm: overrides.heightCm,
      senderName: "Postbus Merchant",
      senderCompany: "Merchant Store",
      senderLine1: "MG Road",
      senderCity: "Ernakulam",
      senderState: "Kerala",
      senderPin: "682311",
      senderMobile: "9876543210",
      receiverName: "Priya Sharma",
      receiverLine1: "Connaught Place",
      receiverCity: "New Delhi",
      receiverState: "Delhi",
      receiverPin: "110001",
      receiverMobile: "9876543211",
      paymentMode: "PREPAID",
      strictDimensions: true,
    });
  }

  it("maps saved length_cm, width_cm, height_cm to India Post article and validates successfully", () => {
    const draft = toDraft({
      serviceCode: "SP_INLAND_PARCEL",
      weightGrams: 750,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    });

    expect(draft.lengthCm).toBe(20);
    expect(draft.widthCm).toBe(15);
    expect(draft.heightCm).toBe(10);
    expect(draft.shape).toBe("NROL");

    const issues = validateIndiaPostArticle(draft);
    expect(issues).toHaveLength(0);
  });

  it("fails India Post validation when parcel dimensions are missing (0 or null)", () => {
    const draft = toDraft({
      serviceCode: "SP_INLAND_PARCEL",
      weightGrams: 750,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    });

    expect(draft.lengthCm).toBe(0);
    expect(draft.widthCm).toBe(0);
    expect(draft.heightCm).toBe(0);

    const issues = validateIndiaPostArticle(draft);
    expect(issues.length).toBeGreaterThan(0);
    expect(
      issues.some(
        (issue) =>
          issue.field === "length" &&
          issue.error.includes("Parcel length, breadth and height are required")
      )
    ).toBe(true);
  });

  it("fails India Post validation when parcel dimensions are out of limits", () => {
    const draft = toDraft({
      serviceCode: "SP_INLAND_PARCEL",
      weightGrams: 750,
      lengthCm: 10,
      widthCm: 5,
      heightCm: 0.5,
    });

    const issues = validateIndiaPostArticle(draft);
    expect(issues.some((issue) => issue.field === "length")).toBe(true);
    expect(issues.some((issue) => issue.field === "breadth_diameter")).toBe(true);
    expect(issues.some((issue) => issue.field === "height")).toBe(true);
  });

  it("does not require parcel dimensions for Speed Post DOC", () => {
    const draft = toDraft({
      serviceCode: "SP_INLAND_DOC",
      weightGrams: 150,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    });

    expect(draft.serviceCode).toBe("SP_INLAND_DOC");

    const issues = validateIndiaPostArticle(draft);
    expect(issues.filter((i) => ["length", "breadth_diameter", "height"].includes(i.field))).toHaveLength(0);
  });
});
