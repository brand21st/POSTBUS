import { Resolver } from "node:dns/promises";
import https from "node:https";
import { logInfo } from "@/lib/logger";

export const SHOPIFY_HTTP_TIMEOUT_MS = 20_000;
const SHOPIFY_PUBLIC_DNS_SERVERS = ["8.8.8.8", "1.1.1.1"];

export type ShopifyHttpError = Error & {
  status?: number;
  code?: string;
  shopifyPageInfo?: string | null;
  imported?: number;
  updated?: number;
  skipped?: number;
};

export type ShopifyHttpDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  fetchViaPublicDns: (url: string, init: RequestInit) => Promise<Response>;
};

export function shopifyHttpError(message: string, status?: number, code?: string): ShopifyHttpError {
  const error = new Error(message) as ShopifyHttpError;
  if (status) error.status = status;
  error.code = code ?? (status ? `HTTP_${status}` : "PROVIDER_ERROR");
  return error;
}

export function abortAfter(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** True when the OS resolver cannot find the Shopify shop (common with ISP NXDOMAIN). */
export function isShopifyHostLookupFailure(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown };
    const code = String(record.code ?? "");
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA" || code === "EREFUSED") {
      return true;
    }
    current = record.cause;
  }
  return error instanceof TypeError && error.message === "fetch failed";
}

function headerRecord(headers: HeadersInit | undefined, hostname: string) {
  const parsed = new Headers(headers);
  if (!parsed.has("host")) parsed.set("host", hostname);
  const result: Record<string, string> = {};
  parsed.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export async function fetchShopifyViaPublicDns(url: string, init: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  const resolver = new Resolver();
  resolver.setServers(SHOPIFY_PUBLIC_DNS_SERVERS);
  const addresses = await resolver.resolve4(parsed.hostname);
  const address = addresses[0];
  if (!address) {
    throw shopifyHttpError(`Shopify shop DNS lookup failed for ${parsed.hostname}.`, undefined, "ENOTFOUND");
  }

  const method = (init.method || "GET").toUpperCase();
  const body = init.body;
  return await new Promise<Response>((resolve, reject) => {
    const request = https.request(
      {
        host: address,
        servername: parsed.hostname,
        port: Number(parsed.port || 443),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: headerRecord(init.headers, parsed.hostname),
        signal: init.signal ?? undefined,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        incoming.on("error", reject);
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (value == null) continue;
            responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 502, headers: responseHeaders }));
        });
      }
    );
    request.on("error", reject);
    if (body && method !== "GET" && method !== "HEAD") {
      request.write(typeof body === "string" || Buffer.isBuffer(body) ? body : String(body));
    }
    request.end();
  });
}

const defaultDeps: ShopifyHttpDeps = {
  fetch: (url, init) => fetch(url, init),
  fetchViaPublicDns: fetchShopifyViaPublicDns,
};

async function shopifyFetch(url: string, init: RequestInit, run: ShopifyHttpDeps["fetch"]) {
  const response = await run(url, init);
  if (response.status === 429) {
    throw shopifyHttpError("Shopify rate limited the request.", 429, "RATE_LIMITED");
  }
  return response;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export async function fetchWithShopifyTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = SHOPIFY_HTTP_TIMEOUT_MS,
  deps: ShopifyHttpDeps = defaultDeps
) {
  const timeout = abortAfter(timeoutMs);
  const signal = init.signal ?? timeout.signal;
  const request = { ...init, signal };
  try {
    try {
      return await shopifyFetch(url, request, deps.fetch);
    } catch (error) {
      if (isAbortError(error)) {
        throw shopifyHttpError("Shopify request timed out.", undefined, "ETIMEDOUT");
      }
      if (!isShopifyHostLookupFailure(error)) throw error;
      logInfo("shopify.dns_fallback", { hostname: new URL(url).hostname });
      try {
        return await shopifyFetch(url, request, deps.fetchViaPublicDns);
      } catch (retryError) {
        if (isAbortError(retryError)) {
          throw shopifyHttpError("Shopify request timed out.", undefined, "ETIMEDOUT");
        }
        throw retryError;
      }
    }
  } finally {
    timeout.clear();
  }
}
