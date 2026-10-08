const PB_SEQUENCE = /^PB-(\d+)$/i;

export function isPbSequenceNumber(value: string) {
  return PB_SEQUENCE.test(value.trim());
}

/** Browser autofill often resubmits the last PB-#####; those must be reallocated. */
export function shouldReallocateOnConflict(requestedNumber: string) {
  const trimmed = requestedNumber.trim();
  return !trimmed || isPbSequenceNumber(trimmed);
}

export function nextPbOrderNumber(existing: Array<string | null | undefined>) {
  let max = 10000;
  for (const value of existing) {
    const match = PB_SEQUENCE.exec(String(value ?? "").trim());
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `PB-${max + 1}`;
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
