export const SHOPIFY_HTTP_TIMEOUT_MS = 20_000;

export type ShopifyHttpError = Error & {
  status?: number;
  code?: string;
  shopifyPageInfo?: string | null;
  imported?: number;
  updated?: number;
  skipped?: number;
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

export async function fetchWithShopifyTimeout(url: string, init: RequestInit = {}, timeoutMs = SHOPIFY_HTTP_TIMEOUT_MS) {
  const timeout = abortAfter(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ?? timeout.signal,
    });
    if (response.status === 429) {
      throw shopifyHttpError("Shopify rate limited the request.", 429, "RATE_LIMITED");
    }
    return response;
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw shopifyHttpError("Shopify request timed out.", undefined, "ETIMEDOUT");
    }
    throw error;
  } finally {
    timeout.clear();
  }
}
