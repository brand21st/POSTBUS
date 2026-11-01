/**
 * The one rule that prevents double booking: when the Bulk Booking queue owns a source, that
 * source's imports never enqueue a direct booking job, and the order is offered to the queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const resolveImportBookingRoute = vi.fn();
const enrollOrderAutomatically = vi.fn();
const getAutomationSettings = vi.fn();
const createShipmentsForOrders = vi.fn();

vi.mock("@/modules/booking-queue/settings", () => ({
  resolveImportBookingRoute: (...args: unknown[]) => resolveImportBookingRoute(...args),
}));
vi.mock("@/modules/booking-queue/auto-enroll", () => ({
  enrollOrderAutomatically: (...args: unknown[]) => enrollOrderAutomatically(...args),
}));
vi.mock("@/modules/automation/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/automation/service")>()),
  getAutomationSettings: (...args: unknown[]) => getAutomationSettings(...args),
}));
vi.mock("@/modules/shipments/service", () => ({
  createShipmentsForOrders: (...args: unknown[]) => createShipmentsForOrders(...args),
}));

const { shopifyOrderAutomation } = await import("@/modules/shopify/orders");
const { maybeAutoShip } = await import("@/modules/woocommerce/orders");

function noShipment() {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "limit"]) builder[name] = () => builder;
  builder.maybeSingle = async () => ({ data: null, error: null });
  return { from: () => builder } as unknown as SupabaseClient;
}

const mapped = (paymentStatus = "PAID") =>
  ({ terminal: false, issues: [], eligible: true, payment: { paymentStatus } }) as unknown as Parameters<typeof maybeAutoShip>[2];

beforeEach(() => {
  resolveImportBookingRoute.mockReset();
  enrollOrderAutomatically.mockReset();
  createShipmentsForOrders.mockReset();
  getAutomationSettings.mockReset();
  getAutomationSettings.mockResolvedValue({
    autoShopifySync: true,
    autoShipmentCreation: true,
    autoBooking: true,
    autoShopifyProcessing: false,
  });
});

describe("Shopify imports", () => {
  it("turn off direct auto-booking when the queue owns Shopify", async () => {
    resolveImportBookingRoute.mockResolvedValue("QUEUE");
    const automation = await shopifyOrderAutomation(noShipment(), "org-1");
    expect(automation).toMatchObject({ enqueueBooking: false, enrollInQueue: true, createShipment: true });
  });

  it("keep the existing auto-booking setting otherwise", async () => {
    resolveImportBookingRoute.mockResolvedValue("LEGACY");
    expect(await shopifyOrderAutomation(noShipment(), "org-1")).toMatchObject({ enqueueBooking: true, enrollInQueue: false });
    getAutomationSettings.mockResolvedValue({ autoShopifySync: true, autoShipmentCreation: true, autoBooking: false, autoShopifyProcessing: false });
    expect(await shopifyOrderAutomation(noShipment(), "org-1")).toMatchObject({ enqueueBooking: false, enrollInQueue: false });
  });
});

describe("WooCommerce imports", () => {
  it("create the shipment without a booking job and enroll it when the queue owns WooCommerce", async () => {
    resolveImportBookingRoute.mockResolvedValue("QUEUE");
    await maybeAutoShip(noShipment(), { organizationId: "org-1", userId: "u1" }, mapped(), "order-1");
    expect(createShipmentsForOrders).toHaveBeenCalledTimes(1);
    expect(createShipmentsForOrders.mock.calls[0][3]).toEqual({ enqueueBooking: false });
    expect(enrollOrderAutomatically).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      orderId: "order-1",
      source: "WOOCOMMERCE",
      userId: "u1",
    });
  });

  it("still enroll when shipment creation is off", async () => {
    resolveImportBookingRoute.mockResolvedValue("QUEUE");
    getAutomationSettings.mockResolvedValue({ autoShipmentCreation: false, autoBooking: true });
    await maybeAutoShip(noShipment(), { organizationId: "org-1" }, mapped(), "order-1");
    expect(createShipmentsForOrders).not.toHaveBeenCalled();
    expect(enrollOrderAutomatically).toHaveBeenCalledTimes(1);
  });

  it("book directly as before when the queue does not own WooCommerce", async () => {
    resolveImportBookingRoute.mockResolvedValue("LEGACY");
    await maybeAutoShip(noShipment(), { organizationId: "org-1" }, mapped(), "order-1");
    expect(createShipmentsForOrders.mock.calls[0][3]).toEqual({ enqueueBooking: true });
    expect(enrollOrderAutomatically).not.toHaveBeenCalled();
    await maybeAutoShip(noShipment(), { organizationId: "org-1" }, mapped("PENDING"), "order-2");
    expect(createShipmentsForOrders.mock.calls[1][3]).toEqual({ enqueueBooking: false });
  });
});
