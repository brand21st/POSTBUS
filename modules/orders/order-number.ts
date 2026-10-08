const PB_SEQUENCE = /^PB-(\d+)$/i;
const WA_PB_SEQUENCE = /^WA-PB-(\d+)$/i;

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
