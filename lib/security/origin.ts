import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

function isLoopback(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Browser Origin matches this request, including localhost and 127.0.0.1 on the same port. */
export function originsMatch(sent: string | null, expected: string) {
  if (!sent || sent === "null") return false;
  if (sent === expected) return true;
  try {
    const actual = new URL(sent);
    const allowed = new URL(expected);
    return actual.protocol === allowed.protocol && actual.port === allowed.port && isLoopback(actual.hostname) && isLoopback(allowed.hostname);
  } catch {
    return false;
  }
}

const CSRF_MESSAGE = "This request must come from the PostBus app.";

/** Cookie-authenticated mutations must match this request origin. */
export function assertBrowserOrigin(request: NextRequest, required: boolean) {
  const sent = request.headers.get("origin");
  if (!sent) {
    if (required) throw new AppError(ERROR_CODES.FORBIDDEN, CSRF_MESSAGE);
    return;
  }
  if (!originsMatch(sent, request.nextUrl.origin)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, CSRF_MESSAGE);
  }
}
