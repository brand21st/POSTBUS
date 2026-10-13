import { describe, expect, it } from "vitest";
import {
  categorizePendingShopifyOrder,
  categorizePrepaidShipmentRisk,
  tally,
} from "@/modules/shopify/reconcile";

describe("shopify payment dry-run reconcile", () => {
  it("buckets pending PostBus rows against Shopify evidence without writing", () => {
    expect(
      categorizePendingShopifyOrder({
        id: "a",
        payment_status: "PENDING",
        source_order_id: "1",
        shopify: { financial_status: "paid", payment_gateway_names: ["manual"] },
      })
    ).toBe("CONFIRMED_PAID_MISMATCH");
    expect(
      categorizePendingShopifyOrder({
        id: "b",
        payment_status: "PENDING",
        source_order_id: "2",
        shopify: { financial_status: "pending", payment_gateway_names: ["cash_on_delivery"] },
      })
    ).toBe("CONFIRMED_COD_MISMATCH");
    expect(
      categorizePendingShopifyOrder({
        id: "c",
        payment_status: "PENDING",
        source_order_id: "3",
        shopify: { financial_status: "pending", payment_gateway_names: ["manual"] },
      })
    ).toBe("GENUINE_PENDING");
    expect(
      categorizePendingShopifyOrder({
        id: "d",
        payment_status: "PENDING",
        source_order_id: "4",
        shopify: null,
      })
    ).toBe("INSUFFICIENT_EVIDENCE");
    expect(
      tally([
        categorizePendingShopifyOrder({
          id: "a",
          payment_status: "PENDING",
          source_order_id: "1",
          shopify: { financial_status: "paid" },
        }),
      ]).CONFIRMED_PAID_MISMATCH
    ).toBe(1);
  });

  it("does not treat booked prepaid PENDING as confirmed prepaid without paid evidence", () => {
    expect(
      categorizePrepaidShipmentRisk({
        shipmentId: "s1",
        shipmentStatus: "BOOKED",
        paymentMode: "PREPAID",
        bookedAt: "2026-10-01T00:00:00Z",
        hasAwb: true,
        orderPaymentStatus: "PENDING",
      })
    ).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("requires unbooked prepaid shipments to be reviewed", () => {
    expect(
      categorizePrepaidShipmentRisk({
        shipmentId: "s2",
        shipmentStatus: "DRAFT",
        paymentMode: "PREPAID",
        bookedAt: null,
        hasAwb: false,
        orderPaymentStatus: "PENDING",
      })
    ).toBe("UNBOOKED_REQUIRES_REVIEW");
  });

  it("confirms prepaid only with authoritative paid or capture evidence", () => {
    expect(
      categorizePrepaidShipmentRisk({
        shipmentId: "s3",
        shipmentStatus: "BOOKED",
        paymentMode: "PREPAID",
        bookedAt: "2026-10-01T00:00:00Z",
        hasAwb: true,
        orderPaymentStatus: "PENDING",
        shopify: { financial_status: "paid", payment_gateway_names: ["manual"] },
      })
    ).toBe("CONFIRMED_VALID_PREPAID");
    expect(
      categorizePrepaidShipmentRisk({
        shipmentId: "s4",
        shipmentStatus: "BOOKED",
        paymentMode: "PREPAID",
        bookedAt: "2026-10-01T00:00:00Z",
        hasAwb: true,
        orderPaymentStatus: "PENDING",
        shopify: {
          financial_status: "pending",
          payment_gateway_names: ["manual"],
          total_price: "100",
          transactions: [{ kind: "sale", status: "success", amount: "100" }],
        },
      })
    ).toBe("CONFIRMED_VALID_PREPAID");
  });

  it("flags verified COD booked as prepaid", () => {
    expect(
      categorizePrepaidShipmentRisk({
        shipmentId: "s5",
        shipmentStatus: "BOOKED",
        paymentMode: "PREPAID",
        bookedAt: "2026-10-01T00:00:00Z",
        hasAwb: true,
        orderPaymentStatus: "PENDING",
        shopify: { financial_status: "pending", payment_gateway_names: ["cash_on_delivery"] },
      })
    ).toBe("CONFIRMED_COD_BOOKED_PREPAID");
  });

  it("does not treat merchant prepaid override as captured-payment proof", () => {
    expect(
      categorizePrepaidShipmentRisk({
        shipmentId: "s6",
        shipmentStatus: "BOOKED",
        paymentMode: "PREPAID",
        bookedAt: "2026-10-01T00:00:00Z",
        hasAwb: true,
        orderPaymentStatus: "PAID",
        merchantOverride: { kind: "PREPAID", at: "2026-10-14T00:00:00Z" },
        shopify: { financial_status: "pending", payment_gateway_names: ["manual"] },
      })
    ).toBe("INSUFFICIENT_EVIDENCE");
  });
});
