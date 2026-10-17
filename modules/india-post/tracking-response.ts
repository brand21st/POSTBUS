import { z } from "zod";

const optionalText = z.union([z.string(), z.number(), z.null()]).optional();

const trackingDetailSchema = z
  .object({
    date: optionalText,
    time: optionalText,
    office: optionalText,
    officeid: optionalText,
    event: optionalText,
    event_code: optionalText,
    remarks: optionalText,
    rts: z.boolean().optional(),
  })
  .passthrough();

function asArray<T>(value: unknown): T[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "object") return [value as T];
  return undefined;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

export function civilIndiaPostDate(value: string) {
  const date = value.trim();
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return date;
  const dmy = date.match(/^(\d{1,2})[/.\\-](\d{1,2})[/.\\-](\d{4})$/);
  if (!dmy) return null;
  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  const year = Number(dmy[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeTrackingDetail(raw: Record<string, unknown>) {
  const date = firstText(raw.date, raw.event_date, raw.eventDate, raw.eventon);
  const time = firstText(raw.time, raw.event_time, raw.eventTime);
  const event = firstText(raw.event, raw.event_description, raw.eventDescription, raw.status);
  const office = firstText(
    raw.office,
    raw.event_office_name,
    raw.officeName,
    raw.office_name,
    raw.location
  );
  const event_code = firstText(raw.event_code, raw.eventCode, raw.eventcode);
  const officeid = firstText(raw.officeid, raw.office_id, raw.officeId, raw.event_office_id);
  return {
    ...raw,
    ...(date ? { date } : {}),
    ...(time ? { time } : {}),
    ...(event ? { event } : {}),
    ...(office ? { office } : {}),
    ...(event_code ? { event_code } : {}),
    ...(officeid ? { officeid } : {}),
  };
}

function articleList(value: unknown) {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    const nested = row.articles ?? row.article ?? row.tracking ?? row.result;
    if (nested != null && nested !== value) return asArray(nested) ?? asArray(value);
  }
  return asArray(value);
}

function articleTrackingDetails(row: Record<string, unknown>) {
  return row.tracking_details ?? row.trackingDetails ?? row.event_details ?? row.events;
}

const bulkArticleSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  const booking =
    row.booking_details && typeof row.booking_details === "object"
      ? (row.booking_details as Record<string, unknown>)
      : {};
  return {
    ...row,
    article_number: firstText(row.article_number, row.articleNumber, booking.article_number),
    tracking_details: articleTrackingDetails(row),
  };
}, z
  .object({
    article_number: optionalText,
    booking_details: z
      .object({
        article_number: optionalText,
        delivery_confirmed_on: optionalText,
      })
      .passthrough()
      .optional(),
    tracking_details: z.preprocess(
      (value) => asArray(value)?.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? normalizeTrackingDetail(item as Record<string, unknown>)
          : item
      ),
      z.array(trackingDetailSchema).optional()
    ),
    del_status: z.object({ del_status: optionalText }).passthrough().optional(),
  })
  .passthrough());

export const bulkTrackingResponseSchema = z
  .object({
    success: z.boolean().optional(),
    status_code: z.number().optional(),
    message: optionalText,
    data: z.preprocess(articleList, z.array(bulkArticleSchema).optional()),
    error: z.object({ message: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export type ParsedBulkTrackingResponse = z.infer<typeof bulkTrackingResponseSchema>;

export function parseBulkTrackingResponse(json: unknown): ParsedBulkTrackingResponse {
  const parsed = bulkTrackingResponseSchema.safeParse(json);
  if (!parsed.success) {
    const error = new Error("Tracking response schema is invalid.");
    (error as { code?: string; status?: number }).code = "TEMPORARY_PROVIDER_FAILURE";
    (error as { status?: number }).status = 502;
    throw error;
  }
  return parsed.data;
}

export function retryAfterMsFromHeader(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

export function bulkArticleNumber(article: {
  article_number?: unknown;
  booking_details?: { article_number?: unknown } | null;
} | null | undefined) {
  return String(article?.booking_details?.article_number ?? article?.article_number ?? "").trim();
}

export function articlesForRequestedBarcodes(
  articles: ParsedBulkTrackingResponse["data"],
  requested: string[]
) {
  const wanted = requested.map((code) => code.trim()).filter(Boolean);
  const wantedSet = new Set(wanted.map((code) => code.toUpperCase()));
  const list = articles ?? [];
  const matched = list.filter((article) => wantedSet.has(bulkArticleNumber(article).toUpperCase()));
  if (matched.length) return matched;
  if (wanted.length === 1 && list.length === 1 && !bulkArticleNumber(list[0])) {
    const details = list[0]?.tracking_details;
    if (Array.isArray(details) && details.length) return list;
  }
  return [];
}
