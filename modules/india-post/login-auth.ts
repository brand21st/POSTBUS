export const INDIA_POST_LOGIN_OPERATION = "login" as const;
export const INDIA_POST_REFRESH_OPERATION = "refresh" as const;

export type IndiaPostLoginError = Error & {
  status?: number;
  code?: string;
  indiaPostOperation?: typeof INDIA_POST_LOGIN_OPERATION | typeof INDIA_POST_REFRESH_OPERATION;
};

const AUTH_FAILURE_PATTERNS = [
  /\bauthentication failed\b/i,
  /\binvalid credentials?\b/i,
  /\binvalid username\b/i,
  /\binvalid password\b/i,
];

export function hasConfirmedIndiaPostLoginAuthPhrase(message: string | null | undefined) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function createIndiaPostLoginError(status: number, message: string): IndiaPostLoginError {
  const error = new Error(message || "India Post authentication failed.") as IndiaPostLoginError;
  error.status = status;
  error.code = status === 401 ? "PERMANENT_AUTH_ERROR" : `HTTP_${status}`;
  error.indiaPostOperation = INDIA_POST_LOGIN_OPERATION;
  return error;
}

export function isIndiaPostLoginError(error: unknown): error is IndiaPostLoginError {
  const row = error as IndiaPostLoginError | null;
  return Boolean(row && row.indiaPostOperation === INDIA_POST_LOGIN_OPERATION);
}

/**
 * Confirmed permanent LOGIN authentication failure.
 * Bulk tracking HTTP 400/403/404 must not match: those errors are not tagged as login.
 */
export function isConfirmedIndiaPostLoginAuthFailure(error: unknown) {
  if (!isIndiaPostLoginError(error)) return false;
  if (error.status === 401 || error.code === "HTTP_401") return true;
  if (error.code === "PERMANENT_AUTH_ERROR" && (error.status === 401 || hasConfirmedIndiaPostLoginAuthPhrase(error.message))) {
    return true;
  }
  if ((error.status === 400 || error.code === "HTTP_400") && hasConfirmedIndiaPostLoginAuthPhrase(error.message)) {
    return true;
  }
  return false;
}

/** Durable job-row classifier. Does not log or return the raw message. */
export function isConfirmedTrackingAuthFailureJob(row: {
  last_error_code?: string | null;
  last_error?: string | null;
}) {
  const code = String(row.last_error_code ?? "").toUpperCase();
  const message = row.last_error ?? "";
  if (code === "HTTP_401") return true;
  if (code === "PERMANENT_AUTH_ERROR") {
    if (!message.trim()) return false;
    if (/\bnot connected\b/i.test(message)) return false;
    return hasConfirmedIndiaPostLoginAuthPhrase(message);
  }
  if (code === "HTTP_400") return hasConfirmedIndiaPostLoginAuthPhrase(message);
  return false;
}

export function tagTrackingLoginAuthFailure(error: unknown) {
  if (!isConfirmedIndiaPostLoginAuthFailure(error)) return error;
  const tagged = error as IndiaPostLoginError;
  tagged.code = "PERMANENT_AUTH_ERROR";
  tagged.indiaPostOperation = INDIA_POST_LOGIN_OPERATION;
  return tagged;
}

const REFRESH_FAILURE_PATTERNS = [/\binvalid refresh token\b/i, /\binvalid authorization header\b/i];

export function hasConfirmedIndiaPostRefreshAuthPhrase(message: string | null | undefined) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  return REFRESH_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function createIndiaPostRefreshError(status: number, message: string): IndiaPostLoginError {
  const error = new Error(message || "India Post refresh token was rejected.") as IndiaPostLoginError;
  error.status = status;
  error.code = status === 401 ? "PERMANENT_AUTH_ERROR" : `HTTP_${status}`;
  error.indiaPostOperation = INDIA_POST_REFRESH_OPERATION;
  return error;
}

export function isIndiaPostRefreshError(error: unknown): error is IndiaPostLoginError {
  const row = error as IndiaPostLoginError | null;
  return Boolean(row && row.indiaPostOperation === INDIA_POST_REFRESH_OPERATION);
}

/** Confirmed AUTH02 rejection. Tracking HTTP 403 entitlement must not match. */
export function isConfirmedIndiaPostRefreshAuthFailure(error: unknown) {
  if (!isIndiaPostRefreshError(error)) return false;
  if (error.status === 401 || error.code === "HTTP_401" || error.code === "PERMANENT_AUTH_ERROR") return true;
  if ((error.status === 400 || error.code === "HTTP_400") && hasConfirmedIndiaPostRefreshAuthPhrase(error.message)) {
    return true;
  }
  return false;
}
