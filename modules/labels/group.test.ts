import { describe, expect, it } from "vitest";
import { filterGroupedLabels, groupLabelsByShipment, paginateGroupedLabels } from "@/modules/labels/group";
import { mapLabelRow } from "@/modules/labels/map";

function mapped(row: Record<string, unknown>) {
  return mapLabelRow(row);
}

describe("groupLabelsByShipment", () => {
  it("keeps barcode and packing slip on one row per shipment", () => {
    const grouped = groupLabelsByShipment([
      mapped({
        id: "pack-1",
        kind: "MERCHANT",
        status: "READY",
        shipment_id: "ship-1",
        created_at: "2026-09-25T12:00:00Z",
        shipments: { barcode: "CL214330016IN", orders: { order_number: "#1001" } },
      }),
      mapped({
        id: "bar-1",
        kind: "INDIA_POST",
        status: "READY",
        shipment_id: "ship-1",
        created_at: "2026-09-25T11:00:00Z",
        shipments: { barcode: "CL214330016IN", orders: { order_number: "#1001" } },
      }),
      mapped({
        id: "bar-2",
        kind: "INDIA_POST",
        status: "READY",
        shipment_id: "ship-2",
        created_at: "2026-09-25T10:00:00Z",
      }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].id).toBe("bar-1");
    expect(grouped[0].indiaPostLabelId).toBe("bar-1");
    expect(grouped[0].packingLabelId).toBe("pack-1");
    expect(grouped[0].orderNumber).toBe("#1001");
    expect(grouped[1].id).toBe("bar-2");
    expect(grouped[1].packingLabelId).toBeNull();
  });

  it("filters complete versus incomplete shipment rows", () => {
    const grouped = groupLabelsByShipment([
      mapped({ id: "bar-1", kind: "INDIA_POST", shipment_id: "ship-1", status: "READY" }),
      mapped({ id: "pack-1", kind: "MERCHANT", shipment_id: "ship-1", status: "READY" }),
      mapped({ id: "bar-2", kind: "INDIA_POST", shipment_id: "ship-2", status: "READY" }),
    ]);
    expect(filterGroupedLabels(grouped, "COMPLETE")).toHaveLength(1);
    expect(filterGroupedLabels(grouped, "INCOMPLETE")).toHaveLength(1);
    expect(filterGroupedLabels(grouped, "INDIA_POST")).toHaveLength(2);
  });

  it("paginates grouped shipment rows", () => {
    expect(paginateGroupedLabels(["a", "b", "c"], 2, 2)).toEqual({
      items: ["c"],
      page: 2,
      pageSize: 2,
      total: 3,
    });
  });
});
