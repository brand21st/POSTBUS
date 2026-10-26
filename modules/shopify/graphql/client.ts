import { env } from "@/lib/env";
import { fetchWithShopifyTimeout, shopifyHttpError, type ShopifyHttpError } from "@/modules/shopify/http";

export type ShopifyGraphqlCost = {
  requestedQueryCost?: number;
  actualQueryCost?: number | null;
  throttleStatus?: { maximumAvailable?: number; currentlyAvailable?: number; restoreRate?: number };
};

type GraphqlError = { message?: string; extensions?: { code?: string } };

type GraphqlResponse<T> = {
  data?: T;
  errors?: GraphqlError[] | { message?: string };
  extensions?: { cost?: ShopifyGraphqlCost };
};

export type ShopifyGraphqlDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
};

const MAX_ATTEMPTS = 5;
const MAX_WAIT_MS = 10_000;

const defaultDeps: ShopifyGraphqlDeps = {
  fetch: (url, init) => fetchWithShopifyTimeout(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function shopifyGraphqlApiVersion() {
  return env.shopifyPublicAppApiVersion || "2026-04";
}

/** Milliseconds until the leaky bucket can afford `needed` points again. */
export function throttleWaitMs(cost: ShopifyGraphqlCost | undefined, needed?: number) {
  const status = cost?.throttleStatus;
  const restore = status?.restoreRate ?? 0;
  const available = status?.currentlyAvailable ?? 0;
  const want = needed ?? cost?.requestedQueryCost ?? 0;
  if (!restore || available >= want) return 0;
  return Math.min(MAX_WAIT_MS, Math.ceil(((want - available) / restore) * 1000));
}

function errorList(errors: GraphqlResponse<unknown>["errors"]): GraphqlError[] {
  if (!errors) return [];
  return Array.isArray(errors) ? errors : [errors];
}

/**
 * Admin GraphQL call for the public app. Retries THROTTLED/429 with the bucket's restore rate and
 * paces itself when the bucket runs low, so paginated syncs never hammer a shop.
 */
export async function shopifyAdminGraphql<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  deps: ShopifyGraphqlDeps = defaultDeps
): Promise<{ data: T; cost?: ShopifyGraphqlCost }> {
  const url = `https://${shop}/admin/api/${shopifyGraphqlApiVersion()}/graphql.json`;
  let lastError: ShopifyHttpError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      const httpError = error as ShopifyHttpError;
      if (httpError.status === 429) {
        lastError = httpError;
        await deps.sleep(Math.min(MAX_WAIT_MS, 1000 * 2 ** (attempt - 1)));
        continue;
      }
      throw error;
    }

    if (response.status === 401 || response.status === 403) {
      throw shopifyHttpError(`Shopify rejected the app token (${response.status}).`, response.status, "SHOPIFY_AUTH");
    }
    const json = (await response.json().catch(() => ({}))) as GraphqlResponse<T>;
    const cost = json.extensions?.cost;
    const errors = errorList(json.errors);

    if (errors.some((error) => error.extensions?.code === "THROTTLED")) {
      lastError = shopifyHttpError("Shopify throttled the request.", 429, "RATE_LIMITED");
      await deps.sleep(throttleWaitMs(cost) || 1000);
      continue;
    }
    if (!response.ok) {
      throw shopifyHttpError(`Shopify GraphQL failed (${response.status}).`, response.status);
    }
    if (errors.length || !json.data) {
      throw shopifyHttpError(errors[0]?.message || "Shopify GraphQL returned no data.", 502, "GRAPHQL_ERROR");
    }

    // Pace the next call instead of waiting to be throttled.
    const wait = throttleWaitMs(cost, cost?.requestedQueryCost);
    if (wait > 0) await deps.sleep(wait);
    return { data: json.data, cost };
  }

  throw lastError ?? shopifyHttpError("Shopify throttled the request.", 429, "RATE_LIMITED");
}
