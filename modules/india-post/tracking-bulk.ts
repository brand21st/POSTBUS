import { env } from "@/lib/env";
import { articlesForRequestedBarcodes, parseBulkTrackingResponse } from "@/modules/india-post/tracking-response";
import type { BulkTrackingArticle } from "@/modules/india-post/apply-tracking";

const REJECT_HTTP = new Set([400, 403, 404]);

export type BulkTrackOutcome =
  | { barcode: string; status: "found"; article: BulkTrackingArticle }
  | { barcode: string; status: "absent" }
  | { barcode: string; status: "lookup_rejected"; httpStatus: number; message: string };

export type BulkChunkResult =
  | { kind: "ok"; articles: BulkTrackingArticle[] }
  | { kind: "reject"; status: number; message: string };

export type TrackShipmentResult = {
  data: BulkTrackingArticle[];
  outcomes: BulkTrackOutcome[];
};

export function trackingIsolateMaxRequests() {
  const parsed = Number(env.indiaPostTrackingIsolateMaxRequests);
  if (!Number.isFinite(parsed) || parsed < 1) return 32;
  return Math.min(64, Math.trunc(parsed));
}

export function isTrackingLookupRejectStatus(status: number) {
  return REJECT_HTTP.has(status);
}

export function outcomesFromOkChunk(requested: string[], articles: BulkTrackingArticle[]): BulkTrackOutcome[] {
  const matched = articlesForRequestedBarcodes(articles, requested);
  const byBarcode = new Map(
    matched.map((article) => [String(article.booking_details?.article_number ?? "").trim(), article])
  );
  return requested.map((barcode) => {
    const article = byBarcode.get(barcode);
    if (article) return { barcode, status: "found" as const, article: article as BulkTrackingArticle };
    return { barcode, status: "absent" as const };
  });
}

export function rejectedOutcomes(requested: string[], status: number, message: string): BulkTrackOutcome[] {
  return requested.map((barcode) => ({
    barcode,
    status: "lookup_rejected" as const,
    httpStatus: status,
    message,
  }));
}

export async function isolateBulkTrackingChunk(
  barcodes: string[],
  fetchChunk: (batch: string[]) => Promise<BulkChunkResult>,
  budget: { remaining: number }
): Promise<BulkTrackOutcome[]> {
  if (!barcodes.length) return [];
  if (budget.remaining <= 0) {
    return rejectedOutcomes(barcodes, 400, "Tracking isolation budget exhausted.");
  }
  budget.remaining -= 1;
  const result = await fetchChunk(barcodes);
  if (result.kind === "ok") {
    return outcomesFromOkChunk(barcodes, result.articles);
  }
  if (barcodes.length === 1) {
    return rejectedOutcomes(barcodes, result.status, result.message);
  }
  const mid = Math.ceil(barcodes.length / 2);
  const left = await isolateBulkTrackingChunk(barcodes.slice(0, mid), fetchChunk, budget);
  const right = await isolateBulkTrackingChunk(barcodes.slice(mid), fetchChunk, budget);
  return [...left, ...right];
}

export function articlesFromOutcomes(outcomes: BulkTrackOutcome[]): BulkTrackingArticle[] {
  return outcomes.filter((row): row is Extract<BulkTrackOutcome, { status: "found" }> => row.status === "found").map(
    (row) => row.article
  );
}

export function parseOkTrackingJson(json: unknown, requested: string[]): BulkTrackingArticle[] {
  const parsed = parseBulkTrackingResponse(json);
  if (parsed.success === false) {
    const status = parsed.status_code ?? 502;
    const error = new Error(String(parsed.error?.message ?? parsed.message ?? "Tracking lookup failed.")) as {
      status?: number;
      code?: string;
    };
    error.status = status;
    if (!(status >= 400 && status < 500 && status !== 429)) {
      error.code = "TEMPORARY_PROVIDER_FAILURE";
    }
    throw error;
  }
  return articlesForRequestedBarcodes(parsed.data, requested) as BulkTrackingArticle[];
}
