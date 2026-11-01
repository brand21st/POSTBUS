import { describe, expect, it } from "vitest";
import {
  nextDraftRange,
  todayOrderRange,
  yesterdayOrderRange,
} from "@/components/dashboard/order-date-filter";

describe("order date preset ranges", () => {
  it("covers the merchant's complete local day", () => {
    const range = todayOrderRange(new Date(2026, 8, 23, 12, 30));

    expect(range.from.getFullYear()).toBe(2026);
    expect(range.from.getMonth()).toBe(8);
    expect(range.from.getDate()).toBe(23);
    expect([range.from.getHours(), range.from.getMinutes(), range.from.getSeconds(), range.from.getMilliseconds()]).toEqual([
      0, 0, 0, 0,
    ]);
    expect([range.to.getHours(), range.to.getMinutes(), range.to.getSeconds(), range.to.getMilliseconds()]).toEqual([
      23, 59, 59, 999,
    ]);
  });

  it("builds yesterday without changing the current day", () => {
    const now = new Date(2026, 8, 23, 12, 30);
    const range = yesterdayOrderRange(now);

    expect(range.from.getDate()).toBe(22);
    expect(now.getDate()).toBe(23);
  });

  it("selects a full single day so Apply can run immediately", () => {
    const day = new Date(2026, 9, 30, 12);
    const draft = nextDraftRange(null, null, day);
    expect(draft.start.getDate()).toBe(30);
    expect(draft.end.getDate()).toBe(30);
    const range = todayOrderRange(draft.start);
    expect(range.from.getHours()).toBe(0);
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
  });

  it("extends a single-day draft into a range on the second click", () => {
    const start = new Date(2026, 9, 28);
    const end = new Date(2026, 9, 30);
    const first = nextDraftRange(null, null, start);
    const second = nextDraftRange(first.start, first.end, end);
    expect(second.start.getDate()).toBe(28);
    expect(second.end.getDate()).toBe(30);
  });
});
