import { describe, expect, it } from "vitest";
import { bookingBoxWeightGrams } from "@/modules/orders/weight";

describe("bookingBoxWeightGrams", () => {
  it("uses the manual box weight for India Post", () => {
    expect(
      bookingBoxWeightGrams({
        parcelWeightMode: "manual",
        parcelWeightGrams: 750,
        lineItems: [{ quantity: 2, weight_grams: 200 }],
      })
    ).toBe(750);
  });

  it("sums saved product weights in auto mode", () => {
    expect(
      bookingBoxWeightGrams({
        parcelWeightMode: "auto",
        lineItems: [
          { quantity: 2, weight_grams: 200 },
          { quantity: 1, weight_grams: 100 },
        ],
      })
    ).toBe(500);
  });

  it("falls back to 100 g when nothing was entered", () => {
    expect(bookingBoxWeightGrams({ parcelWeightMode: "auto", lineItems: [{ quantity: 1, weight_grams: null }] })).toBe(
      100
    );
  });
});
