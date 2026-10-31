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

/** Pack street lines into CEPT’s 3×80 limit instead of rejecting a long line 2. */
export function wrapIndiaPostAddressLines(
  line1: string | null | undefined,
  line2?: string | null,
  line3?: string | null
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

  return {
    line1: lines[0] ?? "",
    line2: lines[1] || undefined,
    line3: lines[2] || undefined,
  };
}
