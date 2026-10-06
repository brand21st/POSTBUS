import { describe, expect, it } from "vitest";
import { catalogCodAdvancePaid } from "@/modules/products/payment";
import { quoteCatalogPayment } from "@/modules/storefront/quote";

describe("store payment quote", () => {
  it("sums mixed COD advance percentages into rupees", () => {
    const quote = quoteCatalogPayment({
      preference: "COD",
      lines: [
        {
          unitPrice: 1000,
          quantity: 1,
          prepaidEnabled: true,
          codEnabled: true,
          codAdvancePercent: 30,
        },
        {
          unitPrice: 500,
          quantity: 1,
          prepaidEnabled: true,
          codEnabled: true,
          codAdvancePercent: 20,
        },
      ],
    });
    expect(catalogCodAdvancePaid([
      { unitPrice: 1000, quantity: 1, product: { prepaidEnabled: true, codEnabled: true, codAdvancePercent: 30 } },
      { unitPrice: 500, quantity: 1, product: { prepaidEnabled: true, codEnabled: true, codAdvancePercent: 20 } },
    ])).toBe(400);
    expect(quote).toEqual({
      preference: "COD",
      total: 1500,
      amountDueNow: 400,
      amountOnDelivery: 1100,
      expectedAdvance: 400,
    });
  });

  it("quotes prepaid as the full total with no COD remainder", () => {
    expect(
      quoteCatalogPayment({
        preference: "PREPAID",
        lines: [
          {
            unitPrice: 699,
            quantity: 2,
            prepaidEnabled: true,
            codEnabled: true,
            codAdvancePercent: 30,
          },
        ],
      })
    ).toEqual({
      preference: "PREPAID",
      total: 1398,
      amountDueNow: 1398,
      amountOnDelivery: 0,
      expectedAdvance: 0,
    });
  });
});
