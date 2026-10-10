import { describe, expect, it } from "vitest";
import {
  applyHeaderSelectionChange,
  applyVisibleSelection,
  bulkActionOrderIds,
  toggleRowSelection,
  visibleHeaderState,
} from "@/lib/dashboard/row-selection";

describe("toggleRowSelection", () => {
  it("selects orders on the first page without duplicates", () => {
    let selected: string[] = [];
    selected = toggleRowSelection(selected, "A", true);
    selected = toggleRowSelection(selected, "B", true);
    selected = toggleRowSelection(selected, "C", true);
    selected = toggleRowSelection(selected, "A", true);
    expect(selected).toEqual(["A", "B", "C"]);
  });

  it("deselects only the intended order", () => {
    expect(toggleRowSelection(["A", "B", "C", "D"], "B", false)).toEqual(["A", "C", "D"]);
  });
});

describe("applyVisibleSelection", () => {
  it("selects all visible rows and keeps other pages", () => {
    expect(applyVisibleSelection(["A", "B", "C"], ["D", "E", "F"], true)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
    ]);
  });

  it("does not create duplicates when select-all is repeated", () => {
    const first = applyVisibleSelection(["A", "B", "C", "D"], ["D", "E", "F"], true);
    const second = applyVisibleSelection(first, ["D", "E", "F"], true);
    expect(second).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("deselects only visible rows", () => {
    expect(applyVisibleSelection(["A", "B", "C", "D", "E", "F"], ["D", "E", "F"], false)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("leaves unrelated selection unchanged on an empty visible page", () => {
    expect(applyVisibleSelection(["A", "B"], [], true)).toEqual(["A", "B"]);
    expect(applyVisibleSelection(["A", "B"], [], false)).toEqual(["A", "B"]);
  });

  it("does not mutate input arrays", () => {
    const selected = ["A", "B"];
    const visible = ["B", "C"];
    applyVisibleSelection(selected, visible, true);
    toggleRowSelection(selected, "D", true);
    expect(selected).toEqual(["A", "B"]);
    expect(visible).toEqual(["B", "C"]);
  });

  it("deduplicates repeated visible ids", () => {
    expect(applyVisibleSelection(["A"], ["B", "B", "C"], true)).toEqual(["A", "B", "C"]);
  });
});

describe("applyHeaderSelectionChange", () => {
  it("keeps other pages when deselect uses the live visible rows", () => {
    expect(applyHeaderSelectionChange(["A", "B", "C", "D"], ["C", "D"], false)).toEqual(["A", "B"]);
  });

  it("ignores header deselect while the list is fetching or showing placeholder rows", () => {
    expect(applyHeaderSelectionChange(["A", "B", "C"], ["A", "B", "C"], false, true)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("still unions the live page when select-all runs during a refetch", () => {
    expect(applyHeaderSelectionChange(["A"], ["D", "E"], true, true)).toEqual(["A", "D", "E"]);
  });

  it("does not wipe a previous page if a stale header deselect sees the new page ids", () => {
    expect(applyHeaderSelectionChange(["A", "B", "C"], ["D", "E", "F"], false, false)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});

describe("visibleHeaderState", () => {
  it("is unchecked when no visible rows are selected", () => {
    expect(visibleHeaderState(["A", "B"], ["D", "E"])).toBe(false);
  });

  it("is unchecked when the visible page is empty", () => {
    expect(visibleHeaderState(["A", "B"], [])).toBe(false);
  });

  it("is indeterminate when some visible rows are selected", () => {
    expect(visibleHeaderState(["A", "D"], ["D", "E", "F"])).toBe("indeterminate");
  });

  it("is checked only when every visible row is selected", () => {
    expect(visibleHeaderState(["A", "D", "E", "F"], ["D", "E", "F"])).toBe(true);
  });

  it("stays associated with stable ids after a visible reorder", () => {
    const selected = ["A", "B"];
    expect(visibleHeaderState(selected, ["B", "A"])).toBe(true);
    expect(toggleRowSelection(selected, "A", true)).toEqual(["A", "B"]);
  });
});

describe("bulkActionOrderIds", () => {
  it("sends the full selected set rather than only visible rows", () => {
    expect(bulkActionOrderIds(["A", "B", "C"])).toEqual(["A", "B", "C"]);
  });
});
