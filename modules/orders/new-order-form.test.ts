import { describe, expect, it } from "vitest";
import { newOrderFormSchema, newOrderShipmentPayload } from "@/app/dashboard/orders/new/page";

const filledOrder = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  paymentStatus: "PAID" as const,
  amountPaid: 0,
  billingSameAsShipping: true,
  shippingAddress: {
    name: "Aswathy V V",
    phone: "8848772371",
    line1: "Chithralayam (H), Puthuperyaram P.O",
    line2: "Near Manakkad Panchayath office",
    city: "Idukki",
    state: "Kerala",
    pincode: "685608",
    country: "IN",
  },
  billingAddress: {
    name: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: "Kerala",
    pincode: "",
    country: "IN",
  },
  lineItems: [{ title: "test", sku: "", quantity: 1, unitPrice: 100, weightGrams: 20, productId: "" }],
  createShipment: true,
  shipment: {
    weightGrams: "350",
    lengthCm: "22",
    widthCm: "28",
    heightCm: "2",
    serviceCode: "BUSINESS_PARCEL",
  },
};

describe("new order form", () => {
  it("uses processing only for the Processing submit and leaves Book now unchanged", () => {
    expect(newOrderShipmentPayload(filledOrder.shipment, "processing")).toMatchObject({
      ...filledOrder.shipment,
      action: "processing",
    });
    expect(newOrderShipmentPayload(filledOrder.shipment, "book")).toEqual(filledOrder.shipment);
  });

  it("accepts a filled shipping address when billing is the same", () => {
    const parsed = newOrderFormSchema.safeParse(filledOrder);
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty extra COD charge as zero on a cash-on-delivery order", () => {
    const parsed = newOrderFormSchema.safeParse({
      ...filledOrder,
      paymentStatus: "COD",
      extraCodCharge: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a negative extra COD charge", () => {
    const parsed = newOrderFormSchema.safeParse({
      ...filledOrder,
      paymentStatus: "COD",
      extraCodCharge: -50,
    });
    expect(parsed.success).toBe(false);
  });

  it("does not reject a prepaid order because of a stale extra COD value", () => {
    const parsed = newOrderFormSchema.safeParse({
      ...filledOrder,
      paymentStatus: "PAID",
      extraCodCharge: -50,
    });
    expect(parsed.success).toBe(true);
  });

  it("still requires a billing address when it is different from shipping", () => {
    const parsed = newOrderFormSchema.safeParse({
      ...filledOrder,
      billingSameAsShipping: false,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path[0] === "billingAddress")).toBe(true);
  });
});
