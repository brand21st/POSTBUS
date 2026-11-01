export const DEFAULT_LABEL_TIMEZONE = "Asia/Kolkata";

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type LabelDatePreset = "all" | "today" | "yesterday" | "custom" | "range";

export type LabelDateFilterInput = {
  date?: string | null;
  on?: string | null;
  from?: string | null;
  to?: string | null;
};

export type LabelInstantRange = {
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
};

export function resolveIanaTimezone(value?: string | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_LABEL_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return DEFAULT_LABEL_TIMEZONE;
  }
}

export function parseCalendarDate(value?: string | null) {
  const match = CALENDAR_DATE.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function addCalendarDays(isoDate: string, days: number) {
  const parsed = parseCalendarDate(isoDate);
  if (!parsed) return null;
  const [year, month, day] = parsed.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const yyyy = String(next.getUTCFullYear()).padStart(4, "0");
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function calendarDateInZone(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveIanaTimezone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function zoneClockMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
}

export function zonedDayStartUtc(isoDate: string, timeZone: string) {
  const parsed = parseCalendarDate(isoDate);
  if (!parsed) return null;
  const tz = resolveIanaTimezone(timeZone);
  const [year, month, day] = parsed.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstOffset = zoneClockMs(new Date(utcMidnight), tz) - utcMidnight;
  let instant = utcMidnight - firstOffset;
  const secondOffset = zoneClockMs(new Date(instant), tz) - instant;
  if (secondOffset !== firstOffset) instant = utcMidnight - secondOffset;
  return new Date(instant);
}

function instantRange(startIso: string, endExclusiveIso: string, timeZone: string): LabelInstantRange | null {
  const from = zonedDayStartUtc(startIso, timeZone);
  const to = zonedDayStartUtc(endExclusiveIso, timeZone);
  if (!from || !to || from.getTime() >= to.getTime()) return null;
  return { from, to, fromIso: from.toISOString(), toIso: to.toISOString() };
}

export function normalizeLabelDatePreset(value?: string | null): LabelDatePreset {
  const preset = String(value || "all").toLowerCase();
  if (preset === "today" || preset === "yesterday" || preset === "custom" || preset === "range") return preset;
  return "all";
}

export function resolveLabelDateBounds(
  input: LabelDateFilterInput,
  timeZone: string,
  now = new Date()
): LabelInstantRange | null {
  const tz = resolveIanaTimezone(timeZone);
  const preset = normalizeLabelDatePreset(input.date);
  if (preset === "all") return null;

  const today = calendarDateInZone(now, tz);
  if (preset === "today") {
    const tomorrow = addCalendarDays(today, 1);
    return tomorrow ? instantRange(today, tomorrow, tz) : null;
  }
  if (preset === "yesterday") {
    const yesterday = addCalendarDays(today, -1);
    return yesterday ? instantRange(yesterday, today, tz) : null;
  }
  if (preset === "custom") {
    const on = parseCalendarDate(input.on);
    const next = on ? addCalendarDays(on, 1) : null;
    return on && next ? instantRange(on, next, tz) : null;
  }

  const start = parseCalendarDate(input.from);
  const end = parseCalendarDate(input.to);
  if (!start || !end) return null;
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const next = addCalendarDays(last, 1);
  return next ? instantRange(first, next, tz) : null;
}

export function formatZonedDateTime(
  value: string | Date | null | undefined,
  timeZone: string,
  withTime = false
) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: resolveIanaTimezone(timeZone),
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  }).format(date);
}
