import { describe, expect, it } from "vitest";
import {
  labelsApiSearchParams,
  parseLabelsListSearchParams,
  selectedLabelsCaption,
  serializeLabelsListSearchParams,
} from "@/lib/dashboard/labels-list-query";
import { selectionAfterFilterChange, selectionAfterPageChange } from "@/lib/dashboard/orders-list-query";

describe("labels list query", () => {
  it("round-trips date, kind, search, and page", () => {
    const state = parseLabelsListSearchParams("date=today&kind=COMPLETE&q=PB-1&page=3");
    expect(state).toMatchObject({ date: "today", kind: "COMPLETE", q: "PB-1", page: 3 });
    expect(serializeLabelsListSearchParams(state)).toBe("kind=COMPLETE&q=PB-1&date=today&page=3");
  });

  it("drops incomplete custom and range filters", () => {
    expect(parseLabelsListSearchParams("date=custom").date).toBe("all");
    expect(parseLabelsListSearchParams("date=range&from=2026-10-27").date).toBe("all");
  });

  it("orders a reversed range", () => {
    const state = parseLabelsListSearchParams("date=range&from=2026-10-28&to=2026-10-27");
    expect(state.from).toBe("2026-10-27");
    expect(state.to).toBe("2026-10-28");
  });

  it("builds API params without date bounds for All Labels", () => {
    const params = labelsApiSearchParams({
      page: 1,
      kind: "ALL",
      q: "",
      date: "all",
      on: null,
      from: null,
      to: null,
    });
    expect(params.get("date")).toBeNull();
    expect(params.get("from")).toBeNull();
  });

  it("writes order-number sort on the labels URL and API query", () => {
    const state = parseLabelsListSearchParams("sort=-order_number");
    expect(state.sort).toBe("-order_number");
    expect(serializeLabelsListSearchParams({ ...state, page: 1 })).toBe("sort=-order_number");
    expect(
      labelsApiSearchParams({
        page: 1,
        kind: "ALL",
        q: "",
        date: "all",
        on: null,
        from: null,
        to: null,
        sort: "-order_number",
      }).get("sort")
    ).toBe("-order_number");
  });

  it("formats the selection caption", () => {
    expect(selectedLabelsCaption(1)).toBe("1 Label Selected");
    expect(selectedLabelsCaption(20)).toBe("20 Labels Selected");
  });

  it("clears selection on filter change and keeps it across pages", () => {
    expect(selectionAfterFilterChange()).toEqual([]);
    expect(selectionAfterPageChange(["a", "b"])).toEqual(["a", "b"]);
  });
});
