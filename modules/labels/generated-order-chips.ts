import type { LabelRecord } from "@/types/api";

export type GeneratedOrderChip = {
  orderNumber: string;
  printed: boolean;
  today: boolean;
};

export function istCalendarDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function generatedOrderNumber(row: LabelRecord) {
  const barcodeState = String(row.barcodeStatus ?? row.barcode_status ?? "").toUpperCase();
  const packingState = String(row.packingStatus ?? row.packing_status ?? "").toUpperCase();
  const status = String(row.status ?? "").toUpperCase();
  const generated = barcodeState === "READY" || packingState === "READY" || status === "READY";
  if (!generated) return "";
  return (row.orderNumber || row.order_number || "").trim();
}

function isPrintedLabel(row: LabelRecord) {
  return String(row.printStatus ?? row.print_status ?? "").toUpperCase() === "PRINTED";
}

function labelCreatedAt(row: LabelRecord) {
  return row.createdAt ?? row.created_at ?? null;
}

export function generatedOrderChips(rows: LabelRecord[], now = new Date()): GeneratedOrderChip[] {
  const today = istCalendarDate(now);
  const seen = new Map<string, GeneratedOrderChip>();
  for (const row of rows) {
    const orderNumber = generatedOrderNumber(row);
    if (!orderNumber) continue;
    const printed = isPrintedLabel(row);
    const createdToday = Boolean(today) && istCalendarDate(labelCreatedAt(row)) === today;
    const existing = seen.get(orderNumber);
    if (!existing) {
      seen.set(orderNumber, { orderNumber, printed, today: createdToday });
      continue;
    }
    if (!printed) existing.printed = false;
    if (createdToday) existing.today = true;
  }

  const chips = [...seen.values()];
  const todayUnprinted = chips.filter((chip) => !chip.printed && chip.today);
  const earlierUnprinted = chips.filter((chip) => !chip.printed && !chip.today);
  const printed = chips.filter((chip) => chip.printed);
  return [...todayUnprinted, ...earlierUnprinted, ...printed];
}

export function generatedOrderChipGroups(chips: GeneratedOrderChip[]) {
  return {
    today: chips.filter((chip) => !chip.printed && chip.today),
    earlier: chips.filter((chip) => !chip.printed && !chip.today),
    printed: chips.filter((chip) => chip.printed),
  };
}
