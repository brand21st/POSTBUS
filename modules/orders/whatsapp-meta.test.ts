import { describe, expect, it } from "vitest";
import { whatsappPaymentRequirement } from "@/modules/orders/whatsapp-meta";

describe("whatsappPaymentRequirement", () => {
  it("treats COD with a stored ₹0 advance as not requiring payment", () => {
    expect(
      whatsappPaymentRequirement({
        storefront: { paymentPreference: "COD", expectedAdvance: 0, amountOnDelivery: 699, total: 699 },
      })
    ).toEqual({ required: false, preference: "COD", amount: 0, amountOnDelivery: 699 });
  });

  it("uses the stored rupee advance, not a percentage", () => {
    expect(
      whatsappPaymentRequirement({
        storefront: { paymentPreference: "COD", expectedAdvance: 500, amountOnDelivery: 1500, total: 2000 },
      })
    ).toEqual({ required: true, preference: "COD", amount: 500, amountOnDelivery: 1500 });
  });

  it("requires the full stored total for prepaid", () => {
    expect(
      whatsappPaymentRequirement({
        storefront: { paymentPreference: "PREPAID", expectedAdvance: 0, amountOnDelivery: 0, total: 2000 },
      })
    ).toEqual({ required: true, preference: "PREPAID", amount: 2000, amountOnDelivery: 0 });
  });
});
