import { describe, expect, it, vi } from "vitest";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { bulkUpdateOrderStatus } from "@/modules/orders/bulk-status";

const createShipmentsForOrders = vi.hoisted(() => vi.fn());

vi.mock("@/modules/shipments/service", () => ({
  createShipmentsForOrders,
}));

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OPERATOR",
  permissions: ["shipments.write", "orders.write"],
};

function ordersClient(rows: Array<{ id: string; order_number: string; status: string }>) {
  return {
    from: vi.fn((table: string) => {
      if (table !== "orders") throw new Error(table);
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.in = () => query;
      query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return query;
    }),
  };
}

describe("bulkUpdateOrderStatus", () => {
  it("updates eligible orders and reports skips and missing ids in one fulfill call", async () => {
    createShipmentsForOrders.mockResolvedValueOnce({
      queued: 2,
      skipped: [],
      shipments: [{ id: "s1" }, { id: "s2" }],
    });

    const result = await bulkUpdateOrderStatus(
      ordersClient([
        { id: "ready-1", order_number: "1001", status: "PROCESSING" },
        { id: "ready-2", order_number: "1002", status: "READY" },
        { id: "done-1", order_number: "1024", status: "DELIVERED" },
      ]) as never,
      ctx,
      { orderIds: ["ready-1", "ready-2", "done-1", "missing-1"], action: "fulfill" }
    );

    expect(createShipmentsForOrders).toHaveBeenCalledTimes(1);
    expect(createShipmentsForOrders).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      ["ready-1", "ready-2"],
      { action: "fulfill" }
    );
    expect(result.selected).toBe(4);
    expect(result.updated).toEqual([
      { id: "ready-1", orderNumber: "1001" },
      { id: "ready-2", orderNumber: "1002" },
    ]);
    expect(result.skipped).toEqual([
      {
        id: "done-1",
        orderNumber: "1024",
        reason: "Order #1024 cannot be marked Booked / packed because it is already Delivered.",
      },
    ]);
    expect(result.failed).toEqual([
      { id: "missing-1", reason: "Order was not found in this workspace." },
    ]);
  });

  it("does not call fulfill when every selected order is ineligible", async () => {
    createShipmentsForOrders.mockClear();
    const result = await bulkUpdateOrderStatus(
      ordersClient([{ id: "done-1", order_number: "1024", status: "DELIVERED" }]) as never,
      ctx,
      { orderIds: ["done-1"], action: "fulfill" }
    );
    expect(createShipmentsForOrders).not.toHaveBeenCalled();
    expect(result.updated).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it("maps a shipment conflict into skipped results instead of throwing", async () => {
    createShipmentsForOrders.mockRejectedValueOnce(
      new AppError(ERROR_CODES.CONFLICT, "Every selected order already has a shipment.")
    );
    const result = await bulkUpdateOrderStatus(
      ordersClient([{ id: "ready-1", order_number: "1001", status: "PROCESSING" }]) as never,
      ctx,
      { orderIds: ["ready-1"], action: "fulfill" }
    );
    expect(result.updated).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("already has an active shipment");
  });
});
