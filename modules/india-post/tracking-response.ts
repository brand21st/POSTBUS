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

function parseJsonIfString(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function looksLikeTrackingEvent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Boolean(row.event || row.event_description || row.event_code || row.eventDescription) &&
    Boolean(row.date || row.event_date || row.time || row.event_time || row.office);
}

function articleList(value: unknown): unknown[] | undefined {
  const parsed = parseJsonIfString(value);
  if (parsed == null) return undefined;
  if (Array.isArray(parsed)) {
    if (parsed.length && parsed.every(looksLikeTrackingEvent) && !parsed.some((item) => item && typeof item === "object" && "booking_details" in (item as object))) {
      return [{ tracking_details: parsed }];
    }
    return parsed;
  }
  if (typeof parsed === "object") {
    const row = parsed as Record<string, unknown>;
    // TNT01 may return one article object; keep booking_details with its tracking_details.
    if (row.booking_details || row.article_number) return [row];
    const nested = row.articles ?? row.article ?? row.tracking ?? row.result ?? row.tracking_details;
    if (nested != null && nested !== parsed) return articleList(nested) ?? asArray(parsed);
  }
  return asArray(parsed);
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
    article_number: firstText(
      row.article_number,
      row.articleNumber,
      booking.article_number,
      booking.articleNumber,
      booking.articleid,
      row.barcode,
      row.consignment_number
    ),
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
  const root = parseJsonIfString(json);
  const envelope =
    root && typeof root === "object" && !Array.isArray(root)
      ? {
          ...(root as Record<string, unknown>),
          data: (root as Record<string, unknown>).data ??
            (root as Record<string, unknown>).Data ??
            (root as Record<string, unknown>).articles ??
            (root as Record<string, unknown>).Articles ??
            (root as Record<string, unknown>).result,
        }
      : root;
  const parsed = bulkTrackingResponseSchema.safeParse(envelope);
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
  barcode?: unknown;
  consignment_number?: unknown;
  booking_details?: Record<string, unknown> | null;
} | null | undefined) {
  const booking = article?.booking_details ?? undefined;
  return (
    firstText(
      booking?.article_number,
      booking?.articleNumber,
      booking?.articleid,
      article?.article_number,
      article?.barcode,
      article?.consignment_number
    ) ?? ""
  );
}

/** Comparison key only. Display keeps the original article number. */
export function normalizeArticleNumber(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

export type RequestedArticleClassification = "WITH_EVENTS" | "EMPTY_HISTORY" | "UNMATCHED" | "AMBIGUOUS";

export type ClassifiedArticleRow<T> = {
  barcode: string;
  classification: RequestedArticleClassification;
  article?: T;
};

function articleHasEvents(article: { tracking_details?: unknown[] | null }) {
  return Array.isArray(article.tracking_details) && article.tracking_details.length > 0;
}

/**
 * Match returned articles to requested barcodes by normalized article number.
 * Never uses response position. A single unlabeled article may attach only when
 * the request and response each contain exactly one article and that article has
 * no article number. A different article number is not a match.
 * Duplicate article numbers for one requested barcode are ambiguous and are not attached.
 */
function asMatchableArticle(article: object) {
  return article as {
    article_number?: unknown;
    barcode?: unknown;
    consignment_number?: unknown;
    booking_details?: Record<string, unknown> | null;
    tracking_details?: unknown[] | null;
  };
}

export function classifyRequestedArticles<T extends { tracking_details?: unknown[] | null }>(
  articles: T[] | undefined,
  requested: string[]
): { articles: T[]; rows: ClassifiedArticleRow<T>[] } {
  const wanted = requested
    .map((code) => ({ raw: String(code ?? "").trim(), key: normalizeArticleNumber(code) }))
    .filter((row) => row.key);
  const list = articles ?? [];
  const grouped = new Map<string, T[]>();
  const unlabeled: T[] = [];
  for (const article of list) {
    const key = normalizeArticleNumber(bulkArticleNumber(asMatchableArticle(article)));
    if (!key) {
      unlabeled.push(article);
      continue;
    }
    const bucket = grouped.get(key) ?? [];
    bucket.push(article);
    grouped.set(key, bucket);
  }

  const rows: ClassifiedArticleRow<T>[] = [];
  const safe: T[] = [];
  for (const item of wanted) {
    const bucket = grouped.get(item.key) ?? [];
    if (bucket.length > 1) {
      rows.push({ barcode: item.raw, classification: "AMBIGUOUS" });
      continue;
    }
    if (bucket.length === 1) {
      const article = bucket[0];
      const classification = articleHasEvents(article) ? "WITH_EVENTS" : "EMPTY_HISTORY";
      rows.push({ barcode: item.raw, classification, article });
      safe.push(article);
      continue;
    }
    rows.push({ barcode: item.raw, classification: "UNMATCHED" });
  }

  const canUseUnlabeledFallback =
    wanted.length === 1 &&
    list.length === 1 &&
    unlabeled.length === 1 &&
    grouped.size === 0 &&
    rows.length === 1 &&
    rows[0]?.classification === "UNMATCHED" &&
    articleHasEvents(asMatchableArticle(unlabeled[0]));
  if (canUseUnlabeledFallback) {
    const only = unlabeled[0];
    return {
      articles: [only],
      rows: [{ barcode: wanted[0].raw, classification: "WITH_EVENTS", article: only }],
    };
  }

  return { articles: safe, rows };
}

export function articlesForRequestedBarcodes(
  articles: ParsedBulkTrackingResponse["data"],
  requested: string[]
) {
  return classifyRequestedArticles(articles, requested).articles;
}
