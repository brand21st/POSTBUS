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

const bulkArticleSchema = z
  .object({
    booking_details: z
      .object({
        article_number: optionalText,
        delivery_confirmed_on: optionalText,
      })
      .passthrough()
      .optional(),
    tracking_details: z.array(trackingDetailSchema).optional(),
    del_status: z.object({ del_status: optionalText }).passthrough().optional(),
  })
  .passthrough();

export const bulkTrackingResponseSchema = z
  .object({
    success: z.boolean().optional(),
    status_code: z.number().optional(),
    message: optionalText,
    data: z.array(bulkArticleSchema).optional(),
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

export function articlesForRequestedBarcodes(
  articles: ParsedBulkTrackingResponse["data"],
  requested: string[]
) {
  const wanted = new Set(requested.map((code) => code.trim()).filter(Boolean));
  return (articles ?? []).filter((article) => {
    const number = String(article.booking_details?.article_number ?? "").trim();
    return Boolean(number) && wanted.has(number);
  });
}
