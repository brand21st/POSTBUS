import { describe, expect, it } from "vitest";
import {
  aggregateAnalytics,
  asAmount,
  isActiveOrder,
  isCodOrder,
  istParts,
  startOfIstYearIso,
  type AnalyticsOrderRow,
  type AnalyticsShipmentRow,
} from "@/modules/dashboard/analytics";

const NOW = new Date("2026-09-20T12:00:00+05:30");

function order(
  createdAt: string,
  overrides: Partial<AnalyticsOrderRow> = {}
): AnalyticsOrderRow {
  return {
    created_at: createdAt,
    total_amount: 1000,
    source: "SHOPIFY",
    payment_status: "PAID",
    status: "READY",
    ...overrides,
  };
}

function shipment(
  createdAt: string,
  overrides: Partial<AnalyticsShipmentRow> = {}
): AnalyticsShipmentRow {
  return {
    created_at: createdAt,
    payment_mode: "PREPAID",
    cod_amount: 0,
    status: "BOOKED",
    ...overrides,
  };
}

describe("analytics helpers", () => {
  it("parses numeric amounts and skips cancelled or non-COD rows", () => {
    expect(asAmount("1499.50")).toBe(1499.5);
    expect(asAmount(null)).toBe(0);
    expect(isActiveOrder({ status: "CANCELLED" })).toBe(false);
    expect(isActiveOrder({ status: "READY" })).toBe(true);
    expect(isCodOrder({ payment_status: "COD" })).toBe(true);
    expect(isCodOrder({ payment_status: "PAID" })).toBe(false);
  });

  it("reads calendar parts in Asia/Kolkata", () => {
    const lateUtc = istParts("2026-09-19T19:30:00.000Z");
    expect(lateUtc.dateKey).toBe("2026-09-20");
    expect(lateUtc.hour).toBe(1);
    expect(startOfIstYearIso(NOW)).toBe("2025-12-31T18:30:00.000Z");
  });
});

describe("aggregateAnalytics", () => {
  it("returns zeroed buckets when there is no activity", () => {
    const result = aggregateAnalytics([], [], NOW);
    expect(result.today).toEqual({
      shipments: 0,
      revenue: 0,
      orders: 0,
      codOrders: 0,
      codAmount: 0,
    });
    expect(result.series.today).toHaveLength(24);
    expect(result.series.month).toHaveLength(20);
    expect(result.series.year).toHaveLength(9);
    expect(result.topSource).toBeNull();
  });

  it("rolls orders and shipments into today, month, and year", () => {
    const result = aggregateAnalytics(
      [
        order("2026-09-20T01:15:00+05:30", { total_amount: 500, source: "SHOPIFY" }),
        order("2026-09-05T10:00:00+05:30", { total_amount: 200, source: "MANUAL" }),
        order("2026-01-02T09:00:00+05:30", { total_amount: 100, source: "API" }),
        order("2025-12-31T23:00:00+05:30", { total_amount: 999, source: "SHOPIFY" }),
        order("2026-09-20T08:00:00+05:30", { status: "CANCELLED", total_amount: 50 }),
      ],
      [
        shipment("2026-09-20T02:00:00+05:30"),
        shipment("2026-09-08T11:00:00+05:30"),
        shipment("2026-09-20T03:00:00+05:30", { status: "CANCELLED" }),
      ],
      NOW
    );

    expect(result.today.orders).toBe(1);
    expect(result.today.revenue).toBe(500);
    expect(result.today.shipments).toBe(1);
    expect(result.month.orders).toBe(2);
    expect(result.month.revenue).toBe(700);
    expect(result.month.shipments).toBe(2);
    expect(result.year.orders).toBe(3);
    expect(result.year.revenue).toBe(800);
    expect(result.year.shipments).toBe(2);
    expect(result.series.today[1]?.orders).toBe(1);
    expect(result.series.today[1]?.revenue).toBe(500);
    expect(result.topSource?.source).toBe("SHOPIFY");
    expect(result.topSource?.orders).toBe(1);
  });

  it("counts COD orders and source mix for the selected windows", () => {
    const result = aggregateAnalytics(
      [
        order("2026-09-20T11:00:00+05:30", {
          source: "SHOPIFY",
          payment_status: "COD",
          total_amount: 800,
        }),
        order("2026-09-20T11:30:00+05:30", {
          source: "SHOPIFY",
          payment_status: "PAID",
          total_amount: 200,
        }),
        order("2026-09-20T12:00:00+05:30", {
          source: "MANUAL",
          payment_status: "COD",
          total_amount: 100,
        }),
      ],
      [shipment("2026-09-20T11:05:00+05:30", { payment_mode: "COD", cod_amount: 800 })],
      NOW
    );

    expect(result.today.codOrders).toBe(2);
    expect(result.today.codAmount).toBe(900);
    expect(result.series.today[11]?.cod).toBe(1);
    expect(result.series.today[11]?.prepaid).toBe(1);
    expect(result.sources.today[0]?.source).toBe("SHOPIFY");
    expect(result.sources.today[0]?.share).toBeCloseTo(66.666, 2);
    expect(result.sources.today[1]?.source).toBe("MANUAL");
  });
});
