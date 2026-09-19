export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
] as const;

export const MAX_ATTEMPTS = 5;

const RETRYABLE_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "RATE_LIMITED",
  "HTTP_429",
  "HTTP_500",
  "HTTP_502",
  "HTTP_503",
  "HTTP_504",
  "TEMPORARY_PROVIDER_FAILURE",
]);

const PERMANENT_CODES = new Set([
  "INVALID_PINCODE",
  "INVALID_ADDRESS",
  "INVALID_WEIGHT",
  "INVALID_DIMENSIONS",
  "MISSING_MANDATORY_FIELD",
  "INVALID_BARCODE",
  "INVALID_CONTRACT",
  "PERMANENT_AUTH_ERROR",
  "VALIDATION_ERROR",
]);

export type ClassifiedError = {
  retryable: boolean;
  code: string;
  message: string;
};

export function classifyProviderError(error: unknown): ClassifiedError {
  const anyError = error as {
    code?: string;
    status?: number;
    message?: string;
    name?: string;
  };
  const message = anyError?.message || "Provider request failed.";
  const code = anyError?.code || (anyError?.status ? `HTTP_${anyError.status}` : "PROVIDER_ERROR");

  if (PERMANENT_CODES.has(code)) {
    return { retryable: false, code, message };
  }

  if (typeof anyError?.status === "number") {
    if (anyError.status === 429 || anyError.status >= 500) {
      return { retryable: true, code: `HTTP_${anyError.status}`, message };
    }
    if (anyError.status >= 400 && anyError.status < 500) {
      return { retryable: false, code: `HTTP_${anyError.status}`, message };
    }
  }

  if (RETRYABLE_CODES.has(code) || /timeout|temporar|network|econn/i.test(message)) {
    return { retryable: true, code, message };
  }

  return { retryable: false, code, message };
}

export function delayForAttempt(attemptCount: number) {
  const index = Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1);
  const base = RETRY_DELAYS_MS[index];
  const jitter = Math.floor(Math.random() * 15_000);
  return base + jitter;
}
