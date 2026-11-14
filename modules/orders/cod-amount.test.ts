import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import { paymentStatusFromManualCod, restoreAutoOrderPayment } from "@/modules/orders/cod-amount";
import { isManualCodAmount } from "@/modules/orders/payment";
import { updateOrderCodAmount } from "@/modules/orders/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OPERATOR",
  permissions: ["orders.write"],
};

function codClient(options: {
  shipmentStatus: string;
  source?: string;
  paymentStatus?: string;
  totalAmount?: number;
  amountPaid?: number;
  codAmount?: number;
  metadata?: unknown;
}) {
  const updates: Array<{ table: string; values: unknown }> = [];
  const orderRow = {
    id: "ord-1",
    order_number: "#1",
    source: options.source ?? "SHOPIFY",
    payment_status: options.paymentStatus ?? "COD",
    total_amount: options.totalAmount ?? 499,
    amount_paid: options.amountPaid ?? 0,
    cod_amount: options.codAmount ?? 499,
    extra_cod_charge: 0,
    metadata: options.metadata ?? {},
    customers: null,
    shipping_invoices: [],
    order_line_items: [],
    shipments: [{ id: "ship-1", status: options.shipmentStatus }],
  };
  return {
    updates,
    from(table: string) {
      let data: unknown = {};
      if (table === "orders") data = orderRow;
      if (table === "shipments") data = [{ id: "ship-1", status: options.shipmentStatus, booked_at: null }];
      const payload = { data, error: null };
      const self: Record<string, unknown> = {};
      self.select = () => self;
      self.eq = () => self;
      self.in = () => self;
      self.is = () => self;
      self.update = (values: unknown) => {
        updates.push({ table, values });
        Object.assign(orderRow, values as Record<string, unknown>);
        return self;
      };
      self.maybeSingle = async () => payload;
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(payload).then(resolve, reject);
      return self;
    },
  };
}

describe("manual remaining COD", () => {
  it("maps collect amount onto payment status without changing amount received", () => {
    expect(paymentStatusFromManualCod(0, 309)).toBe("COD");
    expect(paymentStatusFromManualCod(190, 309)).toBe("PARTIAL");
    expect(paymentStatusFromManualCod(499, 0)).toBe("PAID");
    expect(isManualCodAmount("manual")).toBe(true);
    expect(isManualCodAmount("auto")).toBe(false);
  });

  it("restores Shopify outstanding when switching back to auto", () => {
    expect(
      restoreAutoOrderPayment({
        source: "SHOPIFY",
        total_amount: 1000,
        amount_paid: 0,
        payment_status: "COD",
        metadata: {
          shopifyPayment: {
            financialStatus: "partially_paid",
            gateways: ["razorpay"],
            sourceName: "web",
            outstanding: 400,
            originalTotal: 1000,
            currentTotal: 1000,
            updatedAt: "2026-11-01T00:00:00Z",
            reason: "financial_status:partially_paid",
          },
        },
      })
    ).toEqual({ paymentStatus: "PARTIAL", amountPaid: 600, codAmount: 400 });
  });

  it("restores WooCommerce COD from the stored payment method", () => {
    expect(
      restoreAutoOrderPayment({
        source: "WOOCOMMERCE",
        total_amount: 590,
        amount_paid: 190,
        payment_status: "PARTIAL",
        metadata: { woocommerce: { paymentMethod: "cod", status: "processing" } },
      })
    ).toEqual({ paymentStatus: "COD", amountPaid: 0, codAmount: 590 });
  });

  it("saves a typed remaining amount onto the order and open shipment", async () => {
    const client = codClient({ shipmentStatus: "DRAFT" });
    await updateOrderCodAmount(client as never, ctx, "ord-1", { mode: "manual", codAmount: 309 });
    expect(client.updates).toEqual(
      expect.arrayContaining([
        {
          table: "orders",
          values: {
            cod_amount_mode: "manual",
            payment_status: "COD",
            amount_paid: 0,
            cod_amount: 309,
          },
        },
        { table: "shipments", values: { payment_mode: "COD", cod_amount: 309 } },
      ])
    );
  });

  it("marks a zero remaining amount as paid prepaid collect", async () => {
    const client = codClient({ shipmentStatus: "QUEUED", amountPaid: 190, paymentStatus: "PARTIAL" });
    await updateOrderCodAmount(client as never, ctx, "ord-1", { mode: "manual", codAmount: 0 });
    expect(client.updates).toEqual(
      expect.arrayContaining([
        {
          table: "orders",
          values: {
            cod_amount_mode: "manual",
            payment_status: "PAID",
            amount_paid: 190,
            cod_amount: 0,
          },
        },
        { table: "shipments", values: { payment_mode: "PREPAID", cod_amount: 0 } },
      ])
    );
  });

  it("rejects the save after India Post booking", async () => {
    const client = codClient({ shipmentStatus: "BOOKED" });
    await expect(
      updateOrderCodAmount(client as never, ctx, "ord-1", { mode: "manual", codAmount: 309 })
    ).rejects.toBeInstanceOf(AppError);
    expect(client.updates).toEqual([]);
  });

  it("restores auto remaining from the Shopify snapshot", async () => {
    const client = codClient({
      shipmentStatus: "FAILED",
      paymentStatus: "COD",
      totalAmount: 1000,
      amountPaid: 0,
      codAmount: 309,
      metadata: {
        shopifyPayment: {
          financialStatus: "partially_paid",
          gateways: ["razorpay"],
          sourceName: "web",
          outstanding: 400,
          originalTotal: 1000,
          currentTotal: 1000,
          updatedAt: "2026-11-01T00:00:00Z",
          reason: "financial_status:partially_paid",
        },
      },
    });
    await updateOrderCodAmount(client as never, ctx, "ord-1", { mode: "auto" });
    expect(client.updates).toEqual(
      expect.arrayContaining([
        {
          table: "orders",
          values: {
            cod_amount_mode: "auto",
            payment_status: "PARTIAL",
            amount_paid: 600,
            cod_amount: 400,
          },
        },
        { table: "shipments", values: { payment_mode: "COD", cod_amount: 400 } },
      ])
    );
  });
});
