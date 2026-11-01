const SECRET_KEY = /(token|password|passwd|secret|authorization|bearer|id_token|refresh_token|access_token)/i;

export function maskSecret(value: unknown) {
  if (value == null) return null;
  const text = String(value);
  if (!text) return "";
  if (text.length <= 8) return `[REDACTED len=${text.length}]`;
  return `[REDACTED len=${text.length} prefix=${text.slice(0, 4)}]`;
}

export function tokenPresence(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? "GENERATED" : "MISSING";
}

export function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeJson(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? maskSecret(nested) : sanitizeJson(nested, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 400) return `${value.slice(0, 400)}…`;
  return value;
}

export function firstText(...values: unknown[]) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}
