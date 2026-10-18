import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { MERCHANT_API_VERSION } from "@/modules/merchant-api/scopes";
import { MERCHANT_ERROR_CODES, MerchantApiError } from "@/modules/merchant-api/errors";

export function merchantOk<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: { request_id: requestId, api_version: MERCHANT_API_VERSION },
    },
    { status }
  );
}

export function merchantFail(error: unknown, requestId: string) {
  if (error instanceof MerchantApiError) {
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds != null) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        meta: { request_id: requestId, api_version: MERCHANT_API_VERSION },
      },
      { status: error.status, headers }
    );
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || undefined,
      message: issue.message,
    }));
    return NextResponse.json(
      {
        success: false,
        error: {
          code: MERCHANT_ERROR_CODES.VALIDATION_ERROR,
          message: "Request validation failed",
          details,
        },
        meta: { request_id: requestId, api_version: MERCHANT_API_VERSION },
      },
      { status: 422 }
    );
  }

  if (error instanceof AppError) {
    const mapped = mapAppError(error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
          details: mapped.details,
        },
        meta: { request_id: requestId, api_version: MERCHANT_API_VERSION },
      },
      { status: mapped.status }
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: MERCHANT_ERROR_CODES.INTERNAL_ERROR,
        message: "An unexpected error occurred.",
        details: [],
      },
      meta: { request_id: requestId, api_version: MERCHANT_API_VERSION },
    },
    { status: 500 }
  );
}

function looksLikeDatabaseMessage(message: string) {
  return /duplicate key|violates|permission denied|column|relation|syntax error|postgres/i.test(message);
}

function mapAppError(error: AppError) {
  if (error.code === ERROR_CODES.RESOURCE_NOT_FOUND) {
    return { code: MERCHANT_ERROR_CODES.RESOURCE_NOT_FOUND, message: "Resource not found.", details: [], status: 404 };
  }
  if (error.code === ERROR_CODES.RATE_LIMITED) {
    return {
      code: MERCHANT_ERROR_CODES.RATE_LIMIT_EXCEEDED,
      message: "Rate limit exceeded.",
      details: [],
      status: 429,
    };
  }
  if (error.code === ERROR_CODES.CONFLICT) {
    const booking = /book|shipment|WhatsApp|Shopify payment/i.test(error.message);
    return {
      code: booking ? MERCHANT_ERROR_CODES.BOOKING_NOT_ALLOWED : MERCHANT_ERROR_CODES.DUPLICATE_ORDER,
      message: booking ? error.message : "This request conflicts with an existing resource.",
      details: [],
      status: 409,
    };
  }
  if (error.code === ERROR_CODES.INTEGRATION_NOT_CONNECTED || error.code === ERROR_CODES.PROVIDER_ERROR) {
    return {
      code: MERCHANT_ERROR_CODES.UPSTREAM_SERVICE_UNAVAILABLE,
      message: "The upstream shipping service is unavailable.",
      details: [],
      status: 503,
    };
  }
  if (error.code === ERROR_CODES.VALIDATION_ERROR || error.code === ERROR_CODES.SHIPMENT_FAILED) {
    const message = looksLikeDatabaseMessage(error.message) ? "Request validation failed" : error.message;
    return {
      code: MERCHANT_ERROR_CODES.VALIDATION_ERROR,
      message,
      details: [],
      status: 422,
    };
  }
  return {
    code: MERCHANT_ERROR_CODES.INTERNAL_ERROR,
    message: "An unexpected error occurred.",
    details: [],
    status: 500,
  };
}
