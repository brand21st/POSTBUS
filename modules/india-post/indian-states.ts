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

const ABBREVIATIONS: Record<string, string> = {
  AP: "37", AR: "12", AS: "18", BR: "10", CG: "22", CT: "22", DL: "07", GA: "30", GJ: "24", HR: "06",
  HP: "02", JH: "20", KA: "29", KL: "32", MP: "23", MH: "27", MN: "14", ML: "17", MZ: "15", NL: "13",
  OD: "21", OR: "21", PB: "03", RJ: "08", SK: "11", TN: "33", TS: "36", TG: "36", TR: "16", UP: "09",
  UK: "05", UT: "05", WB: "19", JK: "01", LA: "38", CH: "04", PY: "34", DN: "26", DD: "26", LD: "31", AN: "35",
};

const CODE_TO_STATE_NAME: Record<string, string> = {};
for (const [name, code] of Object.entries(STATE_CODES)) {
  if (!CODE_TO_STATE_NAME[code]) {
    CODE_TO_STATE_NAME[code] = name.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}

/** Accepts a state name, an ISO-style code like "IN-KA"/"KA", or a two-digit GST code. */
export function stateCodeFromName(state?: string | null) {
  if (!state) return null;
  const raw = state.trim();
  if (/^\d{2}$/.test(raw)) return raw;
  const abbr = raw.toUpperCase().replace(/^IN-/, "");
  if (ABBREVIATIONS[abbr]) return ABBREVIATIONS[abbr];
  return STATE_CODES[raw.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/** Canonical state or union-territory name for a Shopify province, code, or GST state code. */
export function canonicalStateName(state?: string | null) {
  const code = stateCodeFromName(state);
  if (!code) return null;
  return CODE_TO_STATE_NAME[code] ?? null;
}
