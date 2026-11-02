import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { publicAppOrigin, requestPublicOrigin } from "@/lib/auth/urls";

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

function allowedOrigins(request: NextRequest) {
  return [request.nextUrl.origin, requestPublicOrigin(request), publicAppOrigin()];
}

function isSameSiteFetch(request: NextRequest) {
  const site = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();
  return site === "same-origin" || site === "same-site";
}

const CSRF_MESSAGE = "This request must come from the PostBus app.";

/** Cookie-authenticated mutations must match this request origin. */
export function assertBrowserOrigin(request: NextRequest, required: boolean) {
  const sent = request.headers.get("origin");
  if (!sent) {
    if (required) throw new AppError(ERROR_CODES.FORBIDDEN, CSRF_MESSAGE);
    return;
  }
  if (allowedOrigins(request).some((expected) => originsMatch(sent, expected))) return;
  if (isSameSiteFetch(request)) return;
  throw new AppError(ERROR_CODES.FORBIDDEN, CSRF_MESSAGE);
}
