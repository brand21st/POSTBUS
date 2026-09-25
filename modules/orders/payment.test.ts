import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { settleOrderPayment, shipmentCollectFromOrder } from "@/modules/orders/payment";

describe("settleOrderPayment", () => {
  it("treats full COD as collect the order total", () => {
    expect(settleOrderPayment({ paymentStatus: "COD", totalAmount: 499 })).toEqual({
      paymentStatus: "COD",
      amountPaid: 0,
      codAmount: 499,
    });
  });

  it("splits a partial advance from remaining COD", () => {
    expect(
      settleOrderPayment({ paymentStatus: "PARTIAL", totalAmount: 1000, amountPaid: 250 })
    ).toEqual({
      paymentStatus: "PARTIAL",
      amountPaid: 250,
      codAmount: 750,
    });
  });

  it("turns a COD order with an advance into partial collect", () => {
    expect(
      settleOrderPayment({ paymentStatus: "COD", totalAmount: 1000, amountPaid: 200 })
    ).toEqual({
      paymentStatus: "PARTIAL",
      amountPaid: 200,
      codAmount: 800,
    });
  });

  it("requires an advance for strict partial payment", () => {
    expect(() => settleOrderPayment({ paymentStatus: "PARTIAL", totalAmount: 500 })).toThrow(AppError);
  });

  it("marks fully prepaid orders as paid with nothing to collect", () => {
    expect(settleOrderPayment({ paymentStatus: "PAID", totalAmount: 320 })).toEqual({
      paymentStatus: "PAID",
      amountPaid: 320,
      codAmount: 0,
    });
  });
});

describe("shipmentCollectFromOrder", () => {
  it("books full COD against the remaining collect amount", () => {
    expect(
      shipmentCollectFromOrder({
        payment_status: "COD",
        total_amount: 499,
        amount_paid: 0,
        cod_amount: 499,
      })
    ).toEqual({ payment_mode: "COD", cod_amount: 499 });
  });

  it("books partial payment as COD for the unpaid remainder", () => {
    expect(
      shipmentCollectFromOrder({
        payment_status: "PARTIAL",
        total_amount: 1000,
        amount_paid: 400,
        cod_amount: 600,
      })
    ).toEqual({ payment_mode: "COD", cod_amount: 600 });
  });

  it("falls back to order total for legacy COD rows with no stored collect amount", () => {
    expect(
      shipmentCollectFromOrder({
        payment_status: "COD",
        total_amount: "799.00",
        amount_paid: 0,
        cod_amount: 0,
      })
    ).toEqual({ payment_mode: "COD", cod_amount: 799 });
  });

  it("keeps paid orders prepaid", () => {
    expect(
      shipmentCollectFromOrder({
        payment_status: "PAID",
        total_amount: 499,
        amount_paid: 499,
        cod_amount: 0,
      })
    ).toEqual({ payment_mode: "PREPAID", cod_amount: 0 });
  });
});
