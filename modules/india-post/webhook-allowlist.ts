import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";

export function parseCidrList(raw: string) {
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function ipv4ToInt(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

export function ipMatchesCidrs(ip: string, cidrs: string[]) {
  const addr = ipv4ToInt(ip);
  if (addr == null) return false;
  for (const cidr of cidrs) {
    const [base, bitsRaw] = cidr.includes("/") ? cidr.split("/") : [cidr, "32"];
    const baseInt = ipv4ToInt(base.trim());
    const bits = Number(bitsRaw);
    if (baseInt == null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
    if ((addr & mask) === (baseInt & mask)) return true;
  }
  return false;
}

export function webhookSourceIp(headers: Headers) {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}

export function currentIndiaPostWebhookAllowlist() {
  return parseCidrList(process.env.INDIA_POST_WEBHOOK_ALLOWED_CIDRS ?? env.indiaPostWebhookAllowedCidrs ?? "");
}

/** Empty CIDR list quarantines ingestion. Do not treat emptiness as authorization. */
export function isIndiaPostWebhookQuarantined(allowlist?: string) {
  const cidrs = allowlist == null ? currentIndiaPostWebhookAllowlist() : parseCidrList(allowlist);
  return cidrs.length === 0;
}

export function assertIndiaPostWebhookSourceAllowed(
  ip: string | null,
  allowlist?: string
) {
  const cidrs = allowlist == null ? currentIndiaPostWebhookAllowlist() : parseCidrList(allowlist);
  if (!cidrs.length) return;
  if (!ip || !ipMatchesCidrs(ip, cidrs)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Webhook source is not allowed.");
  }
}
