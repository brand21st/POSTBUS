/** Integer paise helpers. Do not use binary floats for persisted money. */

export function rupeesToPaise(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  const match = text.replace(/,/g, "").match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const rupees = Number(match[2]);
  const fraction = (match[3] ?? "").padEnd(2, "0");
  if (!Number.isFinite(rupees)) return null;
  return sign * (rupees * 100 + Number(fraction));
}

export function paiseFromNumeric(value: string | number | null | undefined): number {
  const parsed = rupeesToPaise(value);
  return parsed ?? 0;
}

export function splitInclusiveTax(totalPaise: number, rateBps: number) {
  if (!Number.isInteger(totalPaise) || !Number.isInteger(rateBps) || rateBps < 0 || totalPaise < 0) {
    throw new Error("GST amounts must be non-negative integers.");
  }
  const divisor = 10_000 + rateBps;
  const taxablePaise = Math.round((totalPaise * 10_000) / divisor);
  const taxPaise = totalPaise - taxablePaise;
  return { taxablePaise, taxPaise };
}

export function taxOnExclusive(taxablePaise: number, rateBps: number) {
  if (!Number.isInteger(taxablePaise) || !Number.isInteger(rateBps) || rateBps < 0 || taxablePaise < 0) {
    throw new Error("GST amounts must be non-negative integers.");
  }
  return Math.round((taxablePaise * rateBps) / 10_000);
}

export function intraStateSplit(taxPaise: number) {
  const cgstPaise = Math.floor(taxPaise / 2);
  const sgstPaise = taxPaise - cgstPaise;
  return { cgstPaise, sgstPaise, igstPaise: 0 };
}

export function interStateSplit(taxPaise: number) {
  return { cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise };
}
