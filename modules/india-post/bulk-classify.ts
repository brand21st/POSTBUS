import { canRetryCeptPostAfterUnknown } from "@/modules/india-post/booking-idempotency";

export type BulkErrorClass =
  | "NON_RETRYABLE"
  | "RETRYABLE"
  | "RECOVERY_REQUIRED";

export type ClassifiedBulkOutcome = {
  class: BulkErrorClass;
  reason: string;
  httpStatus?: number;
};

export function classifyBulkHttpOutcome(input: {
  httpStatus?: number | null;
  timedOut?: boolean;
  networkError?: boolean;
  malformedResponse?: boolean;
  unknownResponse?: boolean;
  emptyResponse?: boolean;
  invalidJson?: boolean;
  duplicateBatch?: boolean;
  batchLeftReady?: boolean;
}): ClassifiedBulkOutcome {
  if (input.timedOut || input.networkError || input.emptyResponse || input.invalidJson) {
    return {
      class: "RECOVERY_REQUIRED",
      reason: "CEPT may have received the bulk POST; never resubmit the batch.",
    };
  }
  if (input.malformedResponse || input.unknownResponse) {
    return {
      class: "RECOVERY_REQUIRED",
      reason: "Response cannot prove which articles were booked.",
    };
  }
  const status = input.httpStatus ?? 0;
  if (status === 200) {
    return {
      class: "NON_RETRYABLE",
      reason: "HTTP 200 is reconciled per article; never POST the batch again.",
      httpStatus: 200,
    };
  }
  if (status === 409) {
    return {
      class: "RECOVERY_REQUIRED",
      reason: "HTTP 409 does not prove unused membership; H4 forbids a second POST.",
      httpStatus: 409,
    };
  }
  if (status === 429) {
    if (input.batchLeftReady) {
      return {
        class: "RECOVERY_REQUIRED",
        reason: "HTTP 429 after leaving READY is ambiguous; do not POST again.",
        httpStatus: 429,
      };
    }
    return {
      class: "RETRYABLE",
      reason: "Rate limited before a booking proof; retry only if the batch never left READY.",
      httpStatus: 429,
    };
  }
  if (status >= 500) {
    return {
      class: "RECOVERY_REQUIRED",
      reason: "5xx after POST is ambiguous for multi-article booking.",
      httpStatus: status,
    };
  }
  if (status === 401 || status === 403) {
    return {
      class: "NON_RETRYABLE",
      reason: "Authentication/session failure; do not POST again until credentials are fixed.",
      httpStatus: status,
    };
  }
  if (status >= 400) {
    return {
      class: "NON_RETRYABLE",
      reason: "Client/validation error at batch level.",
      httpStatus: status,
    };
  }
  if (input.duplicateBatch) {
    return { class: "NON_RETRYABLE", reason: "Duplicate membership blocked before POST." };
  }
  return { class: "RETRYABLE", reason: "No CEPT post occurred." };
}

export function classifyArticleError(code: string | null | undefined): ClassifiedBulkOutcome {
  const normalized = (code || "").toUpperCase();
  if (normalized.includes("VALIDATION") || normalized.includes("TARIFF") || normalized.includes("CONTRACT")) {
    return { class: "NON_RETRYABLE", reason: "Article-level validation/contract/tariff error." };
  }
  if (normalized.includes("DUPLICATE")) {
    return { class: "NON_RETRYABLE", reason: "Duplicate article reported by CEPT." };
  }
  if (normalized.includes("AUTH") || normalized.includes("SESSION")) {
    return { class: "NON_RETRYABLE", reason: "Session/auth failed for this article." };
  }
  return { class: "RETRYABLE", reason: "Article failed without booking proof; individual retry may be allowed." };
}

export function bulkCanRetryCeptPost(batchAlreadyPosted: boolean) {
  if (batchAlreadyPosted) return canRetryCeptPostAfterUnknown();
  return true;
}
