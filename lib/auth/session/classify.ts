export type AuthSessionClass =
  | "AUTH_VALID"
  | "AUTH_SESSION_MISSING"
  | "AUTH_SESSION_INVALID"
  | "AUTH_RATE_LIMITED"
  | "AUTH_TRANSIENT_FAILURE"
  | "AUTH_UNKNOWN_FAILURE";

export type AuthErrorLike = {
  code?: string | null;
  status?: number | null;
  name?: string | null;
  message?: string | null;
} | null;

const INVALID_CODES = new Set([
  "refresh_token_not_found",
  "session_not_found",
  "user_not_found",
  "session_expired",
]);

export function shouldRedirectToLogin(classification: AuthSessionClass) {
  return classification === "AUTH_SESSION_MISSING" || classification === "AUTH_SESSION_INVALID";
}

export function isTransientAuthClass(classification: AuthSessionClass) {
  return classification === "AUTH_TRANSIENT_FAILURE" || classification === "AUTH_RATE_LIMITED";
}

export function classifyAuthSession(input: {
  user?: { id: string } | null;
  error?: AuthErrorLike;
  hasAuthCookie: boolean;
}): AuthSessionClass {
  if (input.user?.id) return "AUTH_VALID";

  const code = input.error?.code ?? "";
  const status = input.error?.status ?? undefined;
  const name = input.error?.name ?? "";

  if (code === "over_request_rate_limit" || status === 429) return "AUTH_RATE_LIMITED";
  if (code === "refresh_token_already_used") return "AUTH_TRANSIENT_FAILURE";
  if (INVALID_CODES.has(code)) return "AUTH_SESSION_INVALID";
  if (name === "AuthRetryableFetchError" || status === 500 || status === 502 || status === 503 || status === 504) {
    return "AUTH_TRANSIENT_FAILURE";
  }
  if (name === "AuthSessionMissingError") {
    return input.hasAuthCookie ? "AUTH_TRANSIENT_FAILURE" : "AUTH_SESSION_MISSING";
  }
  if (!input.error) {
    return input.hasAuthCookie ? "AUTH_TRANSIENT_FAILURE" : "AUTH_SESSION_MISSING";
  }
  if (input.hasAuthCookie) return "AUTH_TRANSIENT_FAILURE";
  if (status && status >= 500) return "AUTH_TRANSIENT_FAILURE";
  return "AUTH_SESSION_MISSING";
}
