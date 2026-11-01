import { indiaPostAcceptedArticleId } from "@/modules/india-post/barcode";
import { indiaPostArticleErrorText, isIndiaPostDuplicateArticleMessage } from "@/modules/india-post/error-text";

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
  const valid = new Map<string, { barcode: string; tariff?: number; articleId: string; duplicate?: boolean }>();
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
    const message = indiaPostArticleErrorText(article.errors);
    if (!barcode) continue;
    if (isIndiaPostDuplicateArticleMessage(message)) {
      valid.set(barcode, {
        barcode,
        articleId: indiaPostAcceptedArticleId(article, barcode),
        duplicate: true,
      });
      continue;
    }
    failed.set(barcode, message);
  }
  return {
    batchId: result?.batch_id ?? null,
    correlationId: result?.correlation_id ?? null,
    valid,
    failed,
  };
}

export type MultiArticleOutcome = {
  /** Barcodes CEPT listed as accepted. */
  booked: Set<string>;
  /** Barcodes CEPT listed as rejected, with the provider message. */
  failed: Map<string, string>;
  /** Barcodes whose outcome the response does not prove. Never POST these again. */
  recovery: Set<string>;
  /** Why some or all articles are in recovery, for logs and last_error. */
  recoveryReason: string | null;
};

function responseBarcodes(rows: Array<{ barcode_no?: string }> | undefined) {
  return (rows ?? []).map((row) => String(row.barcode_no ?? "").trim().toUpperCase());
}

/**
 * Per-article outcome for a multi-article POST. Stricter than splitIndiaPostBookingResult:
 * an article the response does not account for is unknown, not rejected. When the response
 * itself is inconsistent (blank, repeated, conflicting or foreign barcodes), a rejection
 * cannot be trusted either, so only accepted articles keep their result.
 */
export function classifyMultiArticleOutcome(
  submittedBarcodes: string[],
  result: IndiaPostBookingResponse | null | undefined
): MultiArticleOutcome {
  const membership = new Set(submittedBarcodes.map((barcode) => barcode.trim().toUpperCase()));
  const split = splitIndiaPostBookingResult(result);
  const reported = [...responseBarcodes(result?.valid_articles), ...responseBarcodes(result?.error_articles)];

  const problems: string[] = [];
  if (reported.some((barcode) => !barcode)) problems.push("an article without a barcode");
  if (reported.some((barcode) => barcode && !membership.has(barcode))) problems.push("an article that was not submitted");
  if (new Set(reported.filter(Boolean)).size !== reported.filter(Boolean).length) problems.push("a repeated article");
  const conflicting = [...split.failed.keys()].filter((barcode) => split.valid.has(barcode));
  if (conflicting.length) problems.push("an article listed as both accepted and rejected");
  const inconsistent = problems.length > 0;

  const booked = new Set<string>();
  const failed = new Map<string, string>();
  const recovery = new Set<string>();
  for (const barcode of membership) {
    if (conflicting.includes(barcode)) {
      recovery.add(barcode);
    } else if (split.valid.has(barcode)) {
      booked.add(barcode);
    } else if (split.failed.has(barcode) && !inconsistent) {
      failed.set(barcode, split.failed.get(barcode)!);
    } else {
      recovery.add(barcode);
    }
  }

  let recoveryReason: string | null = null;
  if (inconsistent) recoveryReason = `India Post response contains ${problems.join(", ")}.`;
  else if (recovery.size) recoveryReason = "India Post response did not list every submitted article.";
  return { booked, failed, recovery, recoveryReason };
}
