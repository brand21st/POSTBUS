"use client";

import { useAppBridge } from "@shopify/app-bridge-react";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

type TokenContextValue = {
  apiKey: string;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const TokenContext = createContext<TokenContextValue | null>(null);

export function ShopifyTokenProvider({
  apiKey,
  children,
}: {
  apiKey: string;
  children: ReactNode;
}) {
  const shopify = useAppBridge();
  const authorizedFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = shopify?.idToken ? await shopify.idToken() : "";
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401 && response.headers.get("X-Shopify-Retry-Invalid-Session-Request") === "1") {
      const retryToken = shopify?.idToken ? await shopify.idToken() : "";
      if (retryToken && retryToken !== token) {
        headers.set("Authorization", `Bearer ${retryToken}`);
        return fetch(input, { ...init, headers });
      }
    }
    return response;
  }, [shopify]);

  const value = useMemo(() => ({ apiKey, authorizedFetch }), [apiKey, authorizedFetch]);
  return <TokenContext.Provider value={value}>{children}</TokenContext.Provider>;
}

export function useShopifyAppFetch() {
  const ctx = useContext(TokenContext);
  if (!ctx) throw new Error("Shopify app shell is missing.");
  return ctx;
}
