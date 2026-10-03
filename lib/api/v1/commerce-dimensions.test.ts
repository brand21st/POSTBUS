import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";

const ctx: TenantContext = {
  userId: "user-1",
  email: "merchant@example.com",
  fullName: "Merchant Admin",
  organizationId: "org-1",
  organizationName: "PostBus Merchant Store",
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
    id: "ship-101",
    organization_id: "org-1",
    order_id: "ord-202",
    status: "DRAFT",
    weight_grams: 650,
    length_cm: null,
    width_cm: null,
    height_cm: null,
    service_code: "SP_INLAND_PARCEL",
    orders: { order_number: "#10025", total_amount: 2499, created_at: "2026-10-02" },
    customers: { name: "Rajesh Kumar", phone: "9876543210" },
    addresses: [{ city: "Jaipur", state: "Rajasthan", pincode: "302001" }],
    pickup_locations: [{ city: "Delhi", name: "Central Hub" }],
    shipping_invoices: [],
  };

  const defaultOrder = {
    id: "ord-202",
    organization_id: "org-1",
    order_number: "#10025",
    customer_id: "cust-1",
    shipping_address_id: "addr-1",
    india_post_service: "SP_INLAND_PARCEL",
    parcel_weight_mode: "auto",
    parcel_weight_grams: null,
    order_line_items: [{ quantity: 1, weight_grams: 650, unit_price: 2499 }],
    shipments: [{ id: "ship-101", status: "DRAFT", created_at: "2026-10-02" }],
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
          const merged = {
            ...shipmentData,
            ...(updates[updates.length - 1]?.values as Record<string, unknown> ?? {}),
          };
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

describe("API & DB Integration: Order-Level Parcel Dimensions Management", () => {
  it("PATCH /api/v1/shipments/:id persists dimensions in DB and returns updated shipment", async () => {
    const supabase = createMockSupabase();
    const req = new NextRequest("http://localhost:3000/api/v1/shipments/ship-101", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lengthCm: 22,
        widthCm: 16,
        heightCm: 11,
      }),
    });

    const result = (await handleCommerceRoutes(
      req,
      supabase as never,
      ctx,
      "PATCH shipments/ship-101",
      "PATCH",
      ["shipments", "ship-101"]
    )) as Record<string, unknown>;

    // 1. Verify DB Update
    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]).toEqual({
      table: "shipments",
      values: {
        length_cm: 22,
        width_cm: 16,
        height_cm: 11,
      },
    });

    // 2. Verify Audit Log
    expect(supabase.inserts.some((ins) => ins.table === "audit_logs")).toBe(true);

    // 3. Verify API Response
    expect(result.id).toBe("ship-101");
    expect(result.lengthCm).toBe(22);
    expect(result.widthCm).toBe(16);
    expect(result.heightCm).toBe(11);
  });

  it("PATCH /api/v1/shipments/:id rejects invalid dimensions (Length < 14 cm)", async () => {
    const supabase = createMockSupabase();
    const req = new NextRequest("http://localhost:3000/api/v1/shipments/ship-101", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lengthCm: 10,
        widthCm: 16,
        heightCm: 11,
      }),
    });

    await expect(
      handleCommerceRoutes(
        req,
        supabase as never,
        ctx,
        "PATCH shipments/ship-101",
        "PATCH",
        ["shipments", "ship-101"]
      )
    ).rejects.toThrow();

    // Verify DB was NOT updated
    expect(supabase.updates).toHaveLength(0);
  });

  it("PATCH /api/v1/shipments/:id rejects unauthorized organization access", async () => {
    const supabase = createMockSupabase({ shipmentRow: null });
    const req = new NextRequest("http://localhost:3000/api/v1/shipments/ship-other", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      }),
    });

    await expect(
      handleCommerceRoutes(
        req,
        supabase as never,
        ctx,
        "PATCH shipments/ship-other",
        "PATCH",
        ["shipments", "ship-other"]
      )
    ).rejects.toThrow(AppError);

    expect(supabase.updates).toHaveLength(0);
  });

  it("PATCH /api/v1/shipments/:id rejects update when shipment is already booked", async () => {
    const supabase = createMockSupabase({
      shipmentRow: {
        id: "ship-101",
        organization_id: "org-1",
        status: "BOOKED",
      },
    });
    const req = new NextRequest("http://localhost:3000/api/v1/shipments/ship-101", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      }),
    });

    await expect(
      handleCommerceRoutes(
        req,
        supabase as never,
        ctx,
        "PATCH shipments/ship-101",
        "PATCH",
        ["shipments", "ship-101"]
      )
    ).rejects.toThrow(AppError);

    expect(supabase.updates).toHaveLength(0);
  });

  it("PATCH /api/v1/orders/:id/dimensions updates existing open shipment in DB", async () => {
    const supabase = createMockSupabase();
    const req = new NextRequest("http://localhost:3000/api/v1/orders/ord-202/dimensions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lengthCm: 25,
        widthCm: 18,
        heightCm: 12,
      }),
    });

    const result = (await handleCommerceRoutes(
      req,
      supabase as never,
      ctx,
      "PATCH orders/ord-202/dimensions",
      "PATCH",
      ["orders", "ord-202", "dimensions"]
    )) as Record<string, unknown>;

    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0].values).toEqual({
      length_cm: 25,
      width_cm: 18,
      height_cm: 12,
    });
    expect(result.lengthCm).toBe(25);
  });

  it("PATCH /api/v1/orders/:id/dimensions creates a new draft shipment in DB when none exists yet", async () => {
    const supabase = createMockSupabase({
      orderRow: {
        id: "ord-shopify-1",
        organization_id: "org-1",
        order_number: "#SHOP-100",
        customer_id: "cust-1",
        shipping_address_id: "addr-1",
        india_post_service: "SP_INLAND_PARCEL",
        parcel_weight_mode: "auto",
        parcel_weight_grams: null,
        order_line_items: [{ quantity: 1, weight_grams: 800, unit_price: 1999 }],
        shipments: [],
      },
      shipmentRow: {
        id: "ship-created-1",
        organization_id: "org-1",
        order_id: "ord-shopify-1",
        status: "DRAFT",
        weight_grams: 800,
        length_cm: 30,
        width_cm: 20,
        height_cm: 15,
        orders: { order_number: "#SHOP-100", total_amount: 1999, created_at: "2026-10-02" },
        customers: { name: "Sunil Verma", phone: "9876543212" },
        addresses: [{ city: "Bangalore", state: "Karnataka", pincode: "560001" }],
        pickup_locations: [{ city: "Delhi", name: "Hub" }],
        shipping_invoices: [],
      },
    });

    const req = new NextRequest("http://localhost:3000/api/v1/orders/ord-shopify-1/dimensions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lengthCm: 30,
        widthCm: 20,
        heightCm: 15,
      }),
    });

    const result = (await handleCommerceRoutes(
      req,
      supabase as never,
      ctx,
      "PATCH orders/ord-shopify-1/dimensions",
      "PATCH",
      ["orders", "ord-shopify-1", "dimensions"]
    )) as Record<string, unknown>;

    // Verify DB Insert
    expect(supabase.inserts.some((ins) => ins.table === "shipments")).toBe(true);
    const shipmentInsert = supabase.inserts.find((ins) => ins.table === "shipments")?.values as Record<string, unknown>;
    expect(shipmentInsert.length_cm).toBe(30);
    expect(shipmentInsert.width_cm).toBe(20);
    expect(shipmentInsert.height_cm).toBe(15);
    expect(shipmentInsert.status).toBe("DRAFT");
    expect(result.lengthCm).toBe(30);
  });
});
