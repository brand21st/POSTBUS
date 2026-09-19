import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createRequestId } from "@/lib/logger";

export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T | null;
  errors: unknown[];
  requestId: string;
  timestamp: string;
};

export function ok<T>(data: T, message = "OK", requestId: string = createRequestId()) {
  const body: ApiEnvelope<T> = {
    success: true,
    message,
    data,
    errors: [],
    requestId,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body);
}

export function fail(
  error: unknown,
  requestId: string = createRequestId(),
  fallbackMessage = "Something went wrong."
) {
  if (error instanceof AppError) {
    const body: ApiEnvelope<null> = {
      success: false,
      message: error.message,
      data: null,
      errors: [
        {
          code: error.code,
          details: error.details ?? null,
        },
      ],
      requestId,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: error.status });
  }

  if (error instanceof ZodError) {
    const body: ApiEnvelope<null> = {
      success: false,
      message: "Please check the highlighted fields.",
      data: null,
      errors: [
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          details: error.flatten(),
        },
      ],
      requestId,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: 422 });
  }

  const body: ApiEnvelope<null> = {
    success: false,
    message: fallbackMessage,
    data: null,
    errors: [{ code: "INTERNAL_ERROR" }],
    requestId,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: 500 });
}
