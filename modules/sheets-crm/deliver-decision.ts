const ALLOWED_HOSTS = new Set(["script.google.com", "script.googleusercontent.com"]);

export function assertSheetsWebAppUrl(value: string) {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid Google Apps Script Web App URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("The Apps Script Web App URL must use HTTPS.");
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("The Web App URL must be a script.google.com address.");
  }
  if (url.username || url.password) {
    throw new Error("The Web App URL cannot include credentials.");
  }
  return url.toString();
}

export type AppsScriptError = { eventId?: string; message?: string; code?: string };
export type AppsScriptResponse = {
  ok?: boolean;
  code?: string;
  processed?: string[];
  duplicates?: string[];
  errors?: AppsScriptError[];
};

export type DeliveryDecision = {
  status: "SUCCEEDED" | "FAILED" | "DEAD";
  error: string | null;
};

export function deliveryDecision(
  attempt: number,
  maxAttempts: number,
  httpStatus: number,
  body: AppsScriptResponse | null,
  eventId: string
): DeliveryDecision {
  if (httpStatus === 401 || body?.code === "unauthorized" || body?.code === "malformed") {
    const message = body?.code === "malformed" ? "Apps Script rejected the payload." : "Apps Script rejected the secret.";
    return { status: "DEAD", error: message };
  }
  if (httpStatus >= 500 || httpStatus === 429 || httpStatus === 0) {
    return {
      status: attempt >= maxAttempts ? "DEAD" : "FAILED",
      error: httpStatus === 0 ? "Apps Script did not respond." : `Apps Script returned HTTP ${httpStatus}.`,
    };
  }
  if (!body || body.ok === false && !body.errors && !body.processed) {
    return {
      status: attempt >= maxAttempts ? "DEAD" : "FAILED",
      error: "Apps Script returned an unexpected response.",
    };
  }
  const processed = new Set(body.processed ?? []);
  const duplicates = new Set(body.duplicates ?? []);
  if (processed.has(eventId) || duplicates.has(eventId)) return { status: "SUCCEEDED", error: null };
  const failure = (body.errors ?? []).find((item) => item.eventId === eventId);
  if (failure) {
    const permanent = failure.code === "unauthorized" || failure.code === "malformed";
    return {
      status: permanent || attempt >= maxAttempts ? "DEAD" : "FAILED",
      error: (failure.message || "Apps Script could not write this row.").slice(0, 300),
    };
  }
  return {
    status: attempt >= maxAttempts ? "DEAD" : "FAILED",
    error: "Apps Script did not confirm this event.",
  };
}
