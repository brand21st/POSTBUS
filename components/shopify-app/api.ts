"use client";

import { useCallback } from "react";
import { useShopifyAppFetch } from "@/components/shopify-app/token-provider";

/** Error from the PostBus API, carrying the server's message and code for banners. */
export class ShopifyApiError extends Error {
  status: number;
  code: string | null;
  details: unknown;

  constructor(message: string, status: number, code: string | null, details: unknown) {
    super(message);
    this.name = "ShopifyApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T | null;
  errors?: Array<{ code?: string; details?: unknown }>;
};

export type ApiRequest = { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown };

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Calls the PostBus v1 API through the Shopify app backend (`/api/shopify/v1/*`) with a fresh
 * session token, and unwraps the `{ success, data }` envelope.
 */
export function useShopifyApi() {
  const { authorizedFetch } = useShopifyAppFetch();
  return useCallback(
    async <T,>(path: string, request: ApiRequest = {}): Promise<T> => {
      const response = await authorizedFetch(`/api/shopify/v1/${path.replace(/^\//, "")}`, {
        method: request.method ?? "GET",
        headers: request.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      const json = (await response.json().catch(() => ({}))) as Envelope<T>;
      if (!response.ok || json.success === false) {
        const first = json.errors?.[0];
        throw new ShopifyApiError(
          json.message || `Request failed (${response.status}).`,
          response.status,
          first?.code ?? null,
          first?.details ?? null
        );
      }
      return json.data as T;
    },
    [authorizedFetch]
  );
}

/** Calls a Shopify-app route outside v1 (e.g. `bootstrap`). */
export function useShopifyAppRoute() {
  const { authorizedFetch } = useShopifyAppFetch();
  return useCallback(
    async <T,>(path: string): Promise<T> => {
      const response = await authorizedFetch(`/api/shopify/${path.replace(/^\//, "")}`);
      const json = (await response.json().catch(() => ({}))) as Envelope<T>;
      if (!response.ok || json.success === false) {
        throw new ShopifyApiError(json.message || "Unable to load PostBus.", response.status, json.errors?.[0]?.code ?? null, null);
      }
      return json.data as T;
    },
    [authorizedFetch]
  );
}
