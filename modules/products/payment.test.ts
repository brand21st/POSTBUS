import { describe, expect, it } from "vitest";
import { catalogCodAdvancePaid, catalogLineAdvance } from "@/modules/products/payment";
import { settleResolvedOrderPayment } from "@/modules/products/order-lines";
import { settleOrderPayment } from "@/modules/orders/payment";

const tshirt = {
  productId: "prod-1",
  title: "Premium T-Shirt",
  sku: "TSHIRT-001",
  quantity: 1,
  unitPrice: 999,
  weightGrams: 250,
  prepaidEnabled: true,
  codEnabled: true,
  codAdvancePercent: 30,
  imageUrl: null,
};

describe("catalog COD advance", () => {
  it("rounds 30% of ₹999 to ₹299.70", () => {
    expect(catalogLineAdvance(999, 1, 30)).toBe(299.7);
    expect(catalogCodAdvancePaid([{ unitPrice: 999, quantity: 1, product: tshirt }])).toBe(299.7);
  });

  it("uses existing settlement for prepaid", () => {
    expect(settleResolvedOrderPayment({ lines: [tshirt], paymentStatus: "PAID" })).toEqual(
      settleOrderPayment({ paymentStatus: "PAID", totalAmount: 999 })
    );
  });

  it("uses 0% COD as full collect", () => {
    expect(
      settleResolvedOrderPayment({
        lines: [{ ...tshirt, codAdvancePercent: 0 }],
        paymentStatus: "COD",
      })
    ).toEqual({ paymentStatus: "COD", amountPaid: 0, codAmount: 999 });
  });

  it("keeps storefront catalog submits pending with nothing received", () => {
    expect(settleResolvedOrderPayment({ lines: [tshirt], paymentStatus: "PENDING" })).toEqual({
      paymentStatus: "PENDING",
      amountPaid: 0,
      codAmount: 0,
    });
  });

  it("uses mixed line percents as a combined advance", () => {
    expect(
      settleResolvedOrderPayment({
        lines: [
          tshirt,
          { ...tshirt, productId: "prod-2", title: "Bag", sku: "BAG-1", unitPrice: 500, codAdvancePercent: 20 },
        ],
        paymentStatus: "COD",
      })
    ).toEqual({
      paymentStatus: "PARTIAL",
      amountPaid: 399.7,
      codAmount: 1099.3,
    });
  });

  it("uses 30% COD as a partial collect", () => {
    expect(settleResolvedOrderPayment({ lines: [tshirt], paymentStatus: "COD" })).toEqual({
      paymentStatus: "PARTIAL",
      amountPaid: 299.7,
      codAmount: 699.3,
    });
  });

  it("uses 100% COD advance as prepaid", () => {
    expect(
      settleResolvedOrderPayment({
        lines: [{ ...tshirt, codAdvancePercent: 100 }],
        paymentStatus: "COD",
      })
    ).toEqual({ paymentStatus: "PAID", amountPaid: 999, codAmount: 0 });
  });

  it("rejects prepaid when the product disallows it", () => {
    expect(() =>
      settleResolvedOrderPayment({
        lines: [{ ...tshirt, prepaidEnabled: false }],
        paymentStatus: "PAID",
      })
    ).toThrow(/prepaid/i);
  });

  it("rejects COD when the product disallows it", () => {
    expect(() =>
      settleResolvedOrderPayment({
        lines: [{ ...tshirt, codEnabled: false }],
        paymentStatus: "COD",
      })
    ).toThrow(/COD/i);
  });
});
