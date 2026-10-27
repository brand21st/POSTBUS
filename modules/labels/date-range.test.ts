import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarDateInZone,
  parseCalendarDate,
  resolveIanaTimezone,
  resolveLabelDateBounds,
  zonedDayStartUtc,
} from "@/modules/labels/date-range";

describe("label date range", () => {
  it("parses calendar dates and rejects impossible days", () => {
    expect(parseCalendarDate("2026-10-27")).toBe("2026-10-27");
    expect(parseCalendarDate("2026-02-31")).toBeNull();
    expect(parseCalendarDate("27-10-2026")).toBeNull();
  });

  it("falls back to Asia/Kolkata for invalid timezones", () => {
    expect(resolveIanaTimezone("")).toBe("Asia/Kolkata");
    expect(resolveIanaTimezone("Not/AZone")).toBe("Asia/Kolkata");
    expect(resolveIanaTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  it("places IST midnight at 18:30 UTC the previous day", () => {
    expect(zonedDayStartUtc("2026-10-27", "Asia/Kolkata")?.toISOString()).toBe("2026-10-26T18:30:00.000Z");
    expect(calendarDateInZone(new Date("2026-10-26T18:29:59.000Z"), "Asia/Kolkata")).toBe("2026-10-26");
    expect(calendarDateInZone(new Date("2026-10-26T18:30:00.000Z"), "Asia/Kolkata")).toBe("2026-10-27");
  });

  it("uses inclusive start and exclusive end for today in Asia/Kolkata", () => {
    const now = new Date("2026-10-27T00:30:00+05:30");
    const bounds = resolveLabelDateBounds({ date: "today" }, "Asia/Kolkata", now);
    expect(bounds?.fromIso).toBe("2026-10-26T18:30:00.000Z");
    expect(bounds?.toIso).toBe("2026-10-27T18:30:00.000Z");
  });

  it("computes yesterday from the org timezone calendar", () => {
    const now = new Date("2026-10-27T00:30:00+05:30");
    const bounds = resolveLabelDateBounds({ date: "yesterday" }, "Asia/Kolkata", now);
    expect(bounds?.fromIso).toBe("2026-10-25T18:30:00.000Z");
    expect(bounds?.toIso).toBe("2026-10-26T18:30:00.000Z");
  });

  it("covers both selected days for a date range", () => {
    const bounds = resolveLabelDateBounds(
      { date: "range", from: "2026-10-27", to: "2026-10-28" },
      "Asia/Kolkata"
    );
    expect(bounds?.fromIso).toBe("2026-10-26T18:30:00.000Z");
    expect(bounds?.toIso).toBe("2026-10-28T18:30:00.000Z");
    expect(addCalendarDays("2026-10-28", 1)).toBe("2026-10-29");
  });

  it("swaps a reversed range and leaves all unrestricted", () => {
    const bounds = resolveLabelDateBounds(
      { date: "range", from: "2026-10-28", to: "2026-10-27" },
      "Asia/Kolkata"
    );
    expect(bounds?.fromIso).toBe("2026-10-26T18:30:00.000Z");
    expect(bounds?.toIso).toBe("2026-10-28T18:30:00.000Z");
    expect(resolveLabelDateBounds({ date: "all" }, "Asia/Kolkata")).toBeNull();
  });
});
