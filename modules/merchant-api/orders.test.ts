import { describe, expect, it } from "vitest";
import { MerchantApiError } from "@/modules/merchant-api/errors";
import { publicOrderDto } from "@/modules/merchant-api/dto";
import { merchantCreateOrderSchema } from "@/modules/merchant-api/schema";

describe("merchant order contract", () => {
  it("does not accept createShipment on the public schema", () => {
    const parsed = merchantCreateOrderSchema.parse({
      customer: { name: "Ravi Kumar", phone: "9876543210" },
      shipping_address: {
        line1: "12 MG Road",
        city: "Bengaluru",
        state: "KA",
        pincode: "560001",
      },
      line_items: [{ title: "Shirt", quantity: 1, unit_price: 499 }],
      createShipment: true,
    });
    expect(parsed).not.toHaveProperty("createShipment");
  });

  it("maps orders without leaking other-org fields from the DTO", () => {
    const dto = publicOrderDto({
      id: "ord-1",
      organization_id: "org-a",
      order_number: "PB-1",
      source: "API",
      status: "READY",
      customers: { name: "A", phone: "9876543210" },
      shipping_address: { line1: "x", city: "y", state: "KA", pincode: "560001" },
      order_line_items: [{ id: "li-1", title: "Item", quantity: 1 }],
      shipments: [],
    });
    expect(dto).not.toHaveProperty("organization_id");
    expect(dto.status).toBe("READY");
  });

  it("uses MerchantApiError codes for tenant misses", () => {
    const error = new MerchantApiError("RESOURCE_NOT_FOUND", "Order not found.");
    expect(error.status).toBe(404);
  });
});
