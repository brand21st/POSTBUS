import { createHmac, timingSafeEqual } from "crypto";

/**
 * Vachat outbound webhooks: X-Wacrm-Signature: t=<unix>,v1=<hex>
 * signed over `${t}.${rawBody}`.
 */
export function verifyVachatSignature(
  header: string,
  rawBody: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
) {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1)];
    })
  );
  const t = Number(parts.t);
  const v1 = typeof parts.v1 === "string" ? parts.v1.trim().toLowerCase() : "";
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}

export function parseVachatBaseUrl(raw: unknown) {
  if (typeof raw !== "string" || !raw.trim()) {
    return "https://cloud.vachat.in";
  }
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") throw new Error("https required");
    return url.origin;
  } catch {
    throw new Error("Vachat base URL must be a valid https:// origin.");
  }
}
