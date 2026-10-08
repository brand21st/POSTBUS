const PB_SEQUENCE = /^PB-(\d+)$/i;

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

export function isOrderNumberConflict(message?: string | null) {
  if (!message) return false;
  return /orders_org_number_idx|duplicate key value/i.test(message);
}
