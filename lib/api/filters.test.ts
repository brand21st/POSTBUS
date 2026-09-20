import { describe, expect, it } from "vitest";
import { ilikePattern, orExact, orIlike, sanitizePostgrestValue } from "@/lib/api/filters";

describe("postgrest filter sanitization", () => {
  it("strips filter metacharacters", () => {
    expect(sanitizePostgrestValue("PB-1,status.eq.READY")).toBe("PB-1statuseqREADY");
    expect(sanitizePostgrestValue("a%b_c(d)")).toBe("abcd");
  });

  it("builds ilike and exact or-filters only from safe values", () => {
    expect(orIlike(["barcode", "tracking_number"], "AB12")).toBe(
      "barcode.ilike.%AB12%,tracking_number.ilike.%AB12%"
    );
    expect(orExact(["barcode", "tracking_number"], "AB12,hack")).toBe(
      "barcode.eq.AB12hack,tracking_number.eq.AB12hack"
    );
    expect(ilikePattern("   ")).toBeNull();
    expect(orIlike(["name"], ",,,")).toBeNull();
  });
});
