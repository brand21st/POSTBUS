import { describe, expect, it } from "vitest";
import { computeGst } from "@/modules/ai-accountant/gst";
import { parseCodReportText } from "@/modules/ai-accountant/cod/parse";
import { rupeesToPaise, splitInclusiveTax, taxOnExclusive } from "@/modules/ai-accountant/money";

describe("money paise", () => {
  it("parses rupees without binary float drift", () => {
    expect(rupeesToPaise("259.00")).toBe(25900);
    expect(rupeesToPaise("0.10")).toBe(10);
    expect(rupeesToPaise("0.1")).toBe(10);
  });

  it("splits inclusive 18% GST on 118.00", () => {
    expect(splitInclusiveTax(11800, 1800)).toEqual({ taxablePaise: 10000, taxPaise: 1800 });
    expect(taxOnExclusive(10000, 1800)).toBe(1800);
  });
});

describe("GST computation", () => {
  it("uses IGST across states and CGST/SGST inside a state", () => {
    const intra = computeGst({
      amountPaise: 11800,
      inclusive: true,
      rateBps: 1800,
      merchantState: "32",
      placeOfSupplyState: "32",
    });
    expect(intra.completeness).toBe("ACTUAL");
    expect(intra.cgstPaise + intra.sgstPaise).toBe(1800);
    expect(intra.igstPaise).toBe(0);
    const inter = computeGst({
      amountPaise: 11800,
      inclusive: true,
      rateBps: 1800,
      merchantState: "32",
      placeOfSupplyState: "27",
    });
    expect(inter.igstPaise).toBe(1800);
  });

  it("does not invent GST when place of supply is missing", () => {
    const result = computeGst({
      amountPaise: 11800,
      inclusive: true,
      rateBps: 1800,
      merchantState: "32",
      placeOfSupplyState: null,
    });
    expect(result.completeness).toBe("INCOMPLETE");
    expect(result.taxPaise).toBe(0);
  });
});

describe("COD report parse", () => {
  it("extracts article numbers and amounts from a commission line", () => {
    const rows = parseCodReportText("EL835418390IN 19-10-2026 259.00 0.00 259.00");
    expect(rows[0]?.articleBarcode).toBe("EL835418390IN");
    expect(rows[0]?.codAmountPaise).toBe(25900);
    expect(rows[0]?.commissionPaise).toBe(0);
    expect(rows[0]?.deliveredOn).toBe("2026-10-19");
    expect(rows[0]?.netAmountPaise).toBe(25900);
  });
});
