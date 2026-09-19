import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { createRequestId, logError, logInfo } from "@/lib/logger";

type Handler = (request: NextRequest) => Promise<unknown>;

export function apiRoute(handler: Handler) {
  return async (request: NextRequest) => {
    const requestId = createRequestId();
    const started = Date.now();
    try {
      const result = await handler(request);
      logInfo("api.request", {
        requestId,
        path: request.nextUrl.pathname,
        method: request.method,
        latency: Date.now() - started,
      });
      if (result instanceof NextResponse) return result;
      return ok(result, "OK", requestId);
    } catch (error) {
      logError("api.error", {
        requestId,
        path: request.nextUrl.pathname,
        message: error instanceof Error ? error.message : "unknown",
      });
      return fail(error, requestId);
    }
  };
}
