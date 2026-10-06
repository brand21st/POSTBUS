export type RetrievalKind = "invoice" | "tracking" | "order" | "merchant" | "policy";

export type RetrievalChunk = {
  kind: RetrievalKind;
  text: string;
};

const QUERY_HINTS: Record<RetrievalKind, RegExp> = {
  invoice: /invoice|bill|amount|total|gst|cod|payment/i,
  tracking: /where|track|status|now|scan|location|reached|ndr|timeline|history/i,
  order: /order|item|product|parcel|packet|pb-|details/i,
  merchant: /merchant|seller|shop|contact|website|email|address|gstin|phone number/i,
  policy: /policy|return|refund|exchange|shipping charges|terms|privacy/i,
};

export function scoreRetrievalChunk(kind: RetrievalKind, query: string) {
  const hinted = QUERY_HINTS[kind].test(query) ? 8 : 0;
  const base = kind === "order" ? 3 : kind === "tracking" ? 2 : 1;
  return hinted + base;
}

export function composeRetrievedReply(query: string, chunks: RetrievalChunk[]) {
  const ranked = chunks
    .map((chunk) => ({ ...chunk, score: scoreRetrievalChunk(chunk.kind, query), text: chunk.text.trim() }))
    .filter((chunk) => chunk.text)
    .sort((left, right) => right.score - left.score);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const chunk of ranked) {
    if (seen.has(chunk.text)) continue;
    seen.add(chunk.text);
    lines.push(chunk.text);
  }
  return lines.join(" ");
}
