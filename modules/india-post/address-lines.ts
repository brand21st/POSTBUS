import { INDIA_POST_ADDRESS_LINE_MAX } from "@/modules/india-post/spec";

const LINE_MIN = 3;
const LINE_COUNT = 3;

function normalizeStreetPart(value?: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function takeChunk(text: string, maxLen: number) {
  if (text.length <= maxLen) return { chunk: text, rest: "" };
  let take = text.lastIndexOf(" ", maxLen);
  if (take < LINE_MIN) take = maxLen;
  const chunk = text.slice(0, take).trim();
  const rest = text.slice(take).replace(/^[\s,]+/, "").trim();
  return { chunk: chunk || text.slice(0, maxLen), rest: chunk ? rest : text.slice(maxLen).trim() };
}

function splitPart(part: string) {
  const chunks: string[] = [];
  let rest = part;
  while (rest) {
    const next = takeChunk(rest, INDIA_POST_ADDRESS_LINE_MAX);
    chunks.push(next.chunk);
    rest = next.rest;
  }
  return chunks;
}

function mergeShortOptionalLines(lines: string[]) {
  for (let i = lines.length - 1; i >= 1; i--) {
    const line = lines[i];
    if (!line || line.length >= LINE_MIN) continue;
    const previous = lines[i - 1];
    if (previous.length + 1 + line.length <= INDIA_POST_ADDRESS_LINE_MAX) {
      lines[i - 1] = `${previous} ${line}`.trim();
      lines.splice(i, 1);
      continue;
    }
    const need = LINE_MIN - line.length;
    if (previous.length - need >= LINE_MIN) {
      lines[i - 1] = previous.slice(0, previous.length - need).trim();
      lines[i] = `${previous.slice(-need)}${line}`;
    }
  }
}

/** Line 1 is required and must be at least 3 characters. Later lines donate words until it is. */
function fillShortLine1(lines: string[], locality?: string | null) {
  while (lines[0] && lines[0].length < LINE_MIN && lines.length > 1) {
    const words = lines[1].split(" ").filter(Boolean);
    let taken = 0;
    let built = lines[0];
    while (taken < words.length) {
      const next = `${built} ${words[taken]}`.trim();
      if (next.length > INDIA_POST_ADDRESS_LINE_MAX) break;
      built = next;
      taken += 1;
      if (built.length >= LINE_MIN) break;
    }
    if (!taken) break;
    lines[0] = built;
    const rest = words.slice(taken).join(" ");
    if (!rest) {
      lines.splice(1, 1);
      continue;
    }
    if (rest.length < LINE_MIN && `${lines[0]} ${rest}`.trim().length <= INDIA_POST_ADDRESS_LINE_MAX) {
      lines[0] = `${lines[0]} ${rest}`.trim();
      lines.splice(1, 1);
      continue;
    }
    lines[1] = rest;
  }
  const place = normalizeStreetPart(locality);
  if (
    lines[0] &&
    lines[0].length < LINE_MIN &&
    place &&
    !lines[0].toLocaleLowerCase().includes(place.toLocaleLowerCase()) &&
    lines[0].length + 1 + place.length <= INDIA_POST_ADDRESS_LINE_MAX
  ) {
    lines[0] = `${lines[0]} ${place}`.trim();
  }
}

/** Pack street lines into CEPT’s 3×80 limit instead of rejecting a long line 2. */
export function wrapIndiaPostAddressLines(
  line1: string | null | undefined,
  line2?: string | null,
  line3?: string | null,
  locality?: string | null
) {
  const parts = [line1, line2, line3].map(normalizeStreetPart).filter(Boolean);
  const lines: string[] = [];
  for (const part of parts) {
    for (const chunk of splitPart(part)) {
      if (lines.length < LINE_COUNT) lines.push(chunk);
      else lines[lines.length - 1] = `${lines[lines.length - 1]} ${chunk}`.trim();
    }
  }
  mergeShortOptionalLines(lines);
  fillShortLine1(lines, locality);

  return {
    line1: lines[0] ?? "",
    line2: lines[1] || undefined,
    line3: lines[2] || undefined,
  };
}
