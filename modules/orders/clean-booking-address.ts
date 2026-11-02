import { wrapIndiaPostAddressLines } from "@/modules/india-post/address-lines";
import { INDIA_POST_ADDRESS_LINE_MAX } from "@/modules/india-post/spec";

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

type Piece = { kind: "word"; word: string; key: string } | { kind: "comma" };

/** Drop a later copy of a 2–6 word name, even when it is not its own comma piece. */
function withoutRepeatedPhrases(parts: string[]) {
  const pieces: Piece[] = [];
  parts.forEach((part, index) => {
    if (index > 0) pieces.push({ kind: "comma" });
    for (const word of part.split(" ")) {
      if (!word) continue;
      pieces.push({ kind: "word", word, key: word.toLocaleLowerCase() });
    }
  });
  const words = pieces.flatMap((piece, index) => (piece.kind === "word" ? [{ index, key: piece.key }] : []));
  const drop = new Set<number>();
  let removed = false;
  for (let size = 6; size >= 2; size -= 1) {
    const seen = new Set<string>();
    for (let start = 0; start + size <= words.length; start += 1) {
      const window = words.slice(start, start + size);
      if (window.some((item) => drop.has(item.index))) continue;
      const gram = window.map((item) => item.key).join(" ");
      if (seen.has(gram)) {
        removed = true;
        for (const item of window) drop.add(item.index);
      } else {
        seen.add(gram);
      }
    }
  }
  const kept: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const next = current.join(" ").trim();
    if (next) kept.push(next);
    current = [];
  };
  pieces.forEach((piece, index) => {
    if (piece.kind === "comma") {
      flush();
      return;
    }
    if (!drop.has(index)) current.push(piece.word);
  });
  flush();
  return { parts: kept, removed };
}

function tidyLine(value: string) {
  return value.replace(/[,;\s]+$/g, "").replace(/\s+,/g, ",").trim();
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
  const tooLong = original.some((line) => line.length > INDIA_POST_ADDRESS_LINE_MAX);
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
  const phrases = withoutRepeatedPhrases(kept);
  if (phrases.removed) removed = true;
  if (!removed && !messy && !tooLong) return null;
  const wrapped = wrapIndiaPostAddressLines(phrases.parts.join(", "));
  const next = [tidyLine(wrapped.line1), tidyLine(wrapped.line2 ?? ""), tidyLine(wrapped.line3 ?? "")];
  if (next.every((line, index) => line === original[index])) return null;
  return {
    line1: next[0] ?? "",
    line2: next[1] ?? "",
    line3: next[2] ?? "",
    changed: {
      line1: (next[0] ?? "") !== original[0],
      line2: (next[1] ?? "") !== original[1],
      line3: (next[2] ?? "") !== original[2],
    },
    reasons: [
      removed ? "Repeated locality or address line removed." : "",
      messy ? "Extra commas or spaces removed." : "",
      tooLong && !removed ? "Address line fitted to the India Post label." : "",
    ].filter(Boolean),
  };
}
