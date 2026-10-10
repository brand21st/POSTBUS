import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueWatiNotify = vi.fn();
const enqueueVachatNotify = vi.fn();
const syncShopifyOrderStage = vi.fn();
const getAutomationSettings = vi.fn(async () => ({ autoShopifyFulfillment: true }));

vi.mock("@/modules/wati/send", () => ({
  enqueueWatiNotify: (...args: unknown[]) => enqueueWatiNotify(...args),
}));
vi.mock("@/modules/vachat/send", () => ({
  enqueueVachatNotify: (...args: unknown[]) => enqueueVachatNotify(...args),
}));
vi.mock("@/modules/shopify/orders", () => ({
  syncShopifyOrderStage: (...args: unknown[]) => syncShopifyOrderStage(...args),
}));
vi.mock("@/modules/automation/service", () => ({
  getAutomationSettings: (...args: unknown[]) => getAutomationSettings(...args),
}));

import { enqueueTrackingStageSideEffects } from "@/modules/india-post/tracking-effects";

describe("tracking side effects isolation", () => {
  beforeEach(() => {
    enqueueWatiNotify.mockReset();
    enqueueVachatNotify.mockReset();
    syncShopifyOrderStage.mockReset();
  });

  it("does not create Shopify fulfillment for OFD-after-NDR in_transit WhatsApp", async () => {
    await enqueueTrackingStageSideEffects({} as never, {
      organizationId: "org-a",
      shipmentId: "ship-a",
      orderId: "order-a",
      orderStatus: null,
      events: ["in_transit"],
    });
    expect(enqueueWatiNotify).toHaveBeenCalledWith({}, "org-a", "in_transit", {
      shipmentId: "ship-a",
      orderId: "order-a",
    });
    expect(enqueueVachatNotify).toHaveBeenCalled();
    expect(syncShopifyOrderStage).not.toHaveBeenCalled();
  });

  it("still fulfills Shopify on first true in_transit order status", async () => {
    await enqueueTrackingStageSideEffects({} as never, {
      organizationId: "org-a",
      shipmentId: "ship-a",
      orderId: "order-a",
      orderStatus: "IN_TRANSIT",
      events: ["in_transit"],
    });
    expect(syncShopifyOrderStage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ stage: "in_transit", orderId: "order-a" })
    );
  });

  it("does not enqueue Shopify or invent NDR WhatsApp when no transit/delivery events exist", async () => {
    await enqueueTrackingStageSideEffects({} as never, {
      organizationId: "org-a",
      shipmentId: "ship-a",
      orderId: "order-a",
      orderStatus: null,
      events: [],
    });
    expect(enqueueWatiNotify).not.toHaveBeenCalled();
    expect(syncShopifyOrderStage).not.toHaveBeenCalled();
  });
});
