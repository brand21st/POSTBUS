import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { indiaPostBookingArticle } from "@/modules/india-post/booking-payload";
import { codAmountLines } from "@/modules/labels/custom-blocks";
import {
  addRupees,
  applyManualExtraCodCharge,
  parseExtraCodCharge,
  savedOrderCodBreakdown,
} from "@/modules/orders/extra-cod";
import { shipmentCollectFromOrder, settleOrderPayment } from "@/modules/orders/payment";
import { getOrder } from "@/modules/orders/service";
import { updateOrderAddressSchema, updateOrderWeightsSchema } from "@/modules/orders/schema";
import { settleResolvedOrderPayment } from "@/modules/products/order-lines";

const settledCod = (total: number) => settleOrderPayment({ paymentStatus: "COD", totalAmount: total });

function apply(total: number, extra: unknown) {
  return applyManualExtraCodCharge({
    requestedPaymentStatus: "COD",
    settled: settledCod(total),
    extraCodCharge: extra,
  });
}

describe("extra COD charge", () => {
  it("adds 50 to a 1000 product amount", () => {
    expect(apply(1000, 50)).toMatchObject({
      paymentStatus: "COD",
      amountPaid: 0,
      codAmount: 1050,
      extraCodCharge: 50,
    });
  });

  it("keeps the product amount when the extra charge is zero", () => {
    expect(apply(1000, 0).codAmount).toBe(1000);
    expect(apply(1000, 0).extraCodCharge).toBe(0);
  });

  it("keeps two-decimal INR amounts exact", () => {
    expect(apply(1500, "99.50")).toMatchObject({ codAmount: 1599.5, extraCodCharge: 99.5 });
    expect(addRupees(1500, 99.5)).toBe(1599.5);
  });

  it("rejects a negative extra charge", () => {
    expect(() => parseExtraCodCharge(-50)).toThrow(AppError);
    expect(() => parseExtraCodCharge("-50")).toThrow(/negative|valid/i);
  });

  it("treats an empty extra charge as zero", () => {
    expect(parseExtraCodCharge("")).toBe(0);
    expect(parseExtraCodCharge("  ")).toBe(0);
    expect(parseExtraCodCharge(null)).toBe(0);
    expect(apply(1000, "").codAmount).toBe(1000);
  });

  it("does not apply an extra charge to a prepaid order", () => {
    const prepaid = applyManualExtraCodCharge({
      requestedPaymentStatus: "PAID",
      settled: settleOrderPayment({ paymentStatus: "PAID", totalAmount: 1000 }),
      extraCodCharge: 80,
    });
    expect(prepaid).toMatchObject({ paymentStatus: "PAID", codAmount: 0, extraCodCharge: 0 });
  });

  it("drops a stale extra charge when the request is no longer COD", () => {
    const switched = applyManualExtraCodCharge({
      requestedPaymentStatus: "PAID",
      settled: settleOrderPayment({ paymentStatus: "PAID", totalAmount: 1000 }),
      extraCodCharge: 80,
    });
    expect(switched.extraCodCharge).toBe(0);
    expect(switched.codAmount).toBe(0);
  });

  it("rejects NaN, Infinity, and non-numeric text", () => {
    expect(() => parseExtraCodCharge(Number.NaN)).toThrow(AppError);
    expect(() => parseExtraCodCharge(Number.POSITIVE_INFINITY)).toThrow(AppError);
    expect(() => parseExtraCodCharge("abc")).toThrow(AppError);
    expect(() => parseExtraCodCharge("10.555")).toThrow(/decimal/i);
  });

  it("rejects a final COD amount above the India Post numeric limit", () => {
    expect(() => apply(1000, 99_999_999.99)).toThrow(/limit/i);
  });

  it("reloads the saved breakdown without adding the extra charge again", () => {
    expect(
      savedOrderCodBreakdown({
        payment_status: "COD",
        total_amount: 1000,
        extra_cod_charge: 80,
        cod_amount: 1080,
        amount_paid: 0,
      })
    ).toEqual({ baseOrderAmount: 1000, extraCodCharge: 80, finalCodAmount: 1080 });
  });

  it("leaves historical COD rows unchanged when they have no extra charge", () => {
    expect(
      savedOrderCodBreakdown({
        payment_status: "COD",
        total_amount: 499,
        cod_amount: 499,
      })
    ).toEqual({ baseOrderAmount: 499, extraCodCharge: 0, finalCodAmount: 499 });
  });

  it("preserves an existing catalog COD advance and adds the extra charge once", () => {
    const settled = settleResolvedOrderPayment({
      lines: [
        {
          productId: "prod-1",
          title: "Premium T-Shirt",
          sku: "TSHIRT-001",
          quantity: 2,
          unitPrice: 500,
          weightGrams: 250,
          prepaidEnabled: true,
          codEnabled: true,
          codAdvancePercent: 20,
          imageUrl: null,
        },
      ],
      paymentStatus: "COD",
    });
    expect(settled).toMatchObject({ paymentStatus: "PARTIAL", amountPaid: 200, codAmount: 800 });
    const withExtra = applyManualExtraCodCharge({
      requestedPaymentStatus: "COD",
      settled,
      extraCodCharge: 50,
    });
    expect(withExtra.amountPaid).toBe(200);
    expect(withExtra.codAmount).toBe(850);
    expect(withExtra.extraCodCharge).toBe(50);
  });

  it("books the final collection amount and leaves prepaid COD fields empty", () => {
    const cod = indiaPostBookingArticle({
      customerId: "1000000001",
      contractId: "40000001",
      barcode: "EK123456789IN",
      officeId: "560001",
      originPin: "560001",
      serviceCode: "SP_INLAND_PARCEL",
      weightGrams: 350,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 5,
      senderName: "PostBus",
      senderLine1: "12 Market Road",
      senderCity: "Bengaluru",
      senderState: "Karnataka",
      senderMobile: "9876543210",
      receiverName: "Priya",
      receiverLine1: "14 Lake View",
      receiverCity: "Kochi",
      receiverState: "Kerala",
      receiverPin: "682016",
      receiverMobile: "9876501234",
      paymentMode: "COD",
      codAmount: apply(1000, 80).codAmount,
    });
    expect(cod.codr_cod).toBe("COD");
    expect(cod.value_for_codr_cod).toBe(1080);

    const prepaid = indiaPostBookingArticle({
      customerId: "1000000001",
      contractId: "40000001",
      barcode: "EK123456789IN",
      officeId: "560001",
      originPin: "560001",
      serviceCode: "SP_INLAND_PARCEL",
      weightGrams: 350,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 5,
      senderName: "PostBus",
      senderLine1: "12 Market Road",
      senderCity: "Bengaluru",
      senderState: "Karnataka",
      senderMobile: "9876543210",
      receiverName: "Priya",
      receiverLine1: "14 Lake View",
      receiverCity: "Kochi",
      receiverState: "Kerala",
      receiverPin: "682016",
      receiverMobile: "9876501234",
      paymentMode: "PREPAID",
      codAmount: 1080,
    });
    expect(prepaid.codr_cod).toBe("");
    expect(prepaid.value_for_codr_cod).toBe("");
  });

  it("prints the final collection amount on the COD label block", () => {
    const collect = shipmentCollectFromOrder({
      payment_status: "COD",
      total_amount: 1000,
      cod_amount: 1080,
      amount_paid: 0,
    });
    expect(collect).toEqual({ payment_mode: "COD", cod_amount: 1080 });
    expect(codAmountLines(collect.cod_amount).join("\n")).toContain("1,080.00");
    expect(codAmountLines(collect.cod_amount).join("\n")).not.toContain("1,000.00");
  });

  it("does not add the extra charge a second time when a shipment is created from the order", () => {
    const order = apply(1000, 80);
    expect(
      shipmentCollectFromOrder({
        payment_status: order.paymentStatus,
        total_amount: 1000,
        cod_amount: order.codAmount,
        amount_paid: order.amountPaid,
      }).cod_amount
    ).toBe(1080);
  });

  it("refuses another organization from reading the saved COD breakdown", async () => {
    let organizationId = "";
    const client = {
      from: () => {
        const query: Record<string, unknown> = {};
        const self = () => query;
        query.select = self;
        query.eq = (column: string, value: string) => {
          if (column === "organization_id") organizationId = value;
          return query;
        };
        query.maybeSingle = () =>
          Promise.resolve({
            data:
              organizationId === "org-1"
                ? {
                    id: "order-1",
                    source: "MANUAL",
                    organization_id: "org-1",
                    payment_status: "COD",
                    total_amount: 1000,
                    amount_paid: 0,
                    cod_amount: 1080,
                    extra_cod_charge: 80,
                    order_line_items: [],
                    shipments: [],
                    customers: null,
                  }
                : null,
            error: null,
          });
        return query;
      },
    };
    const otherOrg = {
      userId: "user-2",
      email: "other@example.com",
      fullName: "Other",
      organizationId: "org-2",
      organizationName: "Other Org",
      role: "OPERATOR",
      permissions: ["orders.read"],
    } satisfies TenantContext;
    await expect(getOrder(client as never, otherOrg, "order-1")).rejects.toThrow(/not found/i);
  });

  it("does not accept an extra COD change on booked-order updates", () => {
    const weights = updateOrderWeightsSchema.parse({
      parcelWeightMode: "auto",
      lineItems: [{ id: "11111111-1111-4111-8111-111111111111", weightGrams: 250 }],
      extraCodCharge: 500,
    });
    expect(weights).not.toHaveProperty("extraCodCharge");

    const address = updateOrderAddressSchema.parse({
      line1: "12 MG Road",
      city: "Kochi",
      state: "Kerala",
      pincode: "682311",
      extraCodCharge: 500,
    });
    expect(address).not.toHaveProperty("extraCodCharge");
  });
});
