import { MAX_LABELS } from "@/modules/labels/multi-up/request";

export const MULTI_PRINT_PAGE_SIZE = 50;

export type MultiPrintCopyRow = {
  orderId: string;
  copies: number;
};

export function labelCopyCount(items: MultiPrintCopyRow[]) {
  return items.reduce((sum, item) => sum + item.copies, 0);
}

export function uniqueOrderIds(items: MultiPrintCopyRow[]) {
  return [...new Set(items.map((item) => item.orderId))];
}

/** Merge newly chosen orders into the print queue without duplicates or exceeding the sheet cap. */
export function mergeSelectedItems(
  current: MultiPrintCopyRow[],
  added: Array<{ orderId: string; copies?: number }>,
  maxLabels = MAX_LABELS
): MultiPrintCopyRow[] {
  const next = [...current];
  const seen = new Set(current.map((item) => item.orderId));
  let total = labelCopyCount(next);
  for (const row of added) {
    const orderId = row.orderId.trim();
    if (!orderId || seen.has(orderId)) continue;
    const copies = Math.max(1, Math.floor(row.copies ?? 1));
    if (total + copies > maxLabels) break;
    seen.add(orderId);
    next.push({ orderId, copies });
    total += copies;
  }
  return next;
}

export function remainingLabelSlots(items: MultiPrintCopyRow[], maxLabels = MAX_LABELS) {
  return Math.max(0, maxLabels - labelCopyCount(items));
}

export function multiPrintLabelsPath(page: number, pageSize = MULTI_PRINT_PAGE_SIZE, q?: string) {
  const params = new URLSearchParams({ page: String(Math.max(1, page)), pageSize: String(pageSize) });
  const search = q?.trim();
  if (search) params.set("q", search);
  return `/api/v1/labels?${params.toString()}`;
}
