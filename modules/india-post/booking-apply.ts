import { indiaPostAcceptedArticleId } from "@/modules/india-post/barcode";

export type IndiaPostBookingResponse = {
  success?: boolean;
  batch_id?: string;
  correlation_id?: string;
  valid_articles?: Array<{
    barcode_no?: string;
    article_number?: string;
    calculated_tariff?: number;
    errors?: string[];
  }>;
  error_articles?: Array<{
    barcode_no?: string;
    errors?: string[];
  }>;
};

export function splitIndiaPostBookingResult(result: IndiaPostBookingResponse | null | undefined) {
  const valid = new Map<string, { barcode: string; tariff?: number; articleId: string }>();
  const failed = new Map<string, string>();
  for (const article of result?.valid_articles ?? []) {
    const barcode = String(article.barcode_no ?? "").toUpperCase();
    if (!barcode) continue;
    valid.set(barcode, {
      barcode,
      tariff: article.calculated_tariff,
      articleId: indiaPostAcceptedArticleId(article, barcode),
    });
  }
  for (const article of result?.error_articles ?? []) {
    const barcode = String(article.barcode_no ?? "").toUpperCase();
    const message = article.errors?.[0] || "Booking rejected.";
    if (barcode) failed.set(barcode, message);
  }
  return {
    batchId: result?.batch_id ?? null,
    correlationId: result?.correlation_id ?? null,
    valid,
    failed,
  };
}
