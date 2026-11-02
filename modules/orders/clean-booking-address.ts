import { wrapIndiaPostAddressLines } from "@/modules/india-post/address-lines";

export const SMART_ADDRESS_LABEL = "Smart AI auto correct address";

function collapse(value?: string | null) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function splitFragments(value: string) {
  return value
    .replace(/[,;]{2,}/g, ",")
    .replace(/\s+/g, " ")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Drop repeated localities and extra commas, then fit India Post's line length. */
export function cleanBookingAddressLines(input: {
  line1?: string | null;
  line2?: string | null;
  line3?: string | null;
}) {
  const original = [input.line1, input.line2, input.line3].map(collapse);
  const raw = original.filter(Boolean).join(", ");
  const messy = /[,;]{2,}|[ \t]{2,}/.test([input.line1, input.line2, input.line3].join(","));
  const parts = splitFragments(raw);
  const seen = new Set<string>();
  const kept: string[] = [];
  let removed = false;
  for (const part of parts) {
    const words: string[] = [];
    const wordSeen = new Set<string>();
    for (const word of part.split(" ")) {
      const key = word.toLocaleLowerCase();
      if (!key) continue;
      if (wordSeen.has(key)) {
        removed = true;
        continue;
      }
      wordSeen.add(key);
      words.push(word);
    }
    const next = words.join(" ");
    const key = next.toLocaleLowerCase();
    if (!key || seen.has(key)) {
      removed = true;
      continue;
    }
    seen.add(key);
    kept.push(next);
  }
  if (!removed && !messy) return null;
  const wrapped = wrapIndiaPostAddressLines(kept.join(", "));
  const next = [wrapped.line1, wrapped.line2 ?? "", wrapped.line3 ?? ""];
  if (next.every((line, index) => collapse(line) === original[index])) return null;
  return {
    line1: next[0] ?? "",
    line2: next[1] ?? "",
    line3: next[2] ?? "",
    changed: {
      line1: collapse(next[0]) !== original[0],
      line2: collapse(next[1]) !== original[1],
      line3: collapse(next[2]) !== original[2],
    },
    reasons: [
      removed ? "Repeated locality or address line removed." : "",
      messy ? "Extra commas or spaces removed." : "",
    ].filter(Boolean),
  };
}
