/** Accounting periods are calendar dates in IST (Asia/Kolkata, UTC+05:30, no DST). */

const IST_OFFSET_MS = 330 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Period = { from: string; to: string; label: string };

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function istDate(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** UTC instant of 00:00 IST on a calendar date, for timestamptz range queries. */
export function istDayStartUtc(date: string): string {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date ${date}`);
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) - IST_OFFSET_MS).toISOString();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Exclusive UTC upper bound for an inclusive IST end date. */
export function istDayEndExclusiveUtc(date: string): string {
  return istDayStartUtc(addDays(date, 1));
}

export function monthPeriod(year: number, month: number): Period {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}`, label };
}

export function fiscalYearPeriod(on: string, startMonth = 4): Period {
  const [y, m] = on.split("-").map(Number);
  const startYear = m! >= startMonth ? y! : y! - 1;
  const from = `${startYear}-${pad(startMonth)}-01`;
  const to = addDays(startMonth === 1 ? `${startYear + 1}-01-01` : `${startYear + 1}-${pad(startMonth)}-01`, -1);
  const label =
    startMonth === 1 ? `FY ${startYear}` : `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { from, to, label };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

/** Resolve ?from&to query params; defaults to the current IST month. */
export function resolvePeriod(input: { from?: string | null; to?: string | null; now?: Date }): Period {
  const today = istDate(input.now ?? new Date());
  if (isIsoDate(input.from) && isIsoDate(input.to)) {
    if (input.from > input.to) throw new Error("Period start must be on or before the end.");
    return { from: input.from, to: input.to, label: `${input.from} to ${input.to}` };
  }
  const [y, m] = today.split("-").map(Number);
  return monthPeriod(y!, m!);
}

/** Months covered by a period, oldest first, for monthly charts. */
export function monthsInPeriod(period: { from: string; to: string }): Period[] {
  const out: Period[] = [];
  let [y, m] = period.from.split("-").map(Number) as [number, number];
  const [ty, tm] = period.to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(monthPeriod(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 60) break;
  }
  return out;
}
