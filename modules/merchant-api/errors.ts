export const MERCHANT_ERROR_CODES = {
  INVALID_API_KEY: "INVALID_API_KEY",
  API_KEY_REVOKED: "API_KEY_REVOKED",
  API_KEY_EXPIRED: "API_KEY_EXPIRED",
  INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE",
  MERCHANT_API_DISABLED: "MERCHANT_API_DISABLED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  DUPLICATE_ORDER: "DUPLICATE_ORDER",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  BOOKING_NOT_ALLOWED: "BOOKING_NOT_ALLOWED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  UPSTREAM_SERVICE_UNAVAILABLE: "UPSTREAM_SERVICE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type MerchantErrorCode = (typeof MERCHANT_ERROR_CODES)[keyof typeof MERCHANT_ERROR_CODES];

const STATUS_BY_CODE: Record<MerchantErrorCode, number> = {
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  API_KEY_EXPIRED: 401,
  INSUFFICIENT_SCOPE: 403,
  MERCHANT_API_DISABLED: 403,
  RESOURCE_NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  DUPLICATE_ORDER: 409,
  IDEMPOTENCY_CONFLICT: 409,
  BOOKING_NOT_ALLOWED: 409,
  RATE_LIMIT_EXCEEDED: 429,
  UPSTREAM_SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export type MerchantErrorDetail = { field?: string; message: string };

export class MerchantApiError extends Error {
  code: MerchantErrorCode;
  status: number;
  details: MerchantErrorDetail[];
  retryAfterSeconds?: number;

  constructor(
    code: MerchantErrorCode,
    message: string,
    details: MerchantErrorDetail[] = [],
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "MerchantApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
