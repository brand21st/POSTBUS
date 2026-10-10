import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";

const createManualOrder = vi.hoisted(() => vi.fn());
const createShipmentsForOrders = vi.hoisted(() => vi.fn());

vi.mock("@/modules/orders/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/orders/service")>();
  return { ...actual, createManualOrder };
});

vi.mock("@/modules/shipments/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/shipments/service")>();
  return { ...actual, createShipmentsForOrders };
});

const ctx: TenantContext = {
  userId: "user-1",
  email: "merchant@example.com",
  fullName: "Merchant",
  organizationId: "org-1",
  organizationName: "Shop",
  role: "OWNER",
  permissions: ["orders.write"],
};

const orderBody = {
  customer: { name: "Rahul Kumar", phone: "9876543210" },
  shippingAddress: {
    name: "Rahul Kumar",
    phone: "9876543210",
    line1: "12 MG Road",
    city: "Kochi",
    state: "Kerala",
    pincode: "682311",
    country: "IN",
  },
  billingSameAsShipping: true,
  paymentStatus: "PENDING" as const,
  lineItems: [{ title: "Premium T-Shirt", quantity: 1, unitPrice: 999 }],
  createShipment: true,
};

function postOrders(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function shipmentClient(row: Record<string, unknown> | null) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.not = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = async () => ({ data: row, error: null });
  return { from: () => chain };
}

describe("POST /api/v1/orders Book now shipment status", () => {
  it("returns the reloaded shipment after India Post booking", async () => {
    createManualOrder.mockResolvedValueOnce({ id: "ord-1", order_number: "1001" });
    createShipmentsForOrders.mockResolvedValueOnce({ queued: 1, skipped: [], shipments: [] });
    const shipment = {
      id: "ship-1",
      order_id: "ord-1",
      status: "BOOKED",
      barcode: "AW123IN",
      booked_at: "2026-10-10T06:00:00.000Z",
      last_error: null,
    };

    const result = await handleCommerceRoutes(
      postOrders(orderBody),
      shipmentClient(shipment) as never,
      ctx,
      "POST orders",
      "POST",
      ["orders"]
    );

    expect(createShipmentsForOrders).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      ["ord-1"],
      undefined
    );
    expect(result).toMatchObject({
      id: "ord-1",
      order_number: "1001",
      shipment,
    });
  });

  it("still returns the order with a null shipment when booking did not create one", async () => {
    createManualOrder.mockResolvedValueOnce({ id: "ord-2", order_number: "1002" });
    createShipmentsForOrders.mockRejectedValueOnce(new Error("queue down"));

    const result = await handleCommerceRoutes(
      postOrders(orderBody),
      shipmentClient(null) as never,
      ctx,
      "POST orders",
      "POST",
      ["orders"]
    );

    expect(result).toMatchObject({ id: "ord-2", shipment: null });
  });
});
