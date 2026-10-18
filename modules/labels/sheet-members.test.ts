import { describe, expect, it } from "vitest";
import { insertLabelSheetMembers } from "@/modules/labels/sheet-members";

function client(inserted: unknown[]) {
  return {
    from(table: string) {
      return {
        async insert(rows: unknown[]) {
          if (table !== "label_sheet_members") return { error: { message: `unexpected ${table}` } };
          inserted.push(...rows);
          return { error: null };
        },
      };
    },
  };
}

describe("label sheet members", () => {
  it("records every shipment on a two-order sheet", async () => {
    const inserted: unknown[] = [];
    await insertLabelSheetMembers(client(inserted) as never, {
      organizationId: "org-a",
      labelId: "label-1",
      members: [
        { orderId: "A", shipmentId: "ship-a", orderUuid: "ord-a" },
        { orderId: "B", shipmentId: "ship-b", orderUuid: "ord-b" },
      ],
    });
    expect(inserted).toEqual([
      expect.objectContaining({ shipment_id: "ship-a", order_id: "ord-a", position: 0, organization_id: "org-a" }),
      expect.objectContaining({ shipment_id: "ship-b", order_id: "ord-b", position: 1 }),
    ]);
  });

  it("does not attach a four-shipment sheet to only the first shipment", async () => {
    const inserted: Array<{ shipment_id: string }> = [];
    await insertLabelSheetMembers(client(inserted) as never, {
      organizationId: "org-a",
      labelId: "label-1",
      members: [
        { orderId: "A", shipmentId: "s1", orderUuid: "o1" },
        { orderId: "B", shipmentId: "s2", orderUuid: "o2" },
        { orderId: "C", shipmentId: "s3", orderUuid: "o3" },
        { orderId: "D", shipmentId: "s4", orderUuid: "o4" },
      ],
    });
    expect(inserted.map((row) => row.shipment_id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("rejects empty membership so a sheet cannot skip associations", async () => {
    await expect(
      insertLabelSheetMembers(client([]) as never, { organizationId: "org-a", labelId: "label-1", members: [] })
    ).rejects.toThrow(/no shipments/);
  });
});
