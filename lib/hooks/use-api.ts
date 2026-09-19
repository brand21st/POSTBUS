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

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(
      response.ok ? "Unexpected empty response." : "The server returned an unexpected response.",
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
