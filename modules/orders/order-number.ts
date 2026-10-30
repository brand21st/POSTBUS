const PB_SEQUENCE = /^PB-(\d+)$/i;
const WA_PB_SEQUENCE = /^WA-PB-(\d+)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPbSequenceNumber(value: string) {
  return PB_SEQUENCE.test(value.trim());
}

export function isWaPbSequenceNumber(value: string) {
  return WA_PB_SEQUENCE.test(canonicalOrderNumber(value));
}

export function isAllocatedSequenceNumber(value: string) {
  const canonical = canonicalOrderNumber(value);
  return isPbSequenceNumber(canonical) || isWaPbSequenceNumber(canonical);
}

/** Browser autofill often resubmits the last sequence id; those must be reallocated. */
export function shouldReallocateOnConflict(requestedNumber: string) {
  const trimmed = requestedNumber.trim();
  return !trimmed || isAllocatedSequenceNumber(trimmed);
}

export function canonicalOrderNumber(value: string) {
  return value.trim().replace(/^#+/, "").trim().toUpperCase();
}

export function isUuid(value: string) {
  return UUID_RE.test(value.trim());
}

/** Resolve a dashboard/API order key without sending order numbers into uuid columns. */
export function orderLookup(idOrNumber: string): { column: "id" | "order_number"; value: string } | null {
  const trimmed = idOrNumber.trim();
  if (!trimmed) return null;
  if (isUuid(trimmed)) return { column: "id", value: trimmed };
  const number = canonicalOrderNumber(trimmed);
  return number ? { column: "order_number", value: number } : null;
}

/** Digits used for API-wide order-number sort (`orders.order_number_sort`). */
export function orderNumberSortValue(value: string): bigint | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return BigInt(digits);
}

/** Customer/merchant-facing WhatsApp order id, e.g. #WA-PB-10001. */
export function formatWhatsAppOrderNumber(value: string) {
  const canonical = canonicalOrderNumber(value);
  return canonical ? `#${canonical}` : "";
}

export function nextPbOrderNumber(existing: Array<string | null | undefined>) {
  let max = 10000;
  for (const value of existing) {
    const match = PB_SEQUENCE.exec(canonicalOrderNumber(String(value ?? "")));
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `PB-${max + 1}`;
}

export function nextWaPbOrderNumber(existing: Array<string | null | undefined>) {
  let max = 10000;
  for (const value of existing) {
    const match = WA_PB_SEQUENCE.exec(canonicalOrderNumber(String(value ?? "")));
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `WA-PB-${max + 1}`;
}

type ConflictSource = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

export function isOrderNumberConflict(error?: string | ConflictSource | null) {
  if (!error) return false;
  if (typeof error === "string") {
    return /orders_org_number_idx|duplicate key value|23505/i.test(error);
  }
  if (error.code === "23505") return true;
  return /orders_org_number_idx|duplicate key value|23505/i.test(
    `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`
  );
}
