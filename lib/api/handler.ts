import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { createRequestId, logError, logInfo } from "@/lib/logger";

type Handler = (request: NextRequest) => Promise<unknown>;
type ContextHandler<T> = (
  request: NextRequest,
  context: { params: Promise<T> }
) => Promise<unknown>;

async function runHandler(request: NextRequest, handler: () => Promise<unknown>) {
  const requestId = createRequestId();
  const started = Date.now();
  try {
    const result = await handler();
    logInfo("api.request", {
      requestId,
      path: request.nextUrl.pathname,
      method: request.method,
      latency: Date.now() - started,
    });
    if (result instanceof Response) return result;
    return ok(result, "OK", requestId);
  } catch (error) {
    logError("api.error", {
      requestId,
      path: request.nextUrl.pathname,
      message: error instanceof Error ? error.message : "unknown",
    });
    return fail(error, requestId);
  }
}

export function apiRoute(handler: Handler) {
  return async (request: NextRequest) => runHandler(request, () => handler(request));
}

export function apiRouteWithContext<T>(handler: ContextHandler<T>) {
  return async (request: NextRequest, context: { params: Promise<T> }) =>
    runHandler(request, () => handler(request, context));
}
