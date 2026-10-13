import { describe, expect, it } from "vitest";
import {
  bookedShipmentCollectConflict,
  classifyShopifyRemotePayment,
  isShopifyCodGateway,
  isShopifyPaymentPayloadStale,
  mapShopifyCollectable,
  mapShopifyPaymentStatus,
  normalizeShopifyPaymentFields,
  shopifyHasSuccessfulPaymentTransaction,
  shopifyPaymentNeedsRefresh,
} from "@/modules/shopify/payment";

describe("shopify payment classification", () => {
  it("maps a paid checkout to PAID", () => {
    expect(mapShopifyPaymentStatus("paid", ["shopify_payments"])).toBe("PAID");
  });

  it("maps checkout COD gateways to COD", () => {
    expect(mapShopifyPaymentStatus("pending", ["cash_on_delivery"])).toBe("COD");
    expect(mapShopifyPaymentStatus("authorized", "Cash on Delivery (COD)")).toBe("COD");
  });

  it("maps a paid draft with the manual gateway to PAID", () => {
    expect(mapShopifyPaymentStatus("paid", ["manual"])).toBe("PAID");
    expect(
      classifyShopifyRemotePayment({
        financial_status: "paid",
        payment_gateway_names: ["manual"],
        source_name: "shopify_draft_order",
        total_price: "499.00",
      }).paymentStatus
    ).toBe("PAID");
  });

  it("maps a COD transaction gateway when order gateways are empty", () => {
    expect(
      classifyShopifyRemotePayment({
        financial_status: "pending",
        payment_gateway_names: [],
        total_price: "350",
        transactions: [{ kind: "authorization", status: "pending", gateway: "cash_on_delivery" }],
      }).paymentStatus
    ).toBe("COD");
  });

  it("maps pending plus a verified COD gateway to COD", () => {
    expect(
      classifyShopifyRemotePayment({
        financial_status: "pending",
        payment_gateway_names: ["Cash on Delivery (COD)"],
        source_name: "shopify_draft_order",
        total_price: "799",
      }).collect
    ).toEqual({ paymentStatus: "COD", amountPaid: 0, codAmount: 799 });
  });

  it("does not treat draft source or outstanding zero as paid or COD", () => {
    expect(
      classifyShopifyRemotePayment({
        financial_status: "pending",
        payment_gateway_names: ["manual"],
        source_name: "shopify_draft_order",
        total_outstanding: "0.00",
        total_price: "199",
      }).paymentStatus
    ).toBe("PENDING");
  });

  it("does not treat manual or empty gateways as COD", () => {
    expect(isShopifyCodGateway(["manual"])).toBe(false);
    expect(mapShopifyPaymentStatus("pending", ["manual"])).toBe("PENDING");
    expect(mapShopifyPaymentStatus("pending")).toBe("PENDING");
    expect(mapShopifyPaymentStatus("pending", [])).toBe("PENDING");
  });

  it("reads GraphQL aliases so camelCase payloads do not fall through to PENDING", () => {
    const normalized = normalizeShopifyPaymentFields({
      displayFinancialStatus: "PAID",
      paymentGatewayNames: ["manual"],
      sourceName: "shopify_draft_order",
      updatedAt: "2026-10-14T00:00:00Z",
      totalOutstandingSet: { shop_money: { amount: "0.00" } },
    });
    expect(normalized.financial_status).toBe("paid");
    expect(normalized.payment_gateway_names).toEqual(["manual"]);
    expect(mapShopifyPaymentStatus(normalized.financial_status, normalized.payment_gateway_names)).toBe("PAID");
  });

  it("treats a successful sale/capture as PAID when financial status is still pending", () => {
    expect(
      shopifyHasSuccessfulPaymentTransaction(
        [{ kind: "sale", status: "success", amount: "500.00" }],
        "500.00"
      )
    ).toBe(true);
    expect(
      mapShopifyPaymentStatus("pending", ["manual"], {
        transactions: [{ kind: "capture", status: "success", amount: "1200" }],
        totalPrice: "1200",
      })
    ).toBe("PAID");
  });

  it("preserves refunds and does not treat outstanding 0 alone as paid", () => {
    expect(mapShopifyPaymentStatus("refunded")).toBe("REFUNDED");
    expect(mapShopifyPaymentStatus("partially_refunded")).toBe("REFUNDED");
    expect(
      mapShopifyPaymentStatus("pending", ["manual"], {
        transactions: [],
        totalPrice: "100",
      })
    ).toBe("PENDING");
  });

  it("maps partial payments from outstanding balance", () => {
    expect(
      mapShopifyCollectable({ total_price: "1000.00", total_outstanding: "400.00" }, "PARTIAL")
    ).toEqual({ paymentStatus: "PARTIAL", amountPaid: 600, codAmount: 400 });
  });

  it("records merchant override as collection mode, not captured payment", () => {
    const prepaid = classifyShopifyRemotePayment(
      { financial_status: "pending", payment_gateway_names: ["manual"], total_price: "200" },
      { kind: "PREPAID", at: "2026-10-14T00:00:00Z" }
    );
    expect(prepaid.paymentStatus).toBe("PAID");
    expect(prepaid.snapshot.collectionMode).toBe("PREPAID");
    expect(prepaid.snapshot.reason).toBe("merchant_override:prepaid");
  });

  it("keeps merchant prepaid/COD overrides only while Shopify is still pending", () => {
    expect(
      classifyShopifyRemotePayment(
        { financial_status: "pending", payment_gateway_names: ["manual"], total_price: "200" },
        { kind: "COD", at: "2026-10-14T00:00:00Z" }
      ).paymentStatus
    ).toBe("COD");
    expect(
      classifyShopifyRemotePayment(
        { financial_status: "paid", payment_gateway_names: ["manual"], total_price: "200" },
        { kind: "COD", at: "2026-10-14T00:00:00Z" }
      ).paymentStatus
    ).toBe("PAID");
  });

  it("detects stale payment payloads and incomplete financial status", () => {
    expect(isShopifyPaymentPayloadStale("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")).toBe(true);
    expect(isShopifyPaymentPayloadStale("2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z")).toBe(false);
    expect(shopifyPaymentNeedsRefresh({ financial_status: "pending" })).toBe(true);
    expect(shopifyPaymentNeedsRefresh({ financial_status: "paid" })).toBe(false);
    expect(shopifyPaymentNeedsRefresh({ displayFinancialStatus: "PAID" })).toBe(false);
  });

  it("detects booked COD vs Shopify PAID collect conflicts without rewriting the AWB", () => {
    expect(bookedShipmentCollectConflict("COD", "PAID")).toBe(true);
    expect(bookedShipmentCollectConflict("PREPAID", "COD")).toBe(true);
    expect(bookedShipmentCollectConflict("PREPAID", "PAID")).toBe(false);
    expect(bookedShipmentCollectConflict("COD", "PENDING")).toBe(false);
  });
});
