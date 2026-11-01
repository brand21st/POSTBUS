const DAY_MS = 24 * 60 * 60 * 1000;

export type WooSyncWindow = {
  importDays?: number | null;
  customAfter?: string | null;
  customBefore?: string | null;
  lastSuccessfulSyncAt?: string | null;
  incremental?: boolean;
};

export function wooOrderListQuery(input: WooSyncWindow, page: number) {
  const query: Record<string, string> = {
    page: String(Math.max(1, page)),
    per_page: "100",
    orderby: "modified",
    order: "asc",
  };
  if (input.incremental && input.lastSuccessfulSyncAt) {
    const cursor = new Date(Date.parse(input.lastSuccessfulSyncAt) - 2 * 60 * 1000);
    if (!Number.isNaN(cursor.getTime())) query.modified_after = cursor.toISOString();
    return query;
  }
  if (input.customAfter) query.after = input.customAfter;
  else {
    const days = input.importDays && input.importDays > 0 ? input.importDays : 30;
    query.after = new Date(Date.now() - days * DAY_MS).toISOString();
  }
  if (input.customBefore) query.before = input.customBefore;
  return query;
}

export function wooHasMorePages(page: number, totalPages: number | null) {
  if (!totalPages || totalPages < 1) return false;
  return page < totalPages;
}

export function redactWooText(value: string) {
  return value
    .replace(/ck_[A-Za-z0-9]+/g, "ck_[redacted]")
    .replace(/cs_[A-Za-z0-9]+/g, "cs_[redacted]")
    .replace(/consumer_key=[^&\s]+/gi, "consumer_key=[redacted]")
    .replace(/consumer_secret=[^&\s]+/gi, "consumer_secret=[redacted]");
}
