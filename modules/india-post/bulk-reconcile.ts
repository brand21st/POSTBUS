import type { IndiaPostBulkArticleResult, IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";
import { classifyArticleError } from "@/modules/india-post/bulk-classify";

export type BulkArticleOutcome = {
  shipmentId: string;
  barcode?: string | null;
  result: IndiaPostBulkArticleResult;
  trackingNumber?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  generateLabel: boolean;
};

export type BulkReconcileInput = {
  expectedCount: number;
  shipmentIds: string[];
  membershipBarcodes?: Record<string, string | null | undefined>;
  ceptBatchId?: string | null;
  total?: number | null;
  processed?: number | null;
  validArticles?: Array<{ shipmentId?: string; barcode?: string; articleNumber?: string }>;
  errorArticles?: Array<{ shipmentId?: string; barcode?: string; code?: string; message?: string }>;
  httpOk: boolean;
  bodyComplete: boolean;
};

export type BulkReconcileResult = {
  batchStatus: IndiaPostBulkBatchStatus;
  articles: BulkArticleOutcome[];
  countMismatch: boolean;
};

export function reconcileBulkCeptResponse(input: BulkReconcileInput): BulkReconcileResult {
  if (!input.httpOk || !input.bodyComplete) {
    return recoveryAll(input.shipmentIds, "Incomplete or non-OK CEPT body.");
  }

  const valid = input.validArticles ?? [];
  const errors = input.errorArticles ?? [];
  const accounted = valid.length + errors.length;
  const total = input.total ?? accounted;
  const processed = input.processed ?? accounted;
  const countMismatch =
    total !== input.expectedCount ||
    processed !== input.expectedCount ||
    accounted !== input.expectedCount ||
    accounted !== input.shipmentIds.length;

  if (countMismatch) {
    return recoveryAll(input.shipmentIds, "CEPT counts do not match submitted membership.");
  }

  const membership = new Set(input.shipmentIds);
  const reportedIds = [...valid, ...errors].map((row) => row.shipmentId).filter(Boolean) as string[];
  if (reportedIds.some((id) => !membership.has(id))) {
    return recoveryAll(input.shipmentIds, "CEPT response contains an unknown shipment.");
  }

  const barcodes = [...valid, ...errors].map((row) => row.barcode).filter(Boolean) as string[];
  if (barcodes.length && new Set(barcodes).size !== barcodes.length) {
    return recoveryAll(input.shipmentIds, "CEPT response contains duplicate barcodes.");
  }

  if (
    input.ceptBatchId &&
    valid.some((row) => row.articleNumber && row.articleNumber === input.ceptBatchId)
  ) {
    return recoveryAll(input.shipmentIds, "Article tracking number must not equal CEPT batch_id.");
  }

  const byId = new Map<string, BulkArticleOutcome>();
  for (const article of valid) {
    const shipmentId = article.shipmentId;
    if (!shipmentId) continue;
    byId.set(shipmentId, {
      shipmentId,
      barcode: article.barcode,
      result: "SUCCEEDED",
      trackingNumber: article.articleNumber ?? article.barcode ?? null,
      generateLabel: true,
    });
  }
  for (const article of errors) {
    const shipmentId = article.shipmentId;
    if (!shipmentId) continue;
    const classified = classifyArticleError(article.code);
    byId.set(shipmentId, {
      shipmentId,
      barcode: article.barcode,
      result: classified.class === "NON_RETRYABLE" ? "FAILED" : "FAILED",
      errorCode: article.code ?? classified.class,
      errorMessage: article.message ?? classified.reason,
      generateLabel: false,
    });
  }

  const missing = input.shipmentIds.filter((id) => !byId.has(id));
  if (missing.length) {
    return recoveryAll(input.shipmentIds, "Membership article missing from CEPT response.");
  }

  if (input.membershipBarcodes) {
    for (const article of byId.values()) {
      const expected = input.membershipBarcodes[article.shipmentId];
      if (expected && article.barcode && article.barcode !== expected) {
        return recoveryAll(input.shipmentIds, "CEPT barcode does not match reserved membership barcode.");
      }
    }
  }

  const articles = input.shipmentIds.map((id) => byId.get(id)!);
  const succeeded = articles.filter((row) => row.result === "SUCCEEDED").length;
  const failed = articles.filter((row) => row.result === "FAILED").length;
  let batchStatus: IndiaPostBulkBatchStatus = "FAILED";
  if (succeeded === articles.length) batchStatus = "SUCCEEDED";
  else if (succeeded > 0 && failed > 0) batchStatus = "PARTIAL_SUCCESS";

  return { batchStatus, articles, countMismatch: false };
}

export function labelsForSuccessfulArticlesOnly(articles: BulkArticleOutcome[]) {
  return articles.filter((row) => row.generateLabel && row.result === "SUCCEEDED");
}

export function succeededArticlesMustNotRetry(articles: BulkArticleOutcome[]) {
  return articles.filter((row) => row.result === "SUCCEEDED").map((row) => row.shipmentId);
}

function recoveryAll(shipmentIds: string[], message: string): BulkReconcileResult {
  return {
    batchStatus: "RECOVERY_REQUIRED",
    countMismatch: true,
    articles: shipmentIds.map((shipmentId) => ({
      shipmentId,
      result: "RECOVERY_REQUIRED" as const,
      errorMessage: message,
      generateLabel: false,
    })),
  };
}
