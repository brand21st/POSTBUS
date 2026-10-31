import { describe, expect, it } from "vitest";
import {
  getOrderPaymentDefault,
  saveOrderPaymentDefault,
  saveOrderPaymentDefaultSchema,
} from "@/modules/orders/payment-default";

function client(row: { payment_status: string } | null, writeError: { message: string } | null = null) {
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
                      return Promise.resolve({ data: row, error: null });
                    },
                  };
                },
              };
            },
          };
        },
        upsert(payload: { payment_status: string }) {
          return {
            select() {
              return {
                single() {
                  if (writeError) return Promise.resolve({ data: null, error: writeError });
                  return Promise.resolve({ data: { payment_status: payload.payment_status }, error: null });
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
  });

  it("returns null when the member has not saved a default", async () => {
    await expect(getOrderPaymentDefault(client(null) as never, "user", "org")).resolves.toEqual({
      paymentStatus: null,
    });
  });

  it("returns the saved payment status", async () => {
    await expect(
      getOrderPaymentDefault(client({ payment_status: "PARTIAL" }) as never, "user", "org")
    ).resolves.toEqual({ paymentStatus: "PARTIAL" });
  });

  it("saves the selected payment status", async () => {
    await expect(
      saveOrderPaymentDefault(client(null) as never, "user", "org", { paymentStatus: "COD" })
    ).resolves.toEqual({ paymentStatus: "COD" });
  });
});
