import { describe, expect, it } from "vitest";
import {
  committedSearchChanged,
  ordersListHref,
  parseOrdersPageParam,
  patchOrdersListSearchParams,
  selectionAfterFilterChange,
  selectionAfterPageChange,
} from "@/lib/dashboard/orders-list-query";

describe("parseOrdersPageParam", () => {
  it("defaults missing values to page 1", () => {
    expect(parseOrdersPageParam(null)).toBe(1);
    expect(parseOrdersPageParam("")).toBe(1);
  });

  it("accepts valid positive integers", () => {
    expect(parseOrdersPageParam("2")).toBe(2);
  });

  it("rejects invalid page parameters", () => {
    expect(parseOrdersPageParam("0")).toBe(1);
    expect(parseOrdersPageParam("-3")).toBe(1);
    expect(parseOrdersPageParam("1.5")).toBe(1);
    expect(parseOrdersPageParam("page")).toBe(1);
  });
});

describe("patchOrdersListSearchParams", () => {
  it("preserves search while updating page", () => {
    expect(patchOrdersListSearchParams("q=phone", { page: 2 })).toBe("q=phone&page=2");
  });

  it("preserves unrelated query parameters", () => {
    expect(patchOrdersListSearchParams("q=phone&utm=1", { page: 2 })).toBe("q=phone&utm=1&page=2");
  });

  it("omits page=1 from the URL", () => {
    expect(patchOrdersListSearchParams("page=2&q=phone", { page: 1 })).toBe("q=phone");
    expect(ordersListHref("")).toBe("/dashboard/orders");
  });
});

describe("selection policy", () => {
  it("clears selection on a filter change", () => {
    expect(selectionAfterFilterChange()).toEqual([]);
  });

  it("keeps selection when only the page changes", () => {
    expect(selectionAfterPageChange(["A", "B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("treats committed search changes as a filter change", () => {
    expect(committedSearchChanged("", "acme")).toBe(true);
    expect(committedSearchChanged("acme", "acme")).toBe(false);
  });
});
