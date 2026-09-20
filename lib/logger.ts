import { randomUUID } from "crypto";

export function createRequestId(): string {
  return randomUUID();
}

const SECRET_KEYS = [
  "password",
  "secret",
  "token",
  "authorization",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "id_token",
  "credential",
  "webhook_secret",
];

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret))
        ? "[redacted]"
        : redact(inner);
    }
    return output;
  }
  return value;
}

export function logInfo(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ level: "info", event, fields: redact(fields) }));
}

export function logError(event: string, fields: Record<string, unknown>) {
  console.error(JSON.stringify({ level: "error", event, fields: redact(fields) }));
}
