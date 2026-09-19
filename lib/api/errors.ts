export const ERROR_CODES = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  TENANT_ACCESS_DENIED: "TENANT_ACCESS_DENIED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  INTEGRATION_NOT_CONNECTED: "INTEGRATION_NOT_CONNECTED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  JOB_FAILED: "JOB_FAILED",
  SHIPMENT_FAILED: "SHIPMENT_FAILED",
  LABEL_GENERATION_FAILED: "LABEL_GENERATION_FAILED",
  CONFLICT: "CONFLICT",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  TENANT_ACCESS_DENIED: 403,
  VALIDATION_ERROR: 422,
  RESOURCE_NOT_FOUND: 404,
  INTEGRATION_NOT_CONNECTED: 409,
  PROVIDER_ERROR: 502,
  RATE_LIMITED: 429,
  JOB_FAILED: 500,
  SHIPMENT_FAILED: 422,
  LABEL_GENERATION_FAILED: 500,
  CONFLICT: 409,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
