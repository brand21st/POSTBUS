import { describe, expect, it } from "vitest";
import {
  fiscalYearPeriod,
  istDate,
  istDayEndExclusiveUtc,
  istDayStartUtc,
  monthPeriod,
  monthsInPeriod,
  resolvePeriod,
} from "@/modules/ai-accountant/period";

describe("IST periods", () => {
  it("rolls UTC evening into the next IST day", () => {
    expect(istDate(new Date("2026-03-31T19:00:00Z"))).toBe("2026-04-01");
    expect(istDayStartUtc("2026-04-01")).toBe("2026-03-31T18:30:00.000Z");
    expect(istDayEndExclusiveUtc("2026-04-30")).toBe("2026-04-30T18:30:00.000Z");
  });

  it("builds Indian fiscal years from April", () => {
    expect(fiscalYearPeriod("2026-03-31")).toMatchObject({ from: "2025-04-01", to: "2026-03-31", label: "FY 2025-26" });
    expect(fiscalYearPeriod("2026-04-01")).toMatchObject({ from: "2026-04-01", to: "2027-03-31" });
    expect(fiscalYearPeriod("2026-06-10", 1)).toMatchObject({ from: "2026-01-01", to: "2026-12-31", label: "FY 2026" });
  });

  it("handles month ends and leap years", () => {
    expect(monthPeriod(2028, 2).to).toBe("2028-02-29");
    expect(monthsInPeriod({ from: "2026-11-05", to: "2027-02-01" }).map((p) => p.from)).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
      "2027-02-01",
    ]);
  });

  it("defaults to the current month and rejects inverted ranges", () => {
    expect(resolvePeriod({ now: new Date("2026-10-26T05:00:00Z") })).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod({ from: "2026-02-30", to: "2026-03-01", now: new Date("2026-10-26T05:00:00Z") }).from).toBe(
      "2026-10-01"
    );
    expect(() => resolvePeriod({ from: "2026-05-01", to: "2026-04-01" })).toThrow();
  });
});
