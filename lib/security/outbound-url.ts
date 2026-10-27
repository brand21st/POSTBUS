import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google",
]);

export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true;
}

function ipv4ToInt(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function inCidr(ip: string, base: string, bits: number) {
  const left = ipv4ToInt(ip);
  const right = ipv4ToInt(base);
  if (left == null || right == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (left & mask) === (right & mask);
}

function isBlockedIpv4(ip: string) {
  return (
    inCidr(ip, "0.0.0.0", 8) ||
    inCidr(ip, "10.0.0.0", 8) ||
    inCidr(ip, "127.0.0.0", 8) ||
    inCidr(ip, "169.254.0.0", 16) ||
    inCidr(ip, "172.16.0.0", 12) ||
    inCidr(ip, "192.168.0.0", 16) ||
    inCidr(ip, "100.64.0.0", 10) ||
    inCidr(ip, "192.0.0.0", 24) ||
    inCidr(ip, "192.0.2.0", 24) ||
    inCidr(ip, "198.51.100.0", 24) ||
    inCidr(ip, "203.0.113.0", 24) ||
    inCidr(ip, "224.0.0.0", 4) ||
    inCidr(ip, "240.0.0.0", 4)
  );
}

function isBlockedIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;
  return false;
}

export function parsePublicStoreUrl(raw: string) {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid WooCommerce store URL.");
  }
  if (url.protocol !== "https:") {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "Use the public HTTPS address of your WooCommerce store."
    );
  }
  if (url.username || url.password) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid WooCommerce store URL.");
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "That store address cannot be used. Use the public HTTPS URL of your WooCommerce store."
    );
  }
  if (isIP(host) && isBlockedIp(host)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "That store address cannot be used. Use the public HTTPS URL of your WooCommerce store."
    );
  }
  url.hostname = host;
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path || "/";
  return url;
}

export function storeHostOf(url: URL) {
  return url.host.toLowerCase();
}

export function storeOriginOf(url: URL) {
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}${path}`;
}

export async function assertPublicHttpsUrl(raw: string) {
  const url = parsePublicStoreUrl(raw);
  if (isIP(url.hostname)) {
    if (isBlockedIp(url.hostname)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        "That store address cannot be used. Use the public HTTPS URL of your WooCommerce store."
      );
    }
    return { url, addresses: [url.hostname] };
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "PostBus could not reach that store address. Check the URL and try again."
    );
  }
  if (!records.length) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "PostBus could not reach that store address. Check the URL and try again."
    );
  }
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        "That store address cannot be used. Use the public HTTPS URL of your WooCommerce store."
      );
    }
  }
  return { url, addresses: records.map((record) => record.address) };
}

export type SafeHttpResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

const MAX_REDIRECTS = 3;
const MAX_BODY = 2_000_000;

export function nextStoreRedirect(current: URL, location: string) {
  const next = new URL(location, current);
  if (next.protocol !== "https:" || next.host !== current.host) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "That store address cannot be used. Use the public HTTPS URL of your WooCommerce store."
    );
  }
  return next;
}

export async function safeHttpsRequest(
  rawUrl: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
  redirects = 0
): Promise<SafeHttpResult> {
  if (redirects > MAX_REDIRECTS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The store redirected too many times.");
  }
  const checked = await assertPublicHttpsUrl(rawUrl);
  const method = (init.method ?? "GET").toUpperCase();
  const result = await requestPinned(checked.url, checked.addresses, {
    method,
    headers: init.headers,
    body: method === "GET" || method === "HEAD" ? undefined : init.body,
  });
  if (result.status >= 300 && result.status < 400) {
    const location = result.headers.location;
    if (!location) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The store returned a redirect without a destination.");
    }
    const next = nextStoreRedirect(checked.url, location);
    return safeHttpsRequest(next.toString(), { method: "GET" }, redirects + 1);
  }
  return result;
}

function requestPinned(
  url: URL,
  addresses: string[],
  init: { method: string; headers?: Record<string, string>; body?: string }
) {
  const pin = addresses[0];
  const family = isIP(pin) === 6 ? 6 : 4;
  return new Promise<SafeHttpResult>((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        servername: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: init.method,
        headers: init.headers,
        lookup: (_hostname, _options, callback) => {
          callback(null, pin, family);
        },
      },
      (response: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            response.destroy();
            reject(new AppError(ERROR_CODES.VALIDATION_ERROR, "The store response was too large."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (value == null) continue;
            headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    request.setTimeout(20_000, () => {
      request.destroy();
      reject(Object.assign(new Error("The store did not respond in time."), { code: "ETIMEDOUT" }));
    });
    request.on("error", (error) => {
      reject(error);
    });
    if (init.body) request.write(init.body);
    request.end();
  });
}
