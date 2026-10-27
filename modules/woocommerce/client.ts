import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { safeHttpsRequest } from "@/lib/security/outbound-url";
import { redactWooText } from "@/modules/woocommerce/sync-window";
import type { WooRemoteOrder } from "@/modules/woocommerce/map-order";

export class WooCommerceRequestError extends Error {
  status: number;
  code: string;
  retryAfterMs?: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.code = status === 429 ? "HTTP_429" : status >= 500 ? `HTTP_${status}` : "WOO_API_ERROR";
    if (status === 401 || status === 403) this.code = "PERMANENT_AUTH_ERROR";
  }
}

export function merchantWooError(status: number) {
  if (status === 401 || status === 403) {
    return "Your WooCommerce store connection needs attention. Please reconnect your store to continue automatic order synchronization.";
  }
  if (status === 404) {
    return "WooCommerce REST API is disabled or blocked on this store.";
  }
  if (status === 429) return "WooCommerce is rate limiting requests. PostBus will retry shortly.";
  return "PostBus could not reach your WooCommerce store. Try again shortly.";
}

export type WooCredentials = {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export type WooTransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type WooTransport = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<WooTransportResponse>;

const defaultTransport: WooTransport = (url, init) => safeHttpsRequest(url, init);

function authHeader(creds: WooCredentials) {
  const token = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export function wooRequestUrl(storeUrl: string, path: string, query?: Record<string, string>) {
  const base = storeUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  if (url.searchParams.has("consumer_key") || url.searchParams.has("consumer_secret")) {
    throw new Error("WooCommerce credentials must not be placed in the URL.");
  }
  return url;
}

export async function wooRequest<T>(
  creds: WooCredentials,
  path: string,
  init: {
    method?: string;
    query?: Record<string, string>;
    body?: unknown;
    transport?: WooTransport;
  } = {}
) {
  const url = wooRequestUrl(creds.storeUrl, path, init.query);
  const headers: Record<string, string> = {
    Authorization: authHeader(creds),
    Accept: "application/json",
  };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const transport = init.transport ?? defaultTransport;
  let response: WooTransportResponse;
  try {
    response = await transport(url.toString(), { method: init.method ?? "GET", headers, body });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network";
    throw new WooCommerceRequestError(0, redactWooText(message));
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers["retry-after"]);
    const error = new WooCommerceRequestError(429, merchantWooError(429));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
    throw error;
  }
  if (response.status < 200 || response.status >= 300) {
    throw new WooCommerceRequestError(response.status, merchantWooError(response.status));
  }
  const parsed = response.body ? (JSON.parse(response.body) as T) : (null as T);
  return { data: parsed, headers: response.headers, status: response.status };
}

export async function verifyWooRead(creds: WooCredentials, transport?: WooTransport) {
  return wooRequest<WooRemoteOrder[]>(creds, "/wp-json/wc/v3/orders", {
    query: { per_page: "1" },
    transport,
  });
}

export async function listWooOrders(
  creds: WooCredentials,
  query: Record<string, string>,
  transport?: WooTransport
) {
  const result = await wooRequest<WooRemoteOrder[]>(creds, "/wp-json/wc/v3/orders", { query, transport });
  const totalPages = Number(result.headers["x-wp-totalpages"]);
  return {
    orders: Array.isArray(result.data) ? result.data : [],
    totalPages: Number.isFinite(totalPages) ? totalPages : 1,
  };
}

export async function getWooOrder(creds: WooCredentials, orderId: string, transport?: WooTransport) {
  const result = await wooRequest<WooRemoteOrder>(creds, `/wp-json/wc/v3/orders/${encodeURIComponent(orderId)}`, {
    transport,
  });
  return result.data;
}

export async function getWooProductSettings(creds: WooCredentials, transport?: WooTransport) {
  const result = await wooRequest<Array<{ id?: string; value?: string }>>(
    creds,
    "/wp-json/wc/v3/settings/products",
    { transport }
  );
  return result.data ?? [];
}

export async function getWooProduct(creds: WooCredentials, productId: number, transport?: WooTransport) {
  const result = await wooRequest<{
    weight?: string;
    dimensions?: { length?: string; width?: string; height?: string };
  }>(creds, `/wp-json/wc/v3/products/${productId}`, { transport });
  return result.data;
}

export async function getWooVariation(
  creds: WooCredentials,
  productId: number,
  variationId: number,
  transport?: WooTransport
) {
  const result = await wooRequest<{
    weight?: string;
    dimensions?: { length?: string; width?: string; height?: string };
  }>(creds, `/wp-json/wc/v3/products/${productId}/variations/${variationId}`, { transport });
  return result.data;
}

export async function updateWooOrder(
  creds: WooCredentials,
  orderId: string,
  body: Record<string, unknown>,
  transport?: WooTransport
) {
  const result = await wooRequest(creds, `/wp-json/wc/v3/orders/${encodeURIComponent(orderId)}`, {
    method: "PUT",
    body,
    transport,
  });
  return result.data;
}

export async function createWooOrderNote(
  creds: WooCredentials,
  orderId: string,
  note: string,
  transport?: WooTransport
) {
  return wooRequest(creds, `/wp-json/wc/v3/orders/${encodeURIComponent(orderId)}/notes`, {
    method: "POST",
    body: { note, customer_note: true },
    transport,
  });
}

export async function createWooWebhook(
  creds: WooCredentials,
  input: { name: string; topic: string; deliveryUrl: string; secret: string },
  transport?: WooTransport
) {
  const result = await wooRequest<{ id?: number }>(creds, "/wp-json/wc/v3/webhooks", {
    method: "POST",
    body: {
      name: input.name,
      topic: input.topic,
      delivery_url: input.deliveryUrl,
      secret: input.secret,
      status: "active",
    },
    transport,
  });
  if (!result.data?.id) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "WooCommerce did not register the webhook.");
  }
  return result.data.id;
}

export async function deleteWooWebhook(creds: WooCredentials, webhookId: number, transport?: WooTransport) {
  await wooRequest(creds, `/wp-json/wc/v3/webhooks/${webhookId}`, {
    method: "DELETE",
    query: { force: "true" },
    transport,
  }).catch(() => undefined);
}
