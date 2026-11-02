import { describe, expect, it } from "vitest";
import {
  getOrderPaymentDefault,
  saveOrderPaymentDefault,
  saveOrderPaymentDefaultSchema,
} from "@/modules/orders/payment-default";

function client(
  row: { payment_status?: string | null; extra_cod_charge?: number | string | null } | null,
  writeError: { message: string } | null = null
) {
  let stored = row;
  return {
    from(table: string) {
      if (table !== "user_order_defaults") throw new Error(table);
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle() {
                      return Promise.resolve({ data: stored, error: null });
                    },
                  };
                },
              };
            },
          };
        },
        upsert(payload: {
          payment_status?: string;
          extra_cod_charge?: number;
        }) {
          return {
            select() {
              return {
                single() {
                  if (writeError) return Promise.resolve({ data: null, error: writeError });
                  stored = {
                    payment_status:
                      payload.payment_status !== undefined
                        ? payload.payment_status
                        : stored?.payment_status ?? null,
                    extra_cod_charge:
                      payload.extra_cod_charge !== undefined
                        ? payload.extra_cod_charge
                        : stored?.extra_cod_charge ?? null,
                  };
                  return Promise.resolve({ data: stored, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("order payment default", () => {
  it("accepts the payment choices shown on Add order", () => {
    expect(saveOrderPaymentDefaultSchema.parse({ paymentStatus: "COD" }).paymentStatus).toBe("COD");
    expect(saveOrderPaymentDefaultSchema.safeParse({ paymentStatus: "PENDING" }).success).toBe(false);
    expect(saveOrderPaymentDefaultSchema.safeParse({ paymentStatus: "FAILED" }).success).toBe(false);
    expect(saveOrderPaymentDefaultSchema.safeParse({}).success).toBe(false);
  });

  it("returns null when the member has not saved a default", async () => {
    await expect(getOrderPaymentDefault(client(null) as never, "user", "org")).resolves.toEqual({
      paymentStatus: null,
      extraCodCharge: null,
    });
  });

  it("returns the saved payment status", async () => {
    await expect(
      getOrderPaymentDefault(client({ payment_status: "PARTIAL" }) as never, "user", "org")
    ).resolves.toEqual({ paymentStatus: "PARTIAL", extraCodCharge: null });
  });

  it("saves the selected payment status without clearing a saved extra charge", async () => {
    await expect(
      saveOrderPaymentDefault(client({ extra_cod_charge: 40 }) as never, "user", "org", {
        paymentStatus: "COD",
      })
    ).resolves.toEqual({ paymentStatus: "COD", extraCodCharge: 40 });
  });

  it("saves an extra COD amount without inventing a payment default", async () => {
    await expect(
      saveOrderPaymentDefault(client(null) as never, "user", "org", { extraCodCharge: "40.50" })
    ).resolves.toEqual({ paymentStatus: null, extraCodCharge: 40.5 });
  });

  it("rejects a negative extra COD default", async () => {
    await expect(
      saveOrderPaymentDefault(client(null) as never, "user", "org", { extraCodCharge: -10 })
    ).rejects.toThrow(/cannot be negative/i);
  });
});
