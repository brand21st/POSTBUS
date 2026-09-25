import { describe, expect, it, vi } from "vitest";
import {
  insertLabelsReadyNotification,
  LABELS_READY_NOTIFICATION,
  LABELS_READY_TITLE,
  notifyLabelsReadyIfComplete,
} from "@/lib/notifications/labels-ready";

function thenable<T>(result: T) {
  const self: Record<string, unknown> = {};
  self.select = () => self;
  self.eq = () => self;
  self.limit = () => self;
  self.maybeSingle = async () => result;
  self.then = (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return self;
}

describe("labels ready notification", () => {
  it("inserts Barcode and Packing slip Ready with order and tracking", async () => {
    const inserts: unknown[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "shipments") {
          return thenable({
            data: { barcode: "AB123456789IN", tracking_number: null, order_id: "ord-1" },
            error: null,
          });
        }
        if (table === "orders") {
          return thenable({ data: { order_number: "#1042" }, error: null });
        }
        return {
          insert: async (row: unknown) => {
            inserts.push(row);
            return { error: null };
          },
        };
      }),
    };

    await insertLabelsReadyNotification(supabase as never, { organizationId: "org-1", shipmentId: "ship-1" });
    expect(inserts).toEqual([
      {
        organization_id: "org-1",
        type: LABELS_READY_NOTIFICATION,
        title: LABELS_READY_TITLE,
        body: "#1042 · AB123456789IN",
        entity_type: "shipment",
        entity_id: "ship-1",
      },
    ]);
  });

  it("notifies when an India Post barcode already exists, even if several labels are stored", async () => {
    const inserts: unknown[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "labels") {
          return thenable({ data: [{ id: "barcode-2" }, { id: "barcode-1" }], error: null });
        }
        if (table === "shipments") {
          return thenable({ data: { barcode: null, tracking_number: null, order_id: null }, error: null });
        }
        return {
          insert: async (row: unknown) => {
            inserts.push(row);
            return { error: null };
          },
        };
      }),
    };

    await expect(
      notifyLabelsReadyIfComplete(supabase as never, { organizationId: "org-1", shipmentId: "ship-1" })
    ).resolves.toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ title: LABELS_READY_TITLE, type: LABELS_READY_NOTIFICATION });
  });

  it("does not notify when the barcode label is missing", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "labels") return thenable({ data: [], error: null });
        throw new Error(`unexpected table ${table}`);
      }),
    };

    await expect(
      notifyLabelsReadyIfComplete(supabase as never, { organizationId: "org-1", shipmentId: "ship-1" })
    ).resolves.toBe(false);
  });
});
