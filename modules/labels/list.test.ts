import { describe, expect, it } from "vitest";
import { matchesLabelKindFilter, normalizeLabelKindFilter } from "@/modules/labels/list";

describe("label kind filters", () => {
  it("normalizes unknown kinds to ALL", () => {
    expect(normalizeLabelKindFilter("complete")).toBe("COMPLETE");
    expect(normalizeLabelKindFilter("other")).toBe("ALL");
  });

  it("matches complete and incomplete shipment groups", () => {
    expect(matchesLabelKindFilter(true, true, "COMPLETE")).toBe(true);
    expect(matchesLabelKindFilter(true, false, "COMPLETE")).toBe(false);
    expect(matchesLabelKindFilter(true, false, "INCOMPLETE")).toBe(true);
    expect(matchesLabelKindFilter(true, false, "INDIA_POST")).toBe(true);
    expect(matchesLabelKindFilter(false, true, "MERCHANT")).toBe(true);
    expect(matchesLabelKindFilter(true, true, "ALL")).toBe(true);
  });
});
