import { describe, expect, it } from "vitest";
import {
  collectDashboardAlerts,
  collectNewShopifyOrderAlerts,
  isDashboardAlertNotification,
  isShopifyOrderNotification,
  SHOPIFY_ORDER_NOTIFICATION,
  LABELS_READY_NOTIFICATION,
  usesCompletionSound,
} from "@/lib/notifications/new-order";
import { orderStageNotificationType } from "@/lib/notifications/order-stage";

describe("shopify order notifications", () => {
  it("recognizes imported Shopify order alerts", () => {
    expect(isShopifyOrderNotification(SHOPIFY_ORDER_NOTIFICATION)).toBe(true);
    expect(isShopifyOrderNotification("shipment.failed")).toBe(false);
    expect(isShopifyOrderNotification(null)).toBe(false);
  });

  it("alerts only on unseen Shopify orders created after the listener started", () => {
    const startedAt = Date.parse("2026-09-20T12:00:00.000Z");
    const seen = new Set<string>(["old"]);
    const incoming = collectNewShopifyOrderAlerts(
      [
        { id: "old", type: SHOPIFY_ORDER_NOTIFICATION, createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "new", type: SHOPIFY_ORDER_NOTIFICATION, createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "other", type: "shipment.failed", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "stale", type: SHOPIFY_ORDER_NOTIFICATION, createdAt: "2026-09-20T11:00:00.000Z" },
      ],
      seen,
      startedAt
    );
    expect(incoming.map((item) => item.id)).toEqual(["new"]);
    expect(seen.has("other")).toBe(true);
  });
});

describe("order stage dashboard alerts", () => {
  it("maps each completed stage to a notification type", () => {
    expect(orderStageNotificationType("processing")).toBe("order.processing");
    expect(orderStageNotificationType("booked")).toBe("shipment.booked");
    expect(orderStageNotificationType("in_transit")).toBe("shipment.in_transit");
    expect(orderStageNotificationType("delivered")).toBe("shipment.delivered");
  });

  it("alerts on processing, fulfillment, transit, and delivered", () => {
    expect(isDashboardAlertNotification("order.processing")).toBe(true);
    expect(isDashboardAlertNotification("shipment.booked")).toBe(true);
    expect(isDashboardAlertNotification("shipment.in_transit")).toBe(true);
    expect(isDashboardAlertNotification("shipment.delivered")).toBe(true);
    expect(isDashboardAlertNotification("labels.barcode_and_packing_ready")).toBe(true);
    expect(isDashboardAlertNotification("shipment.failed")).toBe(false);
    expect(isDashboardAlertNotification("tracking.updated")).toBe(false);
  });

  it("alerts only on unseen stage completions created after the listener started", () => {
    const startedAt = Date.parse("2026-09-20T12:00:00.000Z");
    const seen = new Set<string>(["old-processing"]);
    const incoming = collectDashboardAlerts(
      [
        { id: "old-processing", type: "order.processing", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "processing", type: "order.processing", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "booked", type: "shipment.booked", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "transit", type: "shipment.in_transit", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "delivered", type: "shipment.delivered", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "labels", type: "labels.barcode_and_packing_ready", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "failed", type: "shipment.failed", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "tracking", type: "tracking.updated", createdAt: "2026-09-20T12:01:00.000Z" },
        { id: "stale", type: "shipment.delivered", createdAt: "2026-09-20T11:00:00.000Z" },
      ],
      seen,
      startedAt
    );
    expect(incoming.map((item) => item.id)).toEqual(["processing", "booked", "transit", "delivered", "labels"]);
    expect(seen.has("failed")).toBe(true);
    expect(seen.has("tracking")).toBe(true);
  });

  it("alerts on unseen labels-ready items after the listener is primed", () => {
    const seen = new Set<string>(["old"]);
    const incoming = collectDashboardAlerts(
      [
        { id: "old", type: LABELS_READY_NOTIFICATION, createdAt: "2026-09-20T11:00:00.000Z" },
        { id: "ready", type: LABELS_READY_NOTIFICATION, createdAt: "2026-09-20T11:00:00.000Z" },
      ],
      seen,
      0
    );
    expect(incoming.map((item) => item.id)).toEqual(["ready"]);
  });

  it("uses the completion chime when both barcode and packing slip are ready", () => {
    expect(usesCompletionSound([LABELS_READY_NOTIFICATION])).toBe(true);
    expect(usesCompletionSound([SHOPIFY_ORDER_NOTIFICATION, LABELS_READY_NOTIFICATION])).toBe(true);
    expect(usesCompletionSound([SHOPIFY_ORDER_NOTIFICATION])).toBe(false);
  });
});
