import { describe, expect, it } from "vitest";
import {
  collectNewShopifyOrderAlerts,
  isShopifyOrderNotification,
  SHOPIFY_ORDER_NOTIFICATION,
} from "@/lib/notifications/new-order";

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
