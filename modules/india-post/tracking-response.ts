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

const bulkArticleSchema = z
  .object({
    article_number: optionalText,
    booking_details: z
      .object({
        article_number: optionalText,
        delivery_confirmed_on: optionalText,
      })
      .passthrough()
      .optional(),
    tracking_details: z.preprocess(asArray, z.array(trackingDetailSchema).optional()),
    del_status: z.object({ del_status: optionalText }).passthrough().optional(),
  })
  .passthrough();

export const bulkTrackingResponseSchema = z
  .object({
    success: z.boolean().optional(),
    status_code: z.number().optional(),
    message: optionalText,
    data: z.preprocess(asArray, z.array(bulkArticleSchema).optional()),
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
