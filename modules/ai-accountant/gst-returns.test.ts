import { describe, expect, it } from "vitest";
import { stateCodeFromName } from "@/modules/ai-accountant/gst";
import { buildGstr1, buildGstr3b, setOff, type SupplyLine } from "@/modules/ai-accountant/gst-returns";
import { allocate, orderSupplyLines } from "@/modules/ai-accountant/gst-service";

const base: Omit<SupplyLine, "orderId" | "orderNumber"> = {
  date: "2026-10-05",
  placeOfSupply: "29",
  customerGstin: null,
  hsn: "6109",
  rateBps: 500,
  taxablePaise: 10000,
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 500,
  isReturn: false,
};

describe("GSTR-1", () => {
  it("groups B2C small by state and rate, B2B by invoice, nets credit notes", () => {
    const result = buildGstr1([
      { ...base, orderId: "a", orderNumber: "#1" },
      { ...base, orderId: "b", orderNumber: "#2" },
      { ...base, orderId: "c", orderNumber: "#3", customerGstin: "29ABCDE1234F1Z5" },
      { ...base, orderId: "a", orderNumber: "#1", isReturn: true },
    ]);
    expect(result.b2cs).toHaveLength(1);
    expect(result.b2cs[0]).toMatchObject({ placeOfSupply: "29", rateBps: 500, taxablePaise: 20000, igstPaise: 1000 });
    expect(result.b2b).toHaveLength(1);
    expect(result.creditNotes.unregistered).toHaveLength(1);
    expect(result.totals.taxablePaise).toBe(20000);
    expect(result.hsn[0]).toMatchObject({ hsn: "6109", taxablePaise: 20000 });
  });

  it("puts large inter-state B2C invoices in B2CL", () => {
    const result = buildGstr1([{ ...base, orderId: "big", orderNumber: "#9", taxablePaise: 1_00_000_00, igstPaise: 5_000_00 }]);
    expect(result.b2cl).toHaveLength(1);
    expect(result.b2cs).toHaveLength(0);
  });
});

describe("GSTR-3B set-off", () => {
  it("uses IGST credit first, never crosses CGST and SGST", () => {
    const result = setOff({ cgstPaise: 1000, sgstPaise: 1000, igstPaise: 500 }, { cgstPaise: 0, sgstPaise: 2000, igstPaise: 800 });
    expect(result.cashPayable).toEqual({ cgstPaise: 700, sgstPaise: 0, igstPaise: 0 });
    expect(result.creditCarriedForward.sgstPaise).toBe(1000);
  });

  it("ignores negative outward liability after credit notes", () => {
    const result = buildGstr3b({
      outward: { taxablePaise: -100, cgstPaise: -5, sgstPaise: -5, igstPaise: 0 },
      itc: { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 },
    });
    expect(result.totalCashPaise).toBe(0);
  });
});

describe("order supply lines", () => {
  it("scales lines to the order total and taxes shipping at the principal rate", () => {
    const rates: Record<string, { rateBps: number; hsn: string }> = { tee: { rateBps: 500, hsn: "6109" }, mug: { rateBps: 1800, hsn: "6912" } };
    const { lines, missing } = orderSupplyLines({
      order: { id: "o", orderNumber: "#1", date: "2026-10-05", totalPaise: 2_000_00 + 50_00, shippingPaise: 50_00, customerGstin: null },
      lines: [
        { sku: "tee", quantity: 1, unitPricePaise: 1_000_00 },
        { sku: "mug", quantity: 1, unitPricePaise: 1_200_00 },
      ],
      rateForSku: (sku) => (sku ? rates[sku] ?? null : null),
      merchantState: "32",
      placeOfSupply: "32",
      inclusive: true,
      isReturn: false,
    });
    expect(missing).toBeNull();
    const gross = lines.reduce((sum, line) => sum + line.taxablePaise + line.cgstPaise + line.sgstPaise + line.igstPaise, 0);
    expect(gross).toBe(2_050_00);
    expect(lines[2]?.rateBps).toBe(1800);
    expect(lines.every((line) => line.igstPaise === 0)).toBe(true);
  });

  it("reports missing rate or place of supply instead of guessing", () => {
    const common = {
      order: { id: "o", orderNumber: "#1", date: "2026-10-05", totalPaise: 100, shippingPaise: 0, customerGstin: null },
      lines: [{ sku: "x", quantity: 1, unitPricePaise: 100 }],
      merchantState: "32",
      inclusive: true,
      isReturn: false,
    };
    expect(orderSupplyLines({ ...common, rateForSku: () => null, placeOfSupply: "32" }).missing).toBe("tax_rate");
    expect(orderSupplyLines({ ...common, rateForSku: () => ({ rateBps: 0, hsn: null }), placeOfSupply: null }).missing).toBe("place_of_supply");
  });

  it("allocates with largest remainder", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(5, [0, 0])).toEqual([5, 0]);
  });

  it("maps state names, abbreviations and codes", () => {
    expect(stateCodeFromName("Karnataka")).toBe("29");
    expect(stateCodeFromName("IN-KA")).toBe("29");
    expect(stateCodeFromName("TG")).toBe("36");
    expect(stateCodeFromName("07")).toBe("07");
    expect(stateCodeFromName("Jammu and Kashmir")).toBe("01");
  });
});
