export function indiaPostJoinMessages(values: unknown[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    parts.push(trimmed);
  };

  for (const value of values) {
    if (value == null || value === "") continue;
    if (typeof value === "string") {
      push(value);
      continue;
    }
    if (Array.isArray(value)) {
      const nested = indiaPostJoinMessages(value);
      if (nested) push(nested);
      continue;
    }
    if (typeof value === "object") {
      const rec = value as Record<string, unknown>;
      const msg = rec.msg ?? rec.message ?? rec.error;
      if (typeof msg === "string") push(msg);
      else if (Array.isArray(rec.errors)) {
        const nested = indiaPostJoinMessages(rec.errors);
        if (nested) push(nested);
      }
    }
  }

  return parts.join("; ");
}

export function indiaPostArticleErrorText(errors: unknown): string {
  const list = Array.isArray(errors) ? errors : errors == null ? [] : [errors];
  return indiaPostJoinMessages(list) || "Booking rejected.";
}

export function indiaPostFormatBookingFailure(json: unknown): string {
  const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const field = Array.isArray(rec.errors) ? indiaPostJoinMessages(rec.errors) : "";
  const articles = Array.isArray(rec.error_articles)
    ? indiaPostJoinMessages(
        rec.error_articles.flatMap((article) => {
          const row = article as { errors?: unknown; barcode_no?: unknown };
          const joined = indiaPostArticleErrorText(row.errors);
          if (joined === "Booking rejected.") return [];
          const barcode = String(row.barcode_no ?? "").trim();
          return [barcode ? `${barcode}: ${joined}` : joined];
        })
      )
    : "";
  const message = typeof rec.message === "string" ? rec.message : "";
  return indiaPostJoinMessages([field, articles, message]) || "India Post booking failed.";
}

export function indiaPostBookingHasArticleOutcomes(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const rec = json as Record<string, unknown>;
  const rows = [...(Array.isArray(rec.error_articles) ? rec.error_articles : []), ...(Array.isArray(rec.valid_articles) ? rec.valid_articles : [])];
  return rows.some((article) => String((article as { barcode_no?: unknown })?.barcode_no ?? "").trim());
}
