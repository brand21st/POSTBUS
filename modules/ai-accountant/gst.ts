import { interStateSplit, intraStateSplit, splitInclusiveTax, taxOnExclusive } from "@/modules/ai-accountant/money";

const STATE_CODES: Record<string, string> = {
  "andhra pradesh": "37",
  "arunachal pradesh": "12",
  assam: "18",
  bihar: "10",
  chhattisgarh: "22",
  delhi: "07",
  goa: "30",
  gujarat: "24",
  haryana: "06",
  "himachal pradesh": "02",
  jharkhand: "20",
  karnataka: "29",
  kerala: "32",
  "madhya pradesh": "23",
  maharashtra: "27",
  manipur: "14",
  meghalaya: "17",
  mizoram: "15",
  nagaland: "13",
  odisha: "21",
  punjab: "03",
  rajasthan: "08",
  sikkim: "11",
  "tamil nadu": "33",
  telangana: "36",
  tripura: "16",
  "uttar pradesh": "09",
  uttarakhand: "05",
  "west bengal": "19",
  "jammu and kashmir": "01",
  "jammu & kashmir": "01",
  ladakh: "38",
  chandigarh: "04",
  "nct of delhi": "07",
  "new delhi": "07",
  orissa: "21",
  puducherry: "34",
  pondicherry: "34",
  "dadra and nagar haveli and daman and diu": "26",
  "daman and diu": "26",
  "dadra and nagar haveli": "26",
  lakshadweep: "31",
  "andaman and nicobar islands": "35",
  "andaman & nicobar islands": "35",
};

/** Accepts a state name, an ISO-style code like "IN-KA"/"KA", or a two-digit GST code. */
const ABBREVIATIONS: Record<string, string> = {
  AP: "37", AR: "12", AS: "18", BR: "10", CG: "22", CT: "22", DL: "07", GA: "30", GJ: "24", HR: "06",
  HP: "02", JH: "20", KA: "29", KL: "32", MP: "23", MH: "27", MN: "14", ML: "17", MZ: "15", NL: "13",
  OD: "21", OR: "21", PB: "03", RJ: "08", SK: "11", TN: "33", TS: "36", TG: "36", TR: "16", UP: "09",
  UK: "05", UT: "05", WB: "19", JK: "01", LA: "38", CH: "04", PY: "34", DN: "26", DD: "26", LD: "31", AN: "35",
};

export function stateCodeFromName(state?: string | null) {
  if (!state) return null;
  const raw = state.trim();
  if (/^\d{2}$/.test(raw)) return raw;
  const abbr = raw.toUpperCase().replace(/^IN-/, "");
  if (ABBREVIATIONS[abbr]) return ABBREVIATIONS[abbr];
  return STATE_CODES[raw.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

export function gstinStateCode(gstin?: string | null) {
  const value = (gstin ?? "").trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(value)) return null;
  return value.slice(0, 2);
}

export type GstComputation = {
  completeness: "ACTUAL" | "INCOMPLETE";
  reason?: string;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  rateBps: number;
  intraState: boolean;
  ruleId?: string;
};

export function computeGst(input: {
  amountPaise: number;
  inclusive: boolean;
  rateBps: number;
  merchantState?: string | null;
  placeOfSupplyState?: string | null;
  ruleId?: string;
}): GstComputation {
  if (input.rateBps < 0 || !Number.isInteger(input.rateBps)) {
    return { completeness: "INCOMPLETE", reason: "invalid_rate", taxablePaise: 0, taxPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, rateBps: 0, intraState: true };
  }
  if (!input.merchantState || !input.placeOfSupplyState) {
    return {
      completeness: "INCOMPLETE",
      reason: "missing_place_of_supply",
      taxablePaise: 0,
      taxPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      rateBps: input.rateBps,
      intraState: true,
      ruleId: input.ruleId,
    };
  }
  const intraState = input.merchantState === input.placeOfSupplyState;
  const { taxablePaise, taxPaise } = input.inclusive
    ? splitInclusiveTax(input.amountPaise, input.rateBps)
    : { taxablePaise: input.amountPaise, taxPaise: taxOnExclusive(input.amountPaise, input.rateBps) };
  const split = intraState ? intraStateSplit(taxPaise) : interStateSplit(taxPaise);
  return {
    completeness: "ACTUAL",
    taxablePaise,
    taxPaise,
    ...split,
    rateBps: input.rateBps,
    intraState,
    ruleId: input.ruleId,
  };
}
