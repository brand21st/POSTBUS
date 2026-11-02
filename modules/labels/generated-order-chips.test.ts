import { describe, expect, it } from "vitest";
import type { LabelRecord } from "@/types/api";
import { generatedOrderChipGroups, generatedOrderChips } from "@/modules/labels/generated-order-chips";

function label(partial: Partial<LabelRecord>): LabelRecord {
  return {
    id: partial.id ?? "label",
    status: partial.status ?? "READY",
    orderNumber: partial.orderNumber,
    order_number: partial.order_number,
    printStatus: partial.printStatus,
    print_status: partial.print_status,
    barcodeStatus: partial.barcodeStatus,
    packingStatus: partial.packingStatus,
    createdAt: partial.createdAt,
    created_at: partial.created_at,
  };
}

const now = new Date("2026-10-15T10:00:00+05:30");

describe("generatedOrderChips", () => {
  it("sorts today unprinted, then earlier unprinted, then printed", () => {
    const chips = generatedOrderChips(
      [
        label({ id: "1", orderNumber: "PB-10130", printStatus: "PRINTED", createdAt: "2026-10-15T04:00:00.000Z" }),
        label({ id: "2", orderNumber: "PB-10129", printStatus: "WAITING", createdAt: "2026-10-14T10:00:00.000Z" }),
        label({ id: "3", orderNumber: "PB-10128", createdAt: "2026-10-15T08:00:00.000Z" }),
        label({ id: "4", orderNumber: "PB-10127", printStatus: "PRINTED", createdAt: "2026-10-14T10:00:00.000Z" }),
      ],
      now
    );
    expect(chips.map((chip) => chip.orderNumber)).toEqual(["PB-10128", "PB-10129", "PB-10130", "PB-10127"]);
    expect(chips.map((chip) => [chip.today, chip.printed])).toEqual([
      [true, false],
      [false, false],
      [true, true],
      [false, true],
    ]);
  });

  it("keeps an order in Today when any generated label was created today", () => {
    const chips = generatedOrderChips(
      [
        label({ id: "1", orderNumber: "PB-10130", printStatus: "WAITING", createdAt: "2026-10-14T10:00:00.000Z" }),
        label({ id: "2", orderNumber: "PB-10130", printStatus: "WAITING", createdAt: "2026-10-15T08:00:00.000Z" }),
        label({ id: "3", orderNumber: "PB-10129", printStatus: "WAITING", createdAt: "2026-10-14T11:00:00.000Z" }),
      ],
      now
    );
    expect(chips.map((chip) => chip.orderNumber)).toEqual(["PB-10130", "PB-10129"]);
    expect(chips[0]).toMatchObject({ printed: false, today: true });
  });

  it("treats an order as unprinted when any generated label is not printed", () => {
    const chips = generatedOrderChips(
      [
        label({ id: "1", orderNumber: "PB-10130", printStatus: "PRINTED", createdAt: "2026-10-15T08:00:00.000Z" }),
        label({ id: "2", orderNumber: "PB-10130", printStatus: "WAITING", createdAt: "2026-10-15T09:00:00.000Z" }),
        label({ id: "3", orderNumber: "PB-10129", printStatus: "PRINTED", createdAt: "2026-10-15T08:00:00.000Z" }),
      ],
      now
    );
    expect(chips).toEqual([
      { orderNumber: "PB-10130", printed: false, today: true },
      { orderNumber: "PB-10129", printed: true, today: true },
    ]);
  });

  it("uses the Asia/Kolkata calendar day for created_at", () => {
    const chips = generatedOrderChips(
      [
        label({ id: "1", orderNumber: "PB-LATE", createdAt: "2026-10-14T18:40:00.000Z" }),
        label({ id: "2", orderNumber: "PB-EARLY", createdAt: "2026-10-14T18:20:00.000Z" }),
      ],
      now
    );
    expect(chips.find((chip) => chip.orderNumber === "PB-LATE")?.today).toBe(true);
    expect(chips.find((chip) => chip.orderNumber === "PB-EARLY")?.today).toBe(false);
  });

  it("groups chips for the picker headers", () => {
    const groups = generatedOrderChipGroups(
      generatedOrderChips(
        [
          label({ id: "1", orderNumber: "PB-TODAY", createdAt: "2026-10-15T08:00:00.000Z" }),
          label({ id: "2", orderNumber: "PB-OLD", createdAt: "2026-10-14T08:00:00.000Z" }),
          label({ id: "3", orderNumber: "PB-DONE", printStatus: "PRINTED", createdAt: "2026-10-15T08:00:00.000Z" }),
        ],
        now
      )
    );
    expect(groups.today.map((chip) => chip.orderNumber)).toEqual(["PB-TODAY"]);
    expect(groups.earlier.map((chip) => chip.orderNumber)).toEqual(["PB-OLD"]);
    expect(groups.printed.map((chip) => chip.orderNumber)).toEqual(["PB-DONE"]);
  });

  it("skips labels that are not generated", () => {
    const chips = generatedOrderChips(
      [
        label({ id: "1", status: "PENDING", orderNumber: "PB-SKIP", createdAt: "2026-10-15T08:00:00.000Z" }),
        label({ id: "2", orderNumber: "PB-READY", printStatus: "PRINTED", createdAt: "2026-10-15T08:00:00.000Z" }),
      ],
      now
    );
    expect(chips).toEqual([{ orderNumber: "PB-READY", printed: true, today: true }]);
  });
});
