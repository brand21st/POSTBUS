import { describe, expect, it } from "vitest";
import {
  subscriptionMatches,
  trackingStageEvents,
  shouldEmitOrderUpdated,
  shouldEmitBookingRequested,
} from "@/modules/webhooks/catalog";

describe("webhook event mapping", () => {
  it("emits delivered only for forward DELIVERED, not RTO_DELIVERED", () => {
    const delivered = trackingStageEvents({
      inserted: true,
      previousStatus: "OUT_FOR_DELIVERY",
      nextStatus: "DELIVERED",
      previousOperational: "OUT_FOR_DELIVERY",
      nextOperational: "DELIVERED",
    });
    expect(delivered.map((row) => row.type)).toEqual(["tracking.updated", "shipment.delivered"]);

    const rto = trackingStageEvents({
      inserted: true,
      previousStatus: "RTO",
      nextStatus: "RTO",
      previousOperational: "RTO_IN_TRANSIT",
      nextOperational: "RTO_DELIVERED",
    });
    expect(rto.map((row) => row.type)).toEqual(["tracking.updated"]);
  });

  it("emits booking_requested only when entering QUEUED", () => {
    expect(shouldEmitBookingRequested("DRAFT")).toBe(true);
    expect(shouldEmitBookingRequested("QUEUED")).toBe(false);
  });

  it("does not emit order.updated when Shopify rewrites the same status", () => {
    expect(shouldEmitOrderUpdated("READY", "READY")).toBe(false);
    expect(shouldEmitOrderUpdated("READY", "PROCESSING")).toBe(true);
  });

  it("matches aliases for existing subscriptions", () => {
    expect(subscriptionMatches(["shipment.failed"], "shipment.booking_failed")).toBe(true);
    expect(subscriptionMatches(["shipment.created"], "shipment.booking_requested")).toBe(true);
    expect(subscriptionMatches(["order.created"], "shipment.booked")).toBe(false);
  });
});
