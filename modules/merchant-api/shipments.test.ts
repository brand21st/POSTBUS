import { describe, expect, it, vi } from "vitest";

const createShipmentsForOrders = vi.fn();

vi.mock("@/modules/shipments/service", () => ({
  createShipmentsForOrders: (...args: unknown[]) => createShipmentsForOrders(...args),
  getShipment: vi.fn(),
  listShipments: vi.fn(),
}));

vi.mock("@/modules/india-post/tracking-sync", () => ({
  enqueueOrgTrackingSyncIfIdle: vi.fn(),
}));

vi.mock("@/modules/labels/load", () => ({
  loadLabelPdfBytes: vi.fn(),
}));

import { bookMerchantOrder } from "@/modules/merchant-api/shipments";

describe("bookMerchantOrder", () => {
  it("enqueues booking and does not run India Post on the request", async () => {
    createShipmentsForOrders.mockResolvedValue({
      queued: 1,
      skipped: [],
      shipments: [{ id: "ship-1", status: "QUEUED", order_id: "ord-1" }],
    });
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: { id: "ord-1" } }),
        };
      },
    };
    const result = await bookMerchantOrder(
      supabase as never,
      { organizationId: "org-a", createdBy: "user-a", organizationName: "A" } as never,
      "ord-1",
      {}
    );
    expect(result.state).toBe("queued");
    expect(result.shipments[0].status).toBe("QUEUED");
    expect(createShipmentsForOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ["ord-1"],
      expect.objectContaining({ enqueueBooking: true, runBookingNow: false })
    );
  });
});
