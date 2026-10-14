export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T | null;
  errors: unknown[];
  requestId: string;
  timestamp: string;
};

export class ApiError extends Error {
  status: number;
  errors: unknown[];
  requestId?: string;

  constructor(message: string, status: number, errors: unknown[] = [], requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.requestId = requestId;
  }

  get code(): string | null {
    const first = this.errors[0];
    if (first && typeof first === "object" && first !== null && "code" in first) {
      const value = (first as { code?: unknown }).code;
      return typeof value === "string" ? value : null;
    }
    return null;
  }
}

export function isConfirmedSessionLoss(error: unknown) {
  return error instanceof ApiError && error.status === 401 && error.code === "AUTH_REQUIRED";
}

export function isTransientApiAuthError(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  return (
    error.status === 503 ||
    error.status === 429 ||
    error.code === "AUTH_UNAVAILABLE" ||
    error.code === "RATE_LIMITED" ||
    error.code === "PROFILE_UNAVAILABLE"
  );
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  const raw = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = raw ? (JSON.parse(raw) as ApiEnvelope<T>) : null;
  } catch {
    throw new ApiError(
      response.ok
        ? "Unexpected empty response."
        : `The server returned an unexpected response (${response.status}).`,
      response.status
    );
  }
  if (!payload) {
    throw new ApiError(
      response.ok ? "Unexpected empty response." : `The server returned an unexpected response (${response.status}).`,
      response.status
    );
  }

  if (!payload.success) {
    throw new ApiError(
      payload.message || "Request failed.",
      response.status,
      payload.errors ?? [],
      payload.requestId
    );
  }

  return payload.data as T;
}

export function toSearchParams(
  values: Record<string, string | number | boolean | undefined | null>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}
