import { describe, expect, it, vi } from "vitest";
import { insertOrderStageNotification, orderStageNotificationType } from "@/lib/notifications/order-stage";

function supabaseMock(orderNumber?: string | null) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: orderNumber ? { order_number: orderNumber } : null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table === "orders") return { select };
    if (table === "notifications") return { insert };
    throw new Error(table);
  });
  return { client: { from }, insert, maybeSingle };
}

describe("insertOrderStageNotification", () => {
  it("writes the stage type, title, and order entity", async () => {
    const { client, insert, maybeSingle } = supabaseMock();
    await insertOrderStageNotification(client as never, {
      organizationId: "org-1",
      orderId: "order-1",
      event: "in_transit",
      body: "AW123IN",
    });

    expect(maybeSingle).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      type: "shipment.in_transit",
      title: "Order in transit",
      body: "AW123IN",
      entity_type: "order",
      entity_id: "order-1",
    });
  });

  it("loads the order number when no body is given", async () => {
    const { client, insert } = supabaseMock("1001");
    await insertOrderStageNotification(client as never, {
      organizationId: "org-1",
      orderId: "order-1",
      event: "processing",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order.processing",
        title: "Order processing",
        body: "1001",
      })
    );
  });

  it("formats fulfillment as order number plus booked", async () => {
    const { client, insert } = supabaseMock("1001");
    await insertOrderStageNotification(client as never, {
      organizationId: "org-1",
      orderId: "order-1",
      event: "booked",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "shipment.booked",
        title: "Order fulfilled",
        body: "1001 · booked",
      })
    );
  });

  it("falls back to a short order id when the number is missing", async () => {
    const { client, insert } = supabaseMock(null);
    await insertOrderStageNotification(client as never, {
      organizationId: "org-1",
      orderId: "abcdef12-3456-7890-abcd-ef1234567890",
      event: "delivered",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: orderStageNotificationType("delivered"),
        title: "Order delivered",
        body: "abcdef12",
      })
    );
  });
});
