import { describe, expect, it } from "vitest";
import { MAX_LABELS } from "@/modules/labels/multi-up/request";
import {
  labelCopyCount,
  mergeSelectedItems,
  MULTI_PRINT_PAGE_SIZE,
  multiPrintLabelsPath,
  uniqueOrderIds,
} from "@/modules/labels/multi-up/selection";

describe("multi-print selection", () => {
  it("loads the first page at the bounded page size", () => {
    expect(MULTI_PRINT_PAGE_SIZE).toBe(50);
    expect(multiPrintLabelsPath(1)).toBe("/api/v1/labels?page=1&pageSize=50");
    expect(multiPrintLabelsPath(2, 50, "2460")).toBe("/api/v1/labels?page=2&pageSize=50&q=2460");
  });

  it("keeps unique selected order IDs across later pages", () => {
    const page1 = mergeSelectedItems([], [{ orderId: "A" }, { orderId: "B" }]);
    const page2 = mergeSelectedItems(page1, [{ orderId: "B" }, { orderId: "C" }]);
    expect(uniqueOrderIds(page2)).toEqual(["A", "B", "C"]);
    expect(labelCopyCount(page2)).toBe(3);
  });

  it("stops at 100 labels and does not duplicate IDs", () => {
    const full = mergeSelectedItems(
      Array.from({ length: MAX_LABELS }, (_, index) => ({ orderId: `o${index}`, copies: 1 })),
      [{ orderId: "extra" }]
    );
    expect(full).toHaveLength(MAX_LABELS);
    expect(uniqueOrderIds(full)).toHaveLength(MAX_LABELS);
  });
});
