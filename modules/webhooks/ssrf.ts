import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type DnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "metadata",
  "instance-data",
]);

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookUrlError";
  }
}

export function isBlockedIp(address: string) {
  const raw = address.trim().toLowerCase();
  if (!raw) return true;
  if (raw === "::1" || raw === "::" || raw === "0.0.0.0") return true;
  const mapped = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (isIP(mapped) === 4) {
    const parts = mapped.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (raw.startsWith("fe80:") || raw.startsWith("fc") || raw.startsWith("fd")) return true;
  if (raw.startsWith("::ffff:")) return isBlockedIp(mapped);
  return false;
}

export async function defaultDnsLookup(hostname: string): Promise<ResolvedAddress[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
}

export async function assertPublicHttpsUrl(raw: string, resolve: DnsLookup = defaultDnsLookup) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebhookUrlError("Webhook URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new WebhookUrlError("Webhook URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new WebhookUrlError("Webhook URL cannot include credentials.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".localhost")) {
    throw new WebhookUrlError("Webhook URL host is not allowed.");
  }
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new WebhookUrlError("Webhook URL must not target a private or loopback address.");
    return { url, addresses: [{ address: hostname, family: (isIP(hostname) === 6 ? 6 : 4) as 4 | 6 }] };
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new WebhookUrlError("Webhook URL host could not be resolved.");
  }
  if (!addresses.length || addresses.some((record) => isBlockedIp(record.address))) {
    throw new WebhookUrlError("Webhook URL resolves to a blocked address.");
  }
  return { url, addresses };
}
