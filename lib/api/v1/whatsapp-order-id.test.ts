import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { ERROR_CODES } from "@/lib/api/errors";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";

const createManualOrder = vi.hoisted(() => vi.fn());

vi.mock("@/modules/orders/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/orders/service")>();
  return { ...actual, createManualOrder };
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
};

function postOrders(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/orders WhatsApp source gate", () => {
  it("rejects authenticated dashboard creates with source WHATSAPP", async () => {
    await expect(
      handleCommerceRoutes(
        postOrders({ ...orderBody, source: "WHATSAPP" }),
        { rpc: vi.fn() } as never,
        ctx,
        "POST orders",
        "POST",
        ["orders"]
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "WhatsApp orders must be created from the storefront.",
    });
    expect(createManualOrder).not.toHaveBeenCalled();
  });

  it("still rejects WHATSAPP when a client supplies a custom order number", async () => {
    await expect(
      handleCommerceRoutes(
        postOrders({ ...orderBody, source: "WHATSAPP", orderNumber: "WA-PB-10001" }),
        { rpc: vi.fn() } as never,
        ctx,
        "POST orders",
        "POST",
        ["orders"]
      )
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });
    expect(createManualOrder).not.toHaveBeenCalled();
  });
});
