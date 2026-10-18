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

function ipv6ToBigInt(ip: string) {
  const value = ip.trim().toLowerCase();
  if (!value.includes(":") || value.includes(".")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const expand = (part: string) => (part ? part.split(":").filter(Boolean) : []);
  const left = expand(halves[0] ?? "");
  const right = halves.length === 2 ? expand(halves[1] ?? "") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  if (left.length + right.length > 8) return null;
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  let out = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    out = (out << BigInt(16)) + BigInt(Number.parseInt(group, 16));
  }
  return out;
}

function prefixMatches(addr: bigint, base: bigint, bits: number, width: number) {
  if (!Number.isInteger(bits) || bits <= 0 || bits > width) return false;
  const shift = BigInt(width - bits);
  return addr >> shift === base >> shift;
}

export function ipMatchesCidrs(ip: string, cidrs: string[]) {
  const v4 = ipv4ToInt(ip);
  const v6 = v4 == null ? ipv6ToBigInt(ip) : null;
  if (v4 == null && v6 == null) return false;
  for (const cidr of cidrs) {
    const [baseRaw, bitsRaw] = cidr.includes("/") ? cidr.split("/") : [cidr, v6 != null ? "128" : "32"];
    const bits = Number(bitsRaw);
    if (v4 != null) {
      const base = ipv4ToInt(baseRaw.trim());
      if (base == null) continue;
      if (prefixMatches(BigInt(v4), BigInt(base), bits, 32)) return true;
      continue;
    }
    const base = ipv6ToBigInt(baseRaw.trim());
    if (base == null || v6 == null) continue;
    if (prefixMatches(v6, base, bits, 128)) return true;
  }
  return false;
}

/**
 * Cloudflare's connecting-IP header is the visitor address when the request
 * actually passed through Cloudflare. X-Forwarded-For is client-controlled
 * until a trusted proxy overwrites it, so it is never the allowlist source.
 * X-Real-IP is used only when Cloudflare did not supply an address; the
 * origin must be reachable only from that proxy.
 */
export function webhookSourceIp(headers: Headers) {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return headers.get("x-real-ip")?.trim() || null;
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
